import "server-only";
import { and, desc, eq, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./index";
import { eveningPreviewPrefs, itineraryItems, notifications, places, tripInvitations, tripMembers, trips, userProfiles } from "./schema";
import {
  INVITATION_SCOPED_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_PAGE_SIZE,
  cleanText,
  dedupeKeys,
  describeItineraryChange,
  draftParts,
  isNotificationType,
  isTimestamp,
  isUuid,
  personName,
  reminderInfoFrom,
  resolveDestination,
  unavailableBody,
  UNAVAILABLE_COPY,
  type ItinerarySnapshot,
  type NotificationDraft,
  type NotificationFilter,
  type NotificationItem,
  type NotificationPage,
} from "@/lib/notifications";
import { notificationGroupOf } from "@/lib/settings";
import { notificationSettingsFor } from "./settings";

/**
 * The notification service. Two halves:
 *
 * - writing: `createNotifications` is the ONLY way a row is created. It takes
 *   drafts built on the server from verified state, re-checks that every
 *   recipient may currently see what it is about, refuses types that are not
 *   enabled, cleans the text, and is idempotent per (recipient, dedupe key).
 *   Event helpers below run inside the caller's transaction, so a rolled-back
 *   write leaves no notification and a successful one never lacks it.
 * - reading: every query is constrained by `recipient_id` (the verified
 *   session user) and re-checks access at read time, so a notification can
 *   never be a way around authorization.
 *
 * Like queries.ts and sharing.ts this is reached only from src/lib/dal.ts.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** The verified session user as the notification queries need them. */
export type Viewer = { id: string; verifiedEmail: string | null };

/* ------------------------------- writing ------------------------------- */

type TripAudience = { owner: string; members: Set<string> };

async function audiences(db: Executor, tripIds: string[]): Promise<Map<string, TripAudience>> {
  const map = new Map<string, TripAudience>();
  if (tripIds.length === 0) return map;
  const owners = await db.select({ id: trips.id, owner: trips.owner_id }).from(trips).where(inArray(trips.id, tripIds));
  for (const o of owners) map.set(o.id, { owner: o.owner, members: new Set() });
  const members = await db
    .select({ trip: tripMembers.trip_id, user: tripMembers.user_id })
    .from(tripMembers)
    .where(inArray(tripMembers.trip_id, tripIds));
  for (const m of members) map.get(m.trip)?.members.add(m.user);
  return map;
}

/**
 * Runs a notification write in a savepoint inside the caller's transaction.
 * A bug here is logged and rolled back to the savepoint: it can never undo
 * (or block) the trip change the notification is about, and it cannot leave
 * the surrounding transaction aborted.
 */
export async function safely(db: Executor, label: string, fn: (tx: Executor) => Promise<unknown>): Promise<void> {
  try {
    await (db as Db).transaction(async (tx) => {
      await fn(tx);
    });
  } catch (error) {
    console.error(`[rove] notification (${label}) failed:`, (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as Error)?.name);
  }
}

/** Everyone who currently sees the trip: its owner and its members. */
export async function tripPeople(db: Executor, tripId: string): Promise<string[]> {
  const a = (await audiences(db, [tripId])).get(tripId);
  return a ? [a.owner, ...a.members] : [];
}

/**
 * Creates the notifications that are allowed to exist; returns how many were
 * new. A draft is skipped (never an error) when its recipient is the actor,
 * is not currently on the trip (or has no open invitation, for invitation
 * types), or already has a notification with the same dedupe key. A type that
 * is not enabled yet throws — that is a programming error, not a user one.
 */
export async function createNotifications(db: Executor, drafts: NotificationDraft[]): Promise<number> {
  for (const d of drafts) {
    if (!isNotificationType(d.type) || !NOTIFICATION_KINDS[d.type].enabled) {
      throw new Error(`Notification type "${d.type}" is not enabled`);
    }
  }
  const eligible = drafts.filter((d) => d.recipientId && d.recipientId !== d.actorId && isUuid(d.tripId));
  if (eligible.length === 0) return 0;
  // The recipient's own Settings are the global delivery gate: a type they turned off is never created
  // (what is already in their inbox is left alone).
  const switches = await notificationSettingsFor(db, eligible.map((d) => d.recipientId));
  const candidates = eligible.filter((d) => {
    const group = notificationGroupOf(d.type === "reminder" ? { type: d.type, subject: d.subject } : { type: d.type });
    return !group || (switches.get(d.recipientId)?.[group] ?? true);
  });
  if (candidates.length === 0) return 0;

  const people = await audiences(db, [...new Set(candidates.map((d) => d.tripId))]);

  const invitationIds = candidates.filter((d) => d.type === "invitation_received").map((d) => (d as { invitationId: string }).invitationId);
  const openInvites = new Map<string, { trip: string; email: string }>();
  if (invitationIds.length > 0) {
    const rows = await db
      .select({ id: tripInvitations.id, trip: tripInvitations.trip_id, email: tripInvitations.email })
      .from(tripInvitations)
      .where(
        and(
          inArray(tripInvitations.id, invitationIds),
          isNull(tripInvitations.accepted_at),
          isNull(tripInvitations.revoked_at),
          sql`${tripInvitations.expires_at} > now()`,
        ),
      );
    for (const r of rows) if (r.email) openInvites.set(r.id, { trip: r.trip, email: r.email });
  }

  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const d of candidates) {
    const trip = people.get(d.tripId);
    if (!trip) continue;
    const isOnTrip = trip.owner === d.recipientId || trip.members.has(d.recipientId);
    if (d.type === "invitation_received") {
      const invite = openInvites.get(d.invitationId);
      if (isOnTrip || !invite || invite.trip !== d.tripId) continue;
    } else if (!isOnTrip) {
      continue;
    }
    const title = cleanText(d.title, 120);
    const body = cleanText(d.body, 400);
    if (!title || !body) continue;
    const parts = draftParts(d);
    rows.push({
      recipient_id: d.recipientId,
      trip_id: d.tripId,
      trip_owner_id: trip.owner,
      type: d.type,
      title,
      body,
      resource_type: parts.resourceType,
      resource_id: parts.resourceId,
      actor_id: d.actorId,
      dedupe_key: d.dedupeKey.slice(0, 200),
      metadata: parts.metadata,
    });
  }
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing({ target: [notifications.recipient_id, notifications.dedupe_key] })
    .returning({ id: notifications.id });
  return inserted.length;
}

/** Ids of accounts whose profile carries this (already normalized) email. */
export async function userIdsForEmail(db: Executor, email: string): Promise<string[]> {
  const rows = await db
    .select({ id: userProfiles.user_id })
    .from(userProfiles)
    .where(sql`lower(${userProfiles.email}) = ${email}`)
    .limit(5);
  return rows.map((r) => r.id);
}

const ROLE_WORD = { editor: "an editor", viewer: "a viewer" } as const;

export function invitationReceivedDraft(input: {
  recipientId: string;
  tripId: string;
  invitationId: string;
  inviterId: string;
  inviterName: string;
  tripTitle: string;
  role: "editor" | "viewer";
}): NotificationDraft {
  return {
    type: "invitation_received",
    recipientId: input.recipientId,
    actorId: input.inviterId,
    tripId: input.tripId,
    invitationId: input.invitationId,
    dedupeKey: dedupeKeys.invitationReceived(input.invitationId),
    title: "Trip invitation",
    body: `${personName(input.inviterName)} invited you to “${cleanText(input.tripTitle, 80)}” as ${ROLE_WORD[input.role]}.`,
  };
}

export function invitationAcceptedDraft(input: {
  ownerId: string;
  tripId: string;
  invitationId: string;
  acceptorId: string;
  acceptorName: string;
  tripTitle: string;
  role: "editor" | "viewer";
}): NotificationDraft {
  return {
    type: "invitation_accepted",
    recipientId: input.ownerId,
    actorId: input.acceptorId,
    tripId: input.tripId,
    invitationId: input.invitationId,
    dedupeKey: dedupeKeys.invitationAccepted(input.invitationId),
    title: "Invitation accepted",
    body: `${personName(input.acceptorName)} joined “${cleanText(input.tripTitle, 80)}” as ${ROLE_WORD[input.role]}.`,
  };
}

export async function tripTitleOf(db: Executor, ownerId: string, tripId: string): Promise<string | null> {
  const [row] = await db
    .select({ title: trips.title })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)));
  return row?.title ?? null;
}

/**
 * Invitations that are open and addressed to this verified email but have no
 * notification yet (the person had no account when it was created, or no
 * profile). Run for the signed-in, verified user; creates the missing
 * "invitation_received" notifications. It never accepts anything.
 */
export async function reconcileInvitationNotifications(db: Db, viewer: Viewer): Promise<number> {
  if (!viewer.verifiedEmail) return 0;
  const pending = await db
    .select({
      id: tripInvitations.id,
      trip_id: tripInvitations.trip_id,
      owner_id: tripInvitations.owner_id,
      invited_by: tripInvitations.invited_by,
      inviter_name: tripInvitations.inviter_name,
      role: tripInvitations.role,
      title: trips.title,
    })
    .from(tripInvitations)
    .innerJoin(trips, and(eq(trips.id, tripInvitations.trip_id), eq(trips.owner_id, tripInvitations.owner_id)))
    .where(
      and(
        eq(tripInvitations.email, viewer.verifiedEmail),
        isNull(tripInvitations.accepted_at),
        isNull(tripInvitations.revoked_at),
        sql`${tripInvitations.expires_at} > now()`,
        sql`${tripInvitations.owner_id} <> ${viewer.id}`,
        sql`not exists (select 1 from ${notifications} n where n.recipient_id = ${viewer.id} and n.dedupe_key = 'invitation_received:' || ${tripInvitations.id}::text)`,
      ),
    )
    .limit(20);
  if (pending.length === 0) return 0;
  return createNotifications(
    db,
    pending.map((p) =>
      invitationReceivedDraft({
        recipientId: viewer.id,
        tripId: p.trip_id,
        invitationId: p.id,
        inviterId: p.invited_by,
        inviterName: p.inviter_name,
        tripTitle: p.title,
        role: p.role as "editor" | "viewer",
      }),
    ),
  );
}

/** A member left or was removed: their notifications about that trip go with their access. */
export async function purgeTripNotificationsFor(db: Executor, tripId: string, userId: string) {
  await db.delete(notifications).where(and(eq(notifications.trip_id, tripId), eq(notifications.recipient_id, userId)));
  // Their evening-preview opt-in is private to them and ends with their access.
  await db.delete(eveningPreviewPrefs).where(and(eq(eveningPreviewPrefs.trip_id, tripId), eq(eveningPreviewPrefs.user_id, userId)));
}

/* ----------------------------- itinerary events ----------------------------- */

export type ItineraryProbe = { snapshot: ItinerarySnapshot; rowVersion: string; tripZone: string };

/**
 * The itinerary row as the group would read it, with the trip's zone. Locks
 * the trip row first, so the "before" we read is what the write will change.
 */
export async function probeItineraryItem(
  db: Executor,
  ownerId: string,
  tripId: string,
  itemId: string,
  { lock = false } = {},
): Promise<ItineraryProbe | null> {
  if (lock) {
    await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
      .for("update");
  }
  const [row] = await db
    .select({
      item: itineraryItems,
      place_name: places.name,
      trip_zone: trips.time_zone,
    })
    .from(itineraryItems)
    .innerJoin(trips, and(eq(trips.id, itineraryItems.trip_id), eq(trips.owner_id, itineraryItems.owner_id)))
    .leftJoin(places, and(eq(places.id, itineraryItems.place_id), eq(places.trip_id, itineraryItems.trip_id)))
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)));
  if (!row) return null;
  const { item } = row;
  return {
    rowVersion: item.updated_at,
    tripZone: row.trip_zone,
    snapshot: {
      id: item.id,
      title: item.title ?? row.place_name ?? "An activity",
      date: item.local_date ?? "",
      start_time: item.local_start_time ? item.local_start_time.slice(0, 5) : null,
      end_date: item.local_end_date,
      end_time: item.local_end_time ? item.local_end_time.slice(0, 5) : null,
      time_zone: item.timezone ?? row.trip_zone,
      place_id: item.place_id,
      place_name: row.place_name,
      reservation_backed: item.reservation_id !== null || !item.local_date,
    },
  };
}

/**
 * Announces one itinerary write to everyone else on the trip. Call only
 * after the write succeeded, in the same transaction.
 */
export async function announceItineraryChange(
  db: Executor,
  input: {
    ownerId: string;
    tripId: string;
    actorId: string;
    actorName: string;
    kind: "added" | "removed" | "changed";
    before: ItineraryProbe | null;
    after: ItineraryProbe | null;
  },
): Promise<number> {
  const subject = input.kind === "removed" ? input.before : input.after;
  if (!subject) return 0;
  const text = describeItineraryChange(
    input.kind,
    input.before?.snapshot ?? null,
    input.after?.snapshot ?? null,
    subject.tripZone,
    input.actorName,
  );
  if (!text) return 0;
  const itemId = subject.snapshot.id;
  const dedupeKey =
    input.kind === "added"
      ? dedupeKeys.itineraryAdded(itemId)
      : input.kind === "removed"
        ? dedupeKeys.itineraryRemoved(itemId)
        : dedupeKeys.itineraryChanged(itemId, input.after?.rowVersion ?? "");
  const recipients = (await tripPeople(db, input.tripId)).filter((id) => id !== input.actorId);
  return createNotifications(
    db,
    recipients.map(
      (recipientId): NotificationDraft => ({
        type: "itinerary_changed",
        recipientId,
        actorId: input.actorId,
        tripId: input.tripId,
        itemId,
        date: text.date,
        dedupeKey,
        title: text.title,
        body: text.body,
      }),
    ),
  );
}

/**
 * Wraps one itinerary write so the rest of the trip hears about meaningful
 * changes. The "before" is read with the trip row locked, `write` runs, and
 * only if it succeeded does the announcement run — in the same transaction
 * (a rollback takes the notification with it) and inside a savepoint (a
 * notification problem never blocks or undoes the edit). Call it from inside
 * the trip-write transaction with that transaction as `db`.
 */
export async function withItineraryAnnouncement<R>(
  db: Db,
  input: {
    ownerId: string;
    tripId: string;
    actorId: string;
    actorName: string;
    kind: "added" | "removed" | "changed";
    /** The row being changed or removed; null when the write creates one. */
    itemId: string | null;
  },
  write: () => Promise<R>,
  outcome: (result: R) => { ok: boolean; id?: string },
): Promise<R> {
  const probe = async (id: string, lock: boolean) => {
    try {
      return await db.transaction((tx) => probeItineraryItem(tx, input.ownerId, input.tripId, id, { lock }));
    } catch {
      return null;
    }
  };
  const before = input.itemId && input.kind !== "added" ? await probe(input.itemId, true) : null;
  const result = await write();
  const done = outcome(result);
  if (!done.ok) return result;
  const targetId = input.itemId ?? done.id ?? null;
  const after = targetId && input.kind !== "removed" ? await probe(targetId, false) : null;
  await safely(db, `itinerary_${input.kind}`, (tx) =>
    announceItineraryChange(tx, {
      ownerId: input.ownerId,
      tripId: input.tripId,
      actorId: input.actorId,
      actorName: input.actorName,
      kind: input.kind,
      before,
      after,
    }),
  );
  return result;
}

/**
 * After an email-bound invitation was created: if that address already
 * belongs to an account, tell that person. (People without an account yet
 * are picked up by `reconcileInvitationNotifications` after their verified
 * sign-in.) Never accepts anything.
 */
export async function announceInvitationCreated(
  db: Db,
  input: { ownerId: string; tripId: string; inviterId: string; inviterName: string; invitationId: string; email: string; role: "editor" | "viewer" },
) {
  await safely(db, "invitation_received", async (tx) => {
    const [title, recipients] = await Promise.all([tripTitleOf(tx, input.ownerId, input.tripId), userIdsForEmail(tx, input.email)]);
    if (!title) return;
    await createNotifications(
      tx,
      recipients
        .filter((id) => id !== input.inviterId)
        .map((recipientId) =>
          invitationReceivedDraft({
            recipientId,
            tripId: input.tripId,
            invitationId: input.invitationId,
            inviterId: input.inviterId,
            inviterName: input.inviterName,
            tripTitle: title,
            role: input.role,
          }),
        ),
    );
  });
}

/* ------------------------------- reading ------------------------------- */

const encodeCursor = (createdAt: string, id: string) => Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");

function decodeCursor(raw: string | null | undefined): { createdAt: string; id: string } | null {
  if (!raw || raw.length > 200) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    return isTimestamp(createdAt) && isUuid(id) ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

/** Is the recipient on the trip right now? Needs `trips` joined on the notification's trip. */
function isMemberSql(viewer: Viewer): SQL<boolean> {
  return sql<boolean>`(${trips.id} is not null and (${trips.owner_id} = ${viewer.id} or exists (select 1 from ${tripMembers} m where m.trip_id = ${trips.id} and m.user_id = ${viewer.id})))`;
}

/** An open invitation to this verified email, for the invitation-scoped types. */
function inviteOpenSql(viewer: Viewer): SQL<boolean> {
  if (!viewer.verifiedEmail || INVITATION_SCOPED_TYPES.length === 0) return sql<boolean>`false`;
  const types = sql.join(
    INVITATION_SCOPED_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql<boolean>`(${notifications.type} in (${types}) and exists (
    select 1 from ${tripInvitations} i
    where i.id = ${notifications.resource_id} and i.trip_id = ${notifications.trip_id}
      and i.email = ${viewer.verifiedEmail}
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()))`;
}

/** Microsecond-precision ISO strings: sortable as text, parseable by every browser, and safe to hand back as a cursor / "up to" marker. */
const isoText = (column: typeof notifications.created_at) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function itemColumns(viewer: Viewer) {
  const member = isMemberSql(viewer);
  return {
    id: notifications.id,
    type: notifications.type,
    title: notifications.title,
    body: notifications.body,
    created_at: isoText(notifications.created_at),
    read_at: sql<string | null>`to_char(${notifications.read_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    trip_id: notifications.trip_id,
    resource_id: notifications.resource_id,
    metadata: notifications.metadata,
    is_member: member,
    available: sql<boolean>`(${member} or ${inviteOpenSql(viewer)})`,
    // The trip's current title is only ever read for someone who is on the trip.
    trip_title: sql<string | null>`case when ${member} then ${trips.title} else null end`,
  };
}

type ItemRow = Awaited<ReturnType<typeof fetchItems>>[number];

async function fetchItems(db: Db, viewer: Viewer, where: SQL | undefined, limit: number) {
  return db
    .select(itemColumns(viewer))
    .from(notifications)
    .leftJoin(trips, and(eq(trips.id, notifications.trip_id), eq(trips.owner_id, notifications.trip_owner_id)))
    .where(where)
    .orderBy(desc(notifications.created_at), desc(notifications.id))
    .limit(limit);
}

function toItem(row: ItemRow): NotificationItem | null {
  if (!isNotificationType(row.type)) return null;
  const kind = NOTIFICATION_KINDS[row.type];
  if (!kind.enabled) return null;
  const base = { id: row.id, type: row.type, label: kind.label, created_at: row.created_at, read_at: row.read_at };
  if (!row.available) {
    // Never leak what it used to say.
    return { ...base, available: false, title: UNAVAILABLE_COPY.title, body: unavailableBody(row.type), trip: null, href: null };
  }
  return {
    ...base,
    available: true,
    title: row.title,
    body: row.body,
    trip: row.is_member && row.trip_id && row.trip_title ? { id: row.trip_id, title: row.trip_title } : null,
    href: resolveDestination(row.type, {
      tripId: row.trip_id,
      resourceId: row.resource_id,
      metadata: row.metadata ?? {},
      isMember: row.is_member,
    }),
    reminder: reminderInfoFrom(row),
  };
}

const live = (viewer: Viewer) => and(eq(notifications.recipient_id, viewer.id), isNull(notifications.archived_at));

export async function countUnread(db: Db, viewer: Viewer): Promise<{ unread: number; latest: string | null }> {
  const member = isMemberSql(viewer);
  const [row] = await db
    .select({
      unread: sql<number>`count(*) filter (where ${notifications.read_at} is null and (${member} or ${inviteOpenSql(viewer)}))::int`,
      latest: sql<string | null>`to_char(max(${notifications.created_at}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(notifications)
    .leftJoin(trips, and(eq(trips.id, notifications.trip_id), eq(trips.owner_id, notifications.trip_owner_id)))
    .where(live(viewer));
  return { unread: row?.unread ?? 0, latest: row?.latest ?? null };
}

export async function listNotifications(
  db: Db,
  viewer: Viewer,
  opts: { filter?: NotificationFilter; cursor?: string | null; limit?: number } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(opts.limit ?? NOTIFICATION_PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(opts.cursor);
  const member = isMemberSql(viewer);
  const rows = await fetchItems(
    db,
    viewer,
    and(
      live(viewer),
      opts.filter === "unread" ? and(isNull(notifications.read_at), sql`(${member} or ${inviteOpenSql(viewer)})`) : undefined,
      cursor
        ? or(
            lt(notifications.created_at, sql`${cursor.createdAt}::timestamptz`),
            and(eq(notifications.created_at, sql`${cursor.createdAt}::timestamptz`), lt(notifications.id, cursor.id)),
          )
        : undefined,
    ),
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const { unread } = await countUnread(db, viewer);
  return {
    items: page.map(toItem).filter((i): i is NotificationItem => i !== null),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    unread,
  };
}

/** One of the viewer's own notifications, as the list would show it (null = not theirs / gone). */
export async function getNotification(db: Db, viewer: Viewer, id: string): Promise<NotificationItem | null> {
  if (!isUuid(id)) return null;
  const [row] = await fetchItems(db, viewer, and(live(viewer), eq(notifications.id, id)), 1);
  return row ? toItem(row) : null;
}

/** true = it is the viewer's (now read); someone else's or unknown ids change nothing. */
export async function markRead(db: Db, viewer: Viewer, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .update(notifications)
    .set({ read_at: sql`coalesce(${notifications.read_at}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.recipient_id, viewer.id)))
    .returning({ id: notifications.id });
  return rows.length === 1;
}

/**
 * Marks the viewer's unread notifications read. `upTo` (the newest
 * `created_at` they were looking at) keeps anything that arrived since
 * unread, so "Mark all as read" never hides something unseen.
 */
export async function markAllRead(db: Db, viewer: Viewer, upTo?: string | null): Promise<number> {
  if (upTo != null && !isTimestamp(upTo)) return 0;
  const rows = await db
    .update(notifications)
    .set({ read_at: sql`now()` })
    .where(
      and(
        live(viewer),
        isNull(notifications.read_at),
        upTo ? lte(notifications.created_at, sql`${upTo}::timestamptz`) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

export async function archiveNotification(db: Db, viewer: Viewer, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .update(notifications)
    .set({ archived_at: sql`coalesce(${notifications.archived_at}, now())`, read_at: sql`coalesce(${notifications.read_at}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.recipient_id, viewer.id)))
    .returning({ id: notifications.id });
  return rows.length === 1;
}
