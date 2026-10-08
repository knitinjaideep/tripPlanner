import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./index";
import { createNotifications, invitationAcceptedDraft, purgeTripNotificationsFor, safely } from "./notifications";
import { onMemberRemoved } from "./reminders";
import { itineraryItems, packingItems, places, reservations, tripInvitations, tripMembers, trips, userProfiles, userSettings } from "./schema";
import {
  INVITE_CREATE_LIMIT_PER_HOUR,
  INVITE_RESEND_COOLDOWN_MS,
  INVITE_TTL_DAYS,
  MAX_MEMBERS_PER_TRIP,
  MAX_PENDING_INVITATIONS,
  ForbiddenError,
  can,
  maskEmail,
  normalizeEmail,
  type Capability,
  type InviteRole,
  type OpenInvitation,
  type TripRole,
} from "@/lib/sharing";
import type { TripListItem } from "@/lib/types";

/**
 * Sharing queries: membership, invitations, and the access check every other
 * feature goes through. Like queries.ts these are only reached from
 * src/lib/dal.ts, which verifies the session first.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/* ------------------------------ tokens ----------------------------- */

/** 32 random bytes as base64url (43 characters). The raw value is shown once and never stored. */
export function newInviteToken() {
  return randomBytes(32).toString("base64url");
}

/** What is stored and looked up: SHA-256 of the token. A database leak yields no usable links. */
export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/* ------------------------------ access ----------------------------- */

export type TripAccess = { ownerId: string; role: TripRole };

/**
 * The caller's relationship to one trip: the trip's real owner ID (which the
 * owner-scoped queries need, because child rows carry it) and the caller's
 * role. null = the trip does not exist or the caller has no access to it.
 */
export async function resolveTripAccess(db: Executor, userId: string, tripId: string): Promise<TripAccess | null> {
  const [row] = await db
    .select({ owner_id: trips.owner_id, role: tripMembers.role })
    .from(trips)
    .leftJoin(tripMembers, and(eq(tripMembers.trip_id, trips.id), eq(tripMembers.user_id, userId)))
    .where(and(eq(trips.id, tripId), or(eq(trips.owner_id, userId), eq(tripMembers.user_id, userId))))
    .limit(1);
  if (!row) return null;
  return { ownerId: row.owner_id, role: row.owner_id === userId ? "owner" : (row.role as InviteRole) };
}

/**
 * Runs `fn` in one transaction whose writes are attributed to `userId`
 * (the row triggers read `app.actor`). Nested transactions inside `fn`
 * become savepoints, so the existing queries work unchanged.
 */
export async function asActor<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}

export type TripContext = { userId: string; ownerId: string; role: TripRole };

/**
 * The write path every mutation takes: in one transaction attributed to
 * `userId`, resolve their role on THIS trip, refuse (ForbiddenError) when the
 * role lacks `capability`, and only then run `fn` with the trip's real owner.
 * No access at all → `fallback` (the same "not found" a missing trip gives).
 */
export async function runTripWrite<T, F>(
  db: Db,
  userId: string,
  tripId: string,
  capability: Capability,
  fallback: F,
  fn: (db: Db, ctx: TripContext) => Promise<T>,
): Promise<T | F> {
  return asActor(db, userId, async (tx) => {
    const access = await resolveTripAccess(tx, userId, tripId);
    if (!access) return fallback;
    if (!can(access.role, capability)) throw new ForbiddenError();
    return fn(tx, { userId, ...access });
  });
}

/* ------------------------------ trips ------------------------------ */

/** Trips the user owns plus trips shared with them, soonest first. */
export async function listAccessibleTrips(db: Db, userId: string): Promise<TripListItem[]> {
  const [owned, shared] = await Promise.all([
    db.select().from(trips).where(eq(trips.owner_id, userId)),
    db
      .select({ trip: trips, role: tripMembers.role, owner_name: userProfiles.display_name })
      .from(tripMembers)
      .innerJoin(trips, and(eq(trips.id, tripMembers.trip_id), eq(trips.owner_id, tripMembers.owner_id)))
      .leftJoin(userProfiles, eq(userProfiles.user_id, trips.owner_id))
      .where(eq(tripMembers.user_id, userId)),
  ]);
  const all: TripListItem[] = [
    ...owned.map((t) => ({ ...t, role: "owner" as const, owner_name: null })),
    ...shared.map((s) => ({ ...s.trip, role: s.role as InviteRole, owner_name: s.owner_name })),
  ];
  return all.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at));
}

/* ----------------------------- profiles ---------------------------- */

export async function upsertProfile(db: Executor, profile: { id: string; name: string; email: string | null }) {
  // The person's Atlas-only display name (Settings → Account), when set, wins over the Google name.
  const name = sql<string>`coalesce((select ${userSettings.display_name} from ${userSettings} where ${userSettings.user_id} = ${profile.id}), ${profile.name.slice(0, 120) || "Traveler"})`;
  await db
    .insert(userProfiles)
    .values({ user_id: profile.id, display_name: name, email: profile.email })
    .onConflictDoUpdate({
      target: userProfiles.user_id,
      set: { display_name: sql`excluded.display_name`, email: sql`excluded.email`, updated_at: sql`now()` },
      setWhere: sql`${userProfiles.display_name} is distinct from excluded.display_name or ${userProfiles.email} is distinct from excluded.email`,
    });
}

/** Display names for attribution ("Added by …"). Unknown IDs are simply absent. */
export async function profileNames(db: Db, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};
  const rows = await db
    .select({ id: userProfiles.user_id, name: userProfiles.display_name })
    .from(userProfiles)
    .where(inArray(userProfiles.user_id, unique));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/* ----------------------------- members ----------------------------- */

export type MemberRow = {
  user_id: string;
  role: InviteRole;
  joined_at: string;
  display_name: string;
  email: string | null;
};

export async function listMembers(db: Db, ownerId: string, tripId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      user_id: tripMembers.user_id,
      role: tripMembers.role,
      joined_at: tripMembers.joined_at,
      display_name: userProfiles.display_name,
      email: userProfiles.email,
    })
    .from(tripMembers)
    .leftJoin(userProfiles, eq(userProfiles.user_id, tripMembers.user_id))
    .where(and(eq(tripMembers.trip_id, tripId), eq(tripMembers.owner_id, ownerId)))
    .orderBy(asc(tripMembers.joined_at));
  return rows.map((r) => ({ ...r, role: r.role as InviteRole, display_name: r.display_name ?? "Trip member" }));
}

export async function countMembers(db: Db, ownerId: string, tripId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(tripMembers)
    .where(and(eq(tripMembers.trip_id, tripId), eq(tripMembers.owner_id, ownerId)));
  return n;
}

export type MemberChange = { ok: true } | { ok: false; reason: "not_found" | "owner" };

export async function updateMemberRole(
  db: Db,
  ownerId: string,
  tripId: string,
  memberUserId: string,
  role: InviteRole,
): Promise<MemberChange> {
  if (memberUserId === ownerId) return { ok: false, reason: "owner" };
  const rows = await db
    .update(tripMembers)
    .set({ role, updated_at: sql`now()` })
    .where(and(eq(tripMembers.trip_id, tripId), eq(tripMembers.owner_id, ownerId), eq(tripMembers.user_id, memberUserId)))
    .returning({ id: tripMembers.id });
  return rows.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Removes the membership only. What the person added stays on the trip
 * (rows keep `created_by` as plain text); their private Explore hearts and
 * notes go with them.
 */
export async function removeMember(db: Db, ownerId: string, tripId: string, memberUserId: string): Promise<MemberChange> {
  if (memberUserId === ownerId) return { ok: false, reason: "owner" };
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(tripMembers)
      .where(and(eq(tripMembers.trip_id, tripId), eq(tripMembers.owner_id, ownerId), eq(tripMembers.user_id, memberUserId)))
      .returning({ id: tripMembers.id });
    if (rows.length !== 1) return { ok: false, reason: "not_found" } as const;
    await tx.execute(sql`delete from place_member_state where trip_id = ${tripId} and user_id = ${memberUserId}`);
    await purgeTripNotificationsFor(tx, tripId, memberUserId);
    // Their tasks become unassigned and every reminder addressed to them on this trip is canceled.
    await onMemberRemoved(tx, tripId, memberUserId);
    return { ok: true } as const;
  });
}

/** A member leaves. The owner has no membership row, so can never leave this way. */
export async function leaveTrip(db: Db, userId: string, tripId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(tripMembers)
      .where(and(eq(tripMembers.trip_id, tripId), eq(tripMembers.user_id, userId)))
      .returning({ id: tripMembers.id });
    if (rows.length === 1) {
      await tx.execute(sql`delete from place_member_state where trip_id = ${tripId} and user_id = ${userId}`);
      await purgeTripNotificationsFor(tx, tripId, userId);
      await onMemberRemoved(tx, tripId, userId);
    }
    return rows.length === 1;
  });
}

/* --------------------------- invitations --------------------------- */

export type InvitationRow = OpenInvitation;

const invitationColumns = {
  id: tripInvitations.id,
  email: tripInvitations.email,
  role: tripInvitations.role,
  expires_at: tripInvitations.expires_at,
  created_at: tripInvitations.created_at,
  last_sent_at: tripInvitations.last_sent_at,
  send_count: tripInvitations.send_count,
  delivery_status: tripInvitations.delivery_status,
  accepted_at: tripInvitations.accepted_at,
  revoked_at: tripInvitations.revoked_at,
};

/** Open invitations (not accepted, not revoked) — expired ones included so they can be replaced. */
export async function listOpenInvitations(db: Db, ownerId: string, tripId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select(invitationColumns)
    .from(tripInvitations)
    .where(
      and(
        eq(tripInvitations.trip_id, tripId),
        eq(tripInvitations.owner_id, ownerId),
        isNull(tripInvitations.accepted_at),
        isNull(tripInvitations.revoked_at),
      ),
    )
    .orderBy(desc(tripInvitations.created_at));
  return rows as InvitationRow[];
}

export type InvitationIssued = { ok: true; id: string; token: string; email: string | null; role: InviteRole; expires_at: string };
export type InvitationRefused = {
  ok: false;
  reason:
    | "not_found"
    | "rate_limited"
    | "too_many_pending"
    | "too_many_members"
    | "already_member"
    | "already_invited"
    | "is_owner"
    | "cooldown"
    | "too_many_sends";
  invitationId?: string;
};

const openInvitation = and(isNull(tripInvitations.accepted_at), isNull(tripInvitations.revoked_at));
const stillValid = sql`${tripInvitations.expires_at} > now()`;

async function lockOwnedTrip(tx: Tx, ownerId: string, tripId: string) {
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
    .for("update");
  return trip ?? null;
}

/**
 * Creates an invitation (email-bound when `email` is given, otherwise a
 * single-use copied link). The trip row is locked, so the limits below hold
 * under concurrent clicks. Returns the raw token exactly once.
 */
export async function createInvitation(
  db: Db,
  input: {
    ownerId: string;
    tripId: string;
    invitedBy: string;
    inviterName: string;
    email: string | null;
    role: InviteRole;
  },
): Promise<InvitationIssued | InvitationRefused> {
  // One normalization everywhere (trim + lower-case), whatever the caller passed.
  const email = input.email ? normalizeEmail(input.email) : null;
  return db.transaction(async (tx) => {
    if (!(await lockOwnedTrip(tx, input.ownerId, input.tripId))) return { ok: false, reason: "not_found" } as const;

    const [{ recent }] = await tx
      .select({ recent: count() })
      .from(tripInvitations)
      .where(
        and(
          eq(tripInvitations.trip_id, input.tripId),
          sql`${tripInvitations.created_at} > now() - interval '1 hour'`,
        ),
      );
    if (recent >= INVITE_CREATE_LIMIT_PER_HOUR) return { ok: false, reason: "rate_limited" } as const;

    const [{ pending }] = await tx
      .select({ pending: count() })
      .from(tripInvitations)
      .where(and(eq(tripInvitations.trip_id, input.tripId), openInvitation, stillValid));
    if (pending >= MAX_PENDING_INVITATIONS) return { ok: false, reason: "too_many_pending" } as const;
    if ((await countMembers(tx as unknown as Db, input.ownerId, input.tripId)) >= MAX_MEMBERS_PER_TRIP) {
      return { ok: false, reason: "too_many_members" } as const;
    }

    if (email) {
      const [ownerProfile] = await tx
        .select({ email: userProfiles.email })
        .from(userProfiles)
        .where(eq(userProfiles.user_id, input.ownerId));
      if (ownerProfile?.email?.toLowerCase() === email) return { ok: false, reason: "is_owner" } as const;

      const [member] = await tx
        .select({ id: tripMembers.id })
        .from(tripMembers)
        .innerJoin(userProfiles, eq(userProfiles.user_id, tripMembers.user_id))
        .where(and(eq(tripMembers.trip_id, input.tripId), sql`lower(${userProfiles.email}) = ${email}`))
        .limit(1);
      if (member) return { ok: false, reason: "already_member" } as const;

      const [existing] = await tx
        .select({ id: tripInvitations.id })
        .from(tripInvitations)
        .where(
          and(eq(tripInvitations.trip_id, input.tripId), eq(tripInvitations.email, email), openInvitation, stillValid),
        )
        .limit(1);
      if (existing) return { ok: false, reason: "already_invited", invitationId: existing.id } as const;
    }

    const token = newInviteToken();
    const [row] = await tx
      .insert(tripInvitations)
      .values({
        trip_id: input.tripId,
        owner_id: input.ownerId,
        invited_by: input.invitedBy,
        inviter_name: input.inviterName.slice(0, 120) || "A traveler",
        email,
        role: input.role,
        token_hash: hashInviteToken(token),
        expires_at: sql`now() + make_interval(days => ${INVITE_TTL_DAYS})`,
      })
      .returning({ id: tripInvitations.id, expires_at: tripInvitations.expires_at });
    return { ok: true, id: row.id, token, email, role: input.role, expires_at: row.expires_at } as const;
  });
}

/**
 * Replaces an open invitation's token (resend, or "new link"): the previous
 * link stops working immediately and the 7 days start again. For an email
 * resend (`forEmail`) a short cooldown and a per-invitation cap apply.
 */
export async function rotateInvitation(
  db: Db,
  input: { ownerId: string; tripId: string; invitationId: string; forEmail: boolean },
): Promise<InvitationIssued | InvitationRefused> {
  return db.transaction(async (tx) => {
    if (!(await lockOwnedTrip(tx, input.ownerId, input.tripId))) return { ok: false, reason: "not_found" } as const;
    const [inv] = await tx
      .select()
      .from(tripInvitations)
      .where(
        and(
          eq(tripInvitations.id, input.invitationId),
          eq(tripInvitations.trip_id, input.tripId),
          eq(tripInvitations.owner_id, input.ownerId),
          openInvitation,
        ),
      )
      .for("update");
    if (!inv) return { ok: false, reason: "not_found" } as const;
    if (input.forEmail) {
      if (inv.send_count >= 10) return { ok: false, reason: "too_many_sends" } as const;
      if (inv.last_sent_at && Date.now() - new Date(inv.last_sent_at).getTime() < INVITE_RESEND_COOLDOWN_MS) {
        return { ok: false, reason: "cooldown" } as const;
      }
    }
    const token = newInviteToken();
    const [row] = await tx
      .update(tripInvitations)
      .set({
        token_hash: hashInviteToken(token),
        expires_at: sql`now() + make_interval(days => ${INVITE_TTL_DAYS})`,
        delivery_status: "not_sent",
      })
      .where(eq(tripInvitations.id, inv.id))
      .returning({ expires_at: tripInvitations.expires_at });
    return { ok: true, id: inv.id, token, email: inv.email, role: inv.role as InviteRole, expires_at: row.expires_at } as const;
  });
}

/** Records what happened to the email. Only the token that was actually sent may update it. */
export async function recordDelivery(
  db: Db,
  input: { ownerId: string; tripId: string; invitationId: string; token: string; status: "sent" | "failed" | "not_configured" },
) {
  await db
    .update(tripInvitations)
    .set({
      delivery_status: input.status,
      ...(input.status === "sent" ? { last_sent_at: sql`now()` } : {}),
      send_count: sql`${tripInvitations.send_count} + ${input.status === "not_configured" ? 0 : 1}`,
    })
    .where(
      and(
        eq(tripInvitations.id, input.invitationId),
        eq(tripInvitations.trip_id, input.tripId),
        eq(tripInvitations.owner_id, input.ownerId),
        eq(tripInvitations.token_hash, hashInviteToken(input.token)),
      ),
    );
}

export async function revokeInvitation(db: Db, ownerId: string, tripId: string, invitationId: string) {
  const rows = await db
    .update(tripInvitations)
    .set({ revoked_at: sql`now()` })
    .where(
      and(
        eq(tripInvitations.id, invitationId),
        eq(tripInvitations.trip_id, tripId),
        eq(tripInvitations.owner_id, ownerId),
        openInvitation,
      ),
    )
    .returning({ id: tripInvitations.id });
  return rows.length === 1;
}

/* ---------------------- invitation page + accept --------------------- */

export type InvitationPreview = {
  state: "pending" | "expired" | "revoked" | "accepted";
  role: InviteRole;
  inviter_name: string;
  trip: { id: string; title: string; start_date: string; end_date: string };
  /** Masked — never the full address — and only present for email-bound invitations. */
  email_hint: string | null;
  email_bound: boolean;
  accepted_by: string | null;
  invited_by: string;
  owner_id: string;
  email: string | null;
  id: string;
};

/**
 * Minimal preview by token hash: trip title and dates, inviter, role.
 * Nothing from the plan, bookings or members. null = unknown token.
 */
export async function previewInvitation(db: Db, tokenHash: string): Promise<InvitationPreview | null> {
  return previewWhere(db, eq(tripInvitations.token_hash, tokenHash));
}

/** The same preview addressed by invitation id — for the signed-in invitation page. The caller decides who may see it. */
export async function previewInvitationById(db: Db, invitationId: string): Promise<InvitationPreview | null> {
  return previewWhere(db, eq(tripInvitations.id, invitationId));
}

async function previewWhere(db: Db, where: SQL): Promise<InvitationPreview | null> {
  const [row] = await db
    .select({
      inv: tripInvitations,
      expired: sql<boolean>`${tripInvitations.expires_at} <= now()`,
      title: trips.title,
      start_date: trips.start_date,
      end_date: trips.end_date,
    })
    .from(tripInvitations)
    .innerJoin(trips, and(eq(trips.id, tripInvitations.trip_id), eq(trips.owner_id, tripInvitations.owner_id)))
    .where(where)
    .limit(1);
  if (!row) return null;
  const { inv } = row;
  return {
    state: inv.accepted_at ? "accepted" : inv.revoked_at ? "revoked" : row.expired ? "expired" : "pending",
    role: inv.role as InviteRole,
    inviter_name: inv.inviter_name,
    trip: { id: inv.trip_id, title: row.title, start_date: row.start_date, end_date: row.end_date },
    email_hint: inv.email ? maskEmail(inv.email) : null,
    email_bound: inv.email !== null,
    accepted_by: inv.accepted_by,
    invited_by: inv.invited_by,
    owner_id: inv.owner_id,
    email: inv.email,
    id: inv.id,
  };
}

export type AcceptResult =
  | { status: "ok"; tripId: string; role: InviteRole }
  | { status: "accepted_by_you" | "already_member" | "owner"; tripId: string }
  | { status: "invalid" | "revoked" | "expired" | "accepted_by_other" | "unverified_email" | "too_many_members" }
  | { status: "wrong_account"; hint: string };

/**
 * Accepts an invitation as the verified user. One transaction with the
 * invitation row locked, so two simultaneous clicks (same person or
 * different people) cannot both succeed or create duplicate memberships.
 *
 * `verifiedEmail` is the normalized email the sign-in provider vouches for
 * (null when absent or unverified) — never a value from the browser.
 */
export async function acceptInvitation(
  db: Db,
  input: {
    /** Exactly one of these: the link's token hash, or (email-bound invitations only) the invitation id from the signed-in page. */
    tokenHash?: string;
    invitationId?: string;
    userId: string;
    /** Shown to the owner in "… joined the trip". From the verified session. */
    userName?: string;
    verifiedEmail: string | null;
    emailUnverified: boolean;
  },
): Promise<AcceptResult> {
  return db.transaction(async (tx): Promise<AcceptResult> => {
    const [found] = await tx
      .select({ inv: tripInvitations, expired: sql<boolean>`${tripInvitations.expires_at} <= now()` })
      .from(tripInvitations)
      .where(input.invitationId ? eq(tripInvitations.id, input.invitationId) : eq(tripInvitations.token_hash, input.tokenHash ?? ""))
      .for("update");
    if (!found) return { status: "invalid" };
    const { inv, expired } = found;
    // An id is not a secret: it may only ever accept an invitation that is bound to the verified email below.
    if (input.invitationId && !inv.email) return { status: "invalid" };

    if (inv.accepted_at) {
      return inv.accepted_by === input.userId
        ? { status: "accepted_by_you", tripId: inv.trip_id }
        : { status: "accepted_by_other" };
    }
    if (inv.revoked_at) return { status: "revoked" };
    if (expired) return { status: "expired" };

    // The trip must still exist under the same owner (cascade removes invitations with it).
    const [trip] = await tx
      .select({ id: trips.id, title: trips.title })
      .from(trips)
      .where(and(eq(trips.id, inv.trip_id), eq(trips.owner_id, inv.owner_id)))
      .for("share");
    if (!trip) return { status: "invalid" };

    if (inv.owner_id === input.userId) return { status: "owner", tripId: inv.trip_id };

    if (inv.email) {
      if (input.emailUnverified || !input.verifiedEmail) return { status: "unverified_email" };
      if (input.verifiedEmail !== inv.email) return { status: "wrong_account", hint: maskEmail(inv.email) };
    }

    const [existing] = await tx
      .select({ id: tripMembers.id })
      .from(tripMembers)
      .where(and(eq(tripMembers.trip_id, inv.trip_id), eq(tripMembers.user_id, input.userId)));
    if (existing) return { status: "already_member", tripId: inv.trip_id };

    if ((await countMembers(tx as unknown as Db, inv.owner_id, inv.trip_id)) >= MAX_MEMBERS_PER_TRIP) {
      return { status: "too_many_members" };
    }

    await tx
      .insert(tripMembers)
      .values({
        trip_id: inv.trip_id,
        owner_id: inv.owner_id,
        user_id: input.userId,
        role: inv.role,
        invited_by: inv.invited_by,
      })
      .onConflictDoNothing({ target: [tripMembers.trip_id, tripMembers.user_id] });
    await tx
      .update(tripInvitations)
      .set({ accepted_at: sql`now()`, accepted_by: input.userId })
      .where(eq(tripInvitations.id, inv.id));
    // Same transaction as the membership: the owner hears about it if and only if it happened.
    await safely(tx, "invitation_accepted", (n) =>
      createNotifications(n, [
        invitationAcceptedDraft({
          ownerId: inv.owner_id,
          tripId: inv.trip_id,
          invitationId: inv.id,
          acceptorId: input.userId,
          acceptorName: input.userName ?? "",
          tripTitle: trip.title,
          role: inv.role as InviteRole,
        }),
      ]),
    );
    return { status: "ok", tripId: inv.trip_id, role: inv.role as InviteRole };
  });
}

/* ---------------------------- row changes --------------------------- */

export type ChangeKind = "itinerary" | "place" | "booking" | "packing";

const CHANGE_TABLES = {
  itinerary: itineraryItems,
  place: places,
  booking: reservations,
  packing: packingItems,
} as const;

/** When a record last changed and by whom — for the "someone else edited this" message. */
export async function rowChange(db: Db, ownerId: string, tripId: string, kind: ChangeKind, id: string) {
  const t = CHANGE_TABLES[kind];
  const [row] = await db
    .select({ updated_at: t.updated_at, updated_by: t.updated_by })
    .from(t)
    .where(and(eq(t.id, id), eq(t.trip_id, tripId), eq(t.owner_id, ownerId)));
  return row ?? null;
}

/* ------------------------- change detection ------------------------ */

const VERSIONED_TABLES = [
  "reservations",
  "documents",
  "places",
  "itinerary_items",
  "packing_categories",
  "packing_items",
  "trip_memories",
  "trip_members",
  "polls",
  "poll_votes",
] as const;

/**
 * A cheap fingerprint of everything shared on a trip (row counts and the
 * latest change per table). The browser polls it and refreshes only when it
 * changes. Contains no trip content. Call only after the access check.
 */
export async function tripVersion(db: Db, ownerId: string, tripId: string): Promise<string> {
  const parts = VERSIONED_TABLES.map(
    (table) =>
      sql`(select count(*) || ':' || coalesce(max(updated_at)::text, '') from ${sql.raw(table)} where trip_id = ${tripId} and owner_id = ${ownerId})`,
  );
  const result = await db.execute<{ v: string }>(
    sql`select md5(concat_ws('|', ${sql.join(parts, sql`, `)}, (select updated_at::text from trips where id = ${tripId} and owner_id = ${ownerId}))) as v`,
  );
  return result.rows[0].v;
}
