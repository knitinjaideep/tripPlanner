import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { createNotifications } from "./notifications";
import { isGroupAllowed } from "./settings";
import { listPolls } from "./polls";
import * as q from "./queries";
import { resolveTripAccess } from "./sharing";
import {
  eveningPreviewDeliveries,
  eveningPreviewPrefs,
  itineraryItems,
  schedulerHeartbeats,
  trips,
  userProfiles,
} from "./schema";
import type { PreviewSender } from "@/lib/email/evening-email";
import {
  CLAIM_LEASE_MINUTES,
  DEFAULT_SEND_TIME,
  HEARTBEAT_FRESH_MINUTES,
  MAX_EMAIL_ATTEMPTS,
  composePreview,
  evaluateSchedule,
  isSendTime,
  selectPoll,
  type PreviewContent,
} from "@/lib/evening-preview";
import { dedupeKeys } from "@/lib/notifications";
import { buildAgenda } from "@/lib/schedule";
import { zonedInstant } from "@/lib/time-zones";
import type { TripRole } from "@/lib/sharing";

/**
 * Evening preview: preferences, the preview builder, and the worker that
 * delivers on schedule. The worker is idempotent by construction: every
 * delivery is a row in `evening_preview_deliveries` keyed by (trip, person,
 * target date, channel), and claiming that row is what allows a send. Two
 * workers at once, a crash and restart, or a retry all end with at most one
 * inbox notification, and a bounded, idempotency-keyed email effort.
 *
 * Like the other db modules it is only reached from src/lib/dal.ts (and from
 * scripts that use a disposable database directly).
 */

export const JOB_NAME = "evening-preview";

/* ------------------------------ preferences ------------------------------ */

export type EveningPrefs = { enabled: boolean; send_time: string; in_app: boolean; email: boolean };
export const DEFAULT_PREFS: EveningPrefs = { enabled: false, send_time: DEFAULT_SEND_TIME, in_app: true, email: false };

export async function getPrefs(db: Db, tripId: string, userId: string): Promise<EveningPrefs> {
  const [row] = await db
    .select()
    .from(eveningPreviewPrefs)
    .where(and(eq(eveningPreviewPrefs.trip_id, tripId), eq(eveningPreviewPrefs.user_id, userId)));
  return row ? { enabled: row.enabled, send_time: row.send_time.slice(0, 5), in_app: row.in_app, email: row.email } : DEFAULT_PREFS;
}

export type PrefsInput = EveningPrefs;

/** Saves the caller's own preference for this trip. `ownerId` is the trip's real owner (from the verified access check). */
export async function savePrefs(db: Db, ownerId: string, tripId: string, userId: string, input: PrefsInput): Promise<boolean> {
  if (!isSendTime(input.send_time) || (!input.in_app && !input.email)) return false;
  await db
    .insert(eveningPreviewPrefs)
    .values({ trip_id: tripId, owner_id: ownerId, user_id: userId, enabled: input.enabled, send_time: `${input.send_time.slice(0, 5)}:00`, in_app: input.in_app, email: input.email })
    .onConflictDoUpdate({
      target: [eveningPreviewPrefs.trip_id, eveningPreviewPrefs.user_id],
      set: { enabled: input.enabled, send_time: `${input.send_time.slice(0, 5)}:00`, in_app: input.in_app, email: input.email, updated_at: sql`now()` },
    });
  return true;
}

export async function deletePrefsFor(db: Db, tripId: string, userId: string) {
  await db.delete(eveningPreviewPrefs).where(and(eq(eveningPreviewPrefs.trip_id, tripId), eq(eveningPreviewPrefs.user_id, userId)));
}

export async function profileEmail(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ email: userProfiles.email }).from(userProfiles).where(eq(userProfiles.user_id, userId));
  return row?.email ?? null;
}

/** Has the scheduled job run recently? (The app never claims scheduled delivery is active without this.) */
export async function schedulerStatus(db: Db, now = new Date()): Promise<{ active: boolean; lastRunAt: string | null }> {
  const [row] = await db.select().from(schedulerHeartbeats).where(eq(schedulerHeartbeats.job, JOB_NAME));
  const last = row?.last_finished_at ?? null;
  return { active: last !== null && now.getTime() - Date.parse(last) < HEARTBEAT_FRESH_MINUTES * 60_000, lastRunAt: last };
}

/* --------------------------------- content --------------------------------- */

/**
 * The preview for one person, trip and date, from the CURRENT saved data.
 * Read-only: used for the on-screen sample, dry runs and real delivery alike.
 * null = no access to the trip.
 */
export async function buildPreview(db: Db, tripId: string, userId: string, targetDate: string, now: Date): Promise<PreviewContent | null> {
  const access = await resolveTripAccess(db, userId, tripId);
  if (!access) return null;
  const trip = await q.getTripWithDetails(db, access.ownerId, tripId);
  const items = await q.listItinerary(db, access.ownerId, tripId);
  if (!trip || !items) return null;
  const agenda = buildAgenda({ items, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date, includeCancelled: false });
  const entries = agenda.days.find((d) => d.date === targetDate)?.entries ?? [];

  const polls = await listPolls(db, { userId, ownerId: access.ownerId, role: access.role as TripRole }, tripId);
  // "Before the thing it is about": the activity's own start, the day's start, or the place's earliest planned visit.
  const itemTimes = new Map<string, { date: string | null; time: string | null; tz: string | null }>();
  const rows = polls.some((p) => p.parent.item)
    ? await db
        .select({ id: itineraryItems.id, date: itineraryItems.local_date, time: itineraryItems.local_start_time, tz: itineraryItems.timezone })
        .from(itineraryItems)
        .where(and(eq(itineraryItems.trip_id, tripId), inArray(itineraryItems.id, polls.flatMap((p) => (p.parent.item ? [p.parent.item.id] : [])))))
    : [];
  for (const r of rows) itemTimes.set(r.id, { date: r.date, time: r.time, tz: r.tz });
  const placeIds = polls.flatMap((p) => (p.parent.place ? [p.parent.place.id] : []));
  const visits = placeIds.length
    ? await db
        .select({ place_id: itineraryItems.place_id, date: itineraryItems.local_date })
        .from(itineraryItems)
        .where(and(eq(itineraryItems.trip_id, tripId), inArray(itineraryItems.place_id, placeIds), eq(itineraryItems.status, "planned")))
    : [];
  const relevantStart = (p: (typeof polls)[number]) => {
    if (p.parent.type === "day" && p.parent.day) return zonedInstant(p.parent.day, "00:00", trip.time_zone);
    if (p.parent.item) {
      const t = itemTimes.get(p.parent.item.id);
      return t?.date ? zonedInstant(t.date, t.time ? t.time.slice(0, 5) : "00:00", t.tz ?? trip.time_zone) : null;
    }
    if (p.parent.place) {
      const dates = visits.filter((v) => v.place_id === p.parent.place!.id && v.date).map((v) => v.date!).sort();
      return dates[0] ? zonedInstant(dates[0], "00:00", trip.time_zone) : null;
    }
    return null;
  };
  const poll = selectPoll(polls, { targetDate, nowMs: now.getTime(), relevantStart });
  return composePreview({
    tripId,
    tripTitle: trip.title,
    destination: trip.destination,
    timeZone: trip.time_zone,
    targetDate,
    entries,
    poll,
    now,
  });
}

/* ---------------------------------- worker ---------------------------------- */

export type DryItem = { tripId: string; userId: string; targetDate: string; channels: string[]; title: string; body: string; href: string };

export type RunReport = {
  considered: number;
  due: number;
  inAppCreated: number;
  inAppDuplicate: number;
  emailSent: number;
  emailFailed: number;
  emailRetryLater: number;
  emailUnavailable: number;
  skippedStale: number;
  skippedNotMember: number;
  /** The person's account Settings have evening previews turned off. */
  skippedSettingsOff: number;
  skippedEmpty: number;
  errors: number;
  dryRun: boolean;
  items: DryItem[];
};

const emptyReport = (dryRun: boolean): RunReport => ({
  considered: 0, due: 0, inAppCreated: 0, inAppDuplicate: 0, emailSent: 0, emailFailed: 0, emailRetryLater: 0, emailUnavailable: 0,
  skippedStale: 0, skippedNotMember: 0, skippedSettingsOff: 0, skippedEmpty: 0, errors: 0, dryRun, items: [],
});

type Candidate = {
  trip_id: string; owner_id: string; user_id: string; send_time: string; in_app: boolean; email: boolean;
  time_zone: string; start_date: string; end_date: string;
};

/**
 * One pass of the scheduled job. Safe to run as often as you like, from many
 * workers at once: it only ever acts on "tomorrow" on each trip's own
 * calendar, inside that trip's delivery window, for people who are opted in
 * AND still on the trip right now.
 *
 * `dryRun` reads and composes but writes nothing and sends nothing.
 * `only` narrows a run to one trip / person (used by dry runs and tests).
 */
export async function runEveningPreviews(
  db: Db,
  opts: { now?: Date; email?: PreviewSender | null; dryRun?: boolean; only?: { tripId?: string; userId?: string } } = {},
): Promise<RunReport> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const report = emptyReport(dryRun);
  if (!dryRun) {
    await db
      .insert(schedulerHeartbeats)
      .values({ job: JOB_NAME, last_started_at: now.toISOString() })
      .onConflictDoUpdate({ target: schedulerHeartbeats.job, set: { last_started_at: now.toISOString() } });
  }

  const dayMs = 86_400_000;
  const candidates: Candidate[] = (
    await db
      .select({
        trip_id: eveningPreviewPrefs.trip_id, owner_id: eveningPreviewPrefs.owner_id, user_id: eveningPreviewPrefs.user_id,
        send_time: eveningPreviewPrefs.send_time, in_app: eveningPreviewPrefs.in_app, email: eveningPreviewPrefs.email,
        time_zone: trips.time_zone, start_date: trips.start_date, end_date: trips.end_date,
      })
      .from(eveningPreviewPrefs)
      .innerJoin(trips, and(eq(trips.id, eveningPreviewPrefs.trip_id), eq(trips.owner_id, eveningPreviewPrefs.owner_id)))
      .where(
        and(
          eq(eveningPreviewPrefs.enabled, true),
          // A generous window around "now" in any zone; the exact check is per trip below.
          sql`${trips.end_date} >= ${new Date(now.getTime() - 2 * dayMs).toISOString().slice(0, 10)}::date`,
          sql`${trips.start_date} <= ${new Date(now.getTime() + 3 * dayMs).toISOString().slice(0, 10)}::date`,
          opts.only?.tripId ? eq(eveningPreviewPrefs.trip_id, opts.only.tripId) : undefined,
          opts.only?.userId ? eq(eveningPreviewPrefs.user_id, opts.only.userId) : undefined,
        ),
      )
      .limit(5000)
  ).map((r) => ({ ...r, send_time: r.send_time.slice(0, 5) }));

  for (const c of candidates) {
    report.considered++;
    const decision = evaluateSchedule({ now, timeZone: c.time_zone, sendTime: c.send_time, tripStart: c.start_date, tripEnd: c.end_date });
    if (decision.state === "outside" || decision.state === "not_due") continue;
    const channels = [c.in_app ? "in_app" : null, c.email && opts.email ? "email" : null].filter((x): x is string => x !== null);
    if (c.email && !opts.email) report.emailUnavailable++;

    if (decision.state === "stale") {
      // Too late to be useful: record it once so it is never sent late and never retried.
      report.skippedStale++;
      if (!dryRun) {
        for (const channel of channels) {
          await db.execute(sql`
            insert into evening_preview_deliveries (trip_id, owner_id, user_id, target_date, channel, status, reason, scheduled_for)
            values (${c.trip_id}, ${c.owner_id}, ${c.user_id}, ${decision.targetDate}, ${channel}, 'skipped', 'stale', ${decision.scheduledFor})
            on conflict (trip_id, user_id, target_date, channel) do update
              set status = 'skipped', reason = 'stale', updated_at = now()
              where evening_preview_deliveries.status in ('pending', 'failed')
                 or (evening_preview_deliveries.status = 'sending' and evening_preview_deliveries.locked_until < now())`);
        }
      }
      continue;
    }

    // Due. Membership is checked now, not when the preference was saved.
    const access = await resolveTripAccess(db, c.user_id, c.trip_id);
    if (!access) {
      report.skippedNotMember++;
      continue;
    }
    // Their own Settings are the global gate: with evening previews off nothing is claimed, so nothing is
    // recorded either and turning it back on within the window still sends it.
    if (!(await isGroupAllowed(db, c.user_id, "evening_preview"))) {
      report.skippedSettingsOff++;
      continue;
    }
    report.due++;

    if (dryRun) {
      const preview = await buildPreview(db, c.trip_id, c.user_id, decision.targetDate, now);
      if (preview) report.items.push({ tripId: c.trip_id, userId: c.user_id, targetDate: decision.targetDate, channels, title: preview.title, body: preview.body, href: preview.href });
      continue;
    }

    // One person's problem never stops the rest of the run.
    try {
      if (c.in_app) {
        const outcome = await deliverInApp(db, c, decision.targetDate, decision.scheduledFor, now);
        if (outcome === "created") report.inAppCreated++;
        else if (outcome === "duplicate") report.inAppDuplicate++;
        else report.skippedNotMember++;
      }
    } catch (error) {
      report.errors++;
      console.error("[rove] evening preview (in-app) failed:", (error as { code?: string })?.code ?? (error as Error)?.name);
    }
    try {
      if (c.email && opts.email) {
        const outcome = await deliverEmail(db, c, decision.targetDate, decision.scheduledFor, now, opts.email);
        if (outcome === "sent") report.emailSent++;
        else if (outcome === "failed" || outcome === "exhausted") report.emailFailed++;
        else if (outcome === "claimed_elsewhere") report.emailRetryLater++;
        else report.skippedNotMember++;
      }
    } catch (error) {
      report.errors++;
      console.error("[rove] evening preview (email) failed:", (error as { code?: string })?.code ?? (error as Error)?.name);
    }
  }

  if (!dryRun) {
    await db
      .update(schedulerHeartbeats)
      .set({
        last_finished_at: new Date().toISOString(),
        last_result: { considered: report.considered, due: report.due, inAppCreated: report.inAppCreated, emailSent: report.emailSent, emailFailed: report.emailFailed, skippedStale: report.skippedStale },
      })
      .where(eq(schedulerHeartbeats.job, JOB_NAME));
  }
  return report;
}

/**
 * In-app delivery: the ledger row and the notification commit in ONE
 * transaction, together or not at all. A second worker (or a
 * rerun) hits the unique key and does nothing; a crash before commit leaves
 * nothing behind, so the next run simply tries again.
 */
async function deliverInApp(db: Db, c: Candidate, targetDate: string, scheduledFor: string | null, now: Date): Promise<"created" | "duplicate" | "skipped"> {
  // Cheap exit for the common case (every later run of the evening): already recorded.
  const [done] = await db
    .select({ id: eveningPreviewDeliveries.id })
    .from(eveningPreviewDeliveries)
    .where(and(eq(eveningPreviewDeliveries.trip_id, c.trip_id), eq(eveningPreviewDeliveries.user_id, c.user_id), eq(eveningPreviewDeliveries.target_date, targetDate), eq(eveningPreviewDeliveries.channel, "in_app")));
  if (done) return "duplicate";
  const preview = await buildPreview(db, c.trip_id, c.user_id, targetDate, now);
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(eveningPreviewDeliveries)
      .values({ trip_id: c.trip_id, owner_id: c.owner_id, user_id: c.user_id, target_date: targetDate, channel: "in_app", status: "sent", sent_at: now.toISOString(), scheduled_for: scheduledFor, attempts: 1 })
      .onConflictDoNothing()
      .returning({ id: eveningPreviewDeliveries.id });
    if (claimed.length === 0) return "duplicate";
    const created = preview
      ? await createNotifications(tx, [
          {
            type: "evening_preview",
            recipientId: c.user_id,
            actorId: null,
            tripId: c.trip_id,
            date: targetDate,
            pollId: preview.poll?.reason === "closing_soon" ? preview.poll.id : null,
            dedupeKey: dedupeKeys.eveningPreview(c.trip_id, targetDate),
            title: preview.title,
            body: preview.body,
          },
        ])
      : 0;
    if (created === 0) {
      await tx.update(eveningPreviewDeliveries).set({ status: "skipped", reason: preview ? "already_notified" : "no_access", sent_at: null }).where(eq(eveningPreviewDeliveries.id, claimed[0].id));
      return preview ? "duplicate" : "skipped";
    }
    return "created";
  });
}

type EmailOutcome = "sent" | "failed" | "claimed_elsewhere" | "no_address" | "withdrawn" | "exhausted";

/**
 * Email: claim the ledger row (a short lease), re-check the preference and
 * membership, send with an idempotency key, then record the result. A failed
 * attempt is retried by later runs (up to MAX_EMAIL_ATTEMPTS) while the
 * preview is still within its window. If the process dies after the provider
 * accepted but before we record it, the lease expires and the retry carries
 * the same idempotency key — which the provider dedupes within its own
 * window; beyond that, email is at-least-once, not exactly-once.
 */
async function deliverEmail(db: Db, c: Candidate, targetDate: string, scheduledFor: string | null, now: Date, send: PreviewSender): Promise<EmailOutcome> {
  const claim = await db.execute<{ id: string; attempts: number }>(sql`
    insert into evening_preview_deliveries (trip_id, owner_id, user_id, target_date, channel, status, attempts, locked_until, scheduled_for)
    values (${c.trip_id}, ${c.owner_id}, ${c.user_id}, ${targetDate}, 'email', 'sending', 1, now() + make_interval(mins => ${CLAIM_LEASE_MINUTES}), ${scheduledFor})
    on conflict (trip_id, user_id, target_date, channel) do update
      set status = 'sending', attempts = evening_preview_deliveries.attempts + 1,
          locked_until = now() + make_interval(mins => ${CLAIM_LEASE_MINUTES}), updated_at = now()
      where evening_preview_deliveries.attempts < ${MAX_EMAIL_ATTEMPTS}
        and (evening_preview_deliveries.status = 'failed'
             or (evening_preview_deliveries.status in ('pending', 'sending') and evening_preview_deliveries.locked_until < now()))
    returning id, attempts`);
  const row = claim.rows[0];
  if (!row) return "claimed_elsewhere";
  const finish = (status: "sent" | "failed" | "skipped", reason: string | null) =>
    db.execute(sql`update evening_preview_deliveries set status = ${status}, reason = ${reason}, sent_at = ${status === "sent" ? sql`now()` : sql`null`}, locked_until = null, updated_at = now() where id = ${row.id}`);

  // The person may have opted out, or left the trip, since the run began.
  const [still] = await db
    .select({ email: eveningPreviewPrefs.email, enabled: eveningPreviewPrefs.enabled })
    .from(eveningPreviewPrefs)
    .where(and(eq(eveningPreviewPrefs.trip_id, c.trip_id), eq(eveningPreviewPrefs.user_id, c.user_id)));
  if (!still?.enabled || !still.email || !(await resolveTripAccess(db, c.user_id, c.trip_id))) {
    await finish("skipped", "withdrawn");
    return "withdrawn";
  }
  const to = await profileEmail(db, c.user_id);
  if (!to) {
    await finish("skipped", "no_address");
    return "no_address";
  }
  const preview = await buildPreview(db, c.trip_id, c.user_id, targetDate, now);
  if (!preview) {
    await finish("skipped", "no_access");
    return "withdrawn";
  }
  const result = await send({ to, content: preview, tripId: c.trip_id, idempotencyKey: `evening-preview:${c.trip_id}:${c.user_id}:${targetDate}` });
  if (result === "sent") {
    await finish("sent", null);
    return "sent";
  }
  await finish(row.attempts >= MAX_EMAIL_ATTEMPTS ? "skipped" : "failed", row.attempts >= MAX_EMAIL_ATTEMPTS ? "provider_failed" : "provider_error");
  return row.attempts >= MAX_EMAIL_ATTEMPTS ? "exhausted" : "failed";
}

