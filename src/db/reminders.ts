import "server-only";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import { createNotifications } from "./notifications";
import { isGroupAllowed } from "./settings";
import {
  itineraryItems,
  packingItems,
  places,
  reminderPrefs,
  reminders,
  reservations,
  schedulerHeartbeats,
  tripMembers,
  trips,
  userProfiles,
  type ReminderRow,
} from "./schema";
import type { ReminderSender } from "@/lib/email/reminder-email";
import { dedupeKeys } from "@/lib/notifications";
import { placeMapsUrl } from "@/lib/itinerary-format";
import {
  CLAIM_LEASE_MINUTES,
  DEFAULT_TASK_TIME,
  HEARTBEAT_FRESH_MINUTES,
  MAX_DELIVERY_ATTEMPTS,
  MAX_EMAIL_ATTEMPTS,
  REVIVABLE,
  addDays,
  buildRule,
  bookingTarget,
  bookingText,
  describeRule,
  expiresAt,
  isClockTime,
  limitMs,
  planDelivery,
  planFire,
  planSnooze,
  previewSentence,
  quietFrom,
  snoozeChoices,
  taskTarget,
  taskText,
  zoneName,
  formatInstant,
  type EmailStatus,
  type FirePlan,
  type MemberChoice,
  type PresetChoice,
  type ReminderPreset,
  type RuleInput,
  type ReminderReason,
  type ReminderRule,
  type ReminderStatus,
  type ReminderSubject,
  type ReminderView,
  type Target,
} from "@/lib/reminders";
import { isValidTimeZone, zonedInstant } from "@/lib/time-zones";
import type { EmailAvailability, OverviewRow, ReminderPanel, ReminderPrefs } from "@/lib/reminders";

export type { EmailAvailability, OverviewRow, ReminderPanel, ReminderPrefs };

/**
 * Reminders: persistence, scheduling and delivery.
 *
 * One table (`reminders`) is both the configuration and the job. Everything
 * that can change what should happen — a booking edit, a task completion or
 * reassignment, a member leaving, a person's own settings — goes through one
 * function, `reconcileRow`, which recomputes what SHOULD happen from the live
 * record and brings the row in line (cancel, reschedule with a new
 * `occurrence`, or leave it). The worker uses the very same function inside
 * its delivery transaction, so a stale job can never be delivered: delivery
 * re-reads the record, membership and preferences under a row lock and
 * refuses unless the stored `target_at` still matches.
 *
 * Like the other db modules this is only reached from src/lib/dal.ts (and from
 * test scripts that use a disposable database directly).
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;
type ReservationRow = typeof reservations.$inferSelect;
type PackingRow = typeof packingItems.$inferSelect;

export const JOB_NAME = "reminders";

/* ------------------------------ helpers ------------------------------ */

/** Parses a Postgres timestamptz string ("2026-10-16 15:00:00+00" or ISO) to epoch ms; null stays null. */
export function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const fixed = /[+-]\d\d$/.test(iso) ? `${iso}:00` : iso;
  const t = Date.parse(fixed);
  return Number.isNaN(t) ? null : t;
}
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const hm = (t: string) => t.slice(0, 5);

async function isCurrentMember(db: Executor, tripId: string, userId: string): Promise<boolean> {
  const [r] = await db
    .select({ one: sql<number>`1` })
    .from(trips)
    .leftJoin(tripMembers, and(eq(tripMembers.trip_id, trips.id), eq(tripMembers.user_id, userId)))
    .where(and(eq(trips.id, tripId), or(eq(trips.owner_id, userId), eq(tripMembers.user_id, userId))))
    .limit(1);
  return Boolean(r);
}

async function displayNames(db: Executor, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db.select({ id: userProfiles.user_id, name: userProfiles.display_name }).from(userProfiles).where(inArray(userProfiles.user_id, ids));
  for (const r of rows) if (r.name) map.set(r.id, r.name);
  return map;
}

export async function profileEmail(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db.select({ email: userProfiles.email }).from(userProfiles).where(eq(userProfiles.user_id, userId));
  return row?.email ?? null;
}

/* ------------------------------ preferences ------------------------------ */

export const DEFAULT_PREFS: ReminderPrefs = {
  enabled: true,
  in_app: true,
  email: false,
  quiet_enabled: false,
  quiet_start: "22:00",
  quiet_end: "07:00",
  quiet_zone: null,
  default_task_time: DEFAULT_TASK_TIME,
};

const prefsFromRow = (r: typeof reminderPrefs.$inferSelect): ReminderPrefs => ({
  enabled: r.enabled,
  in_app: r.in_app,
  email: r.email,
  quiet_enabled: r.quiet_enabled,
  quiet_start: hm(r.quiet_start),
  quiet_end: hm(r.quiet_end),
  quiet_zone: r.quiet_zone,
  default_task_time: hm(r.default_task_time),
});

export async function getPrefs(db: Executor, userId: string): Promise<ReminderPrefs> {
  const [row] = await db.select().from(reminderPrefs).where(eq(reminderPrefs.user_id, userId));
  return row ? prefsFromRow(row) : DEFAULT_PREFS;
}

/**
 * The preferences reminders are planned and delivered with: the person's own
 * reminder settings, switched off while their account Settings turn this kind
 * of reminder off. The stored reminder rows are never deleted — turning the
 * Settings switch back on revives the ones still ahead, exactly like the
 * "reminders off" switch does.
 */
async function effectivePrefs(db: Executor, userId: string, subject: ReminderSubject): Promise<ReminderPrefs> {
  const [prefs, allowed] = await Promise.all([getPrefs(db, userId), isGroupAllowed(db, userId, subject === "task" ? "task_reminders" : "booking_reminders")]);
  return allowed ? prefs : { ...prefs, enabled: false };
}

export function validatePrefs(p: ReminderPrefs): string | null {
  if (!p.in_app && !p.email) return "Choose at least one way to be reminded.";
  if (!isClockTime(p.quiet_start) || !isClockTime(p.quiet_end) || !isClockTime(p.default_task_time)) return "Use times like 22:00.";
  if (p.quiet_enabled) {
    if (!p.quiet_zone || !isValidTimeZone(p.quiet_zone)) return "Choose the time zone your quiet hours are in.";
    if (p.quiet_start === p.quiet_end) return "Quiet hours need a start and an end that differ.";
  }
  return null;
}

/**
 * Saves a person's OWN settings (the caller is the verified session user —
 * never a request field), then re-evaluates their reminders: turning
 * reminders off cancels what is pending, turning them back on (or changing
 * quiet hours) reschedules.
 */
export async function savePrefs(db: Db, userId: string, input: ReminderPrefs): Promise<{ ok: true } | { ok: false; error: string }> {
  const error = validatePrefs(input);
  if (error) return { ok: false, error };
  await db.transaction(async (tx) => {
    const values = {
      user_id: userId,
      enabled: input.enabled,
      in_app: input.in_app,
      email: input.email,
      quiet_enabled: input.quiet_enabled,
      quiet_start: `${input.quiet_start}:00`,
      quiet_end: `${input.quiet_end}:00`,
      quiet_zone: input.quiet_enabled ? input.quiet_zone : (input.quiet_zone && isValidTimeZone(input.quiet_zone) ? input.quiet_zone : null),
      default_task_time: `${input.default_task_time}:00`,
    };
    await tx
      .insert(reminderPrefs)
      .values(values)
      .onConflictDoUpdate({ target: reminderPrefs.user_id, set: { ...values, updated_at: sql`now()` } });
    await syncRecipient(tx, userId);
  });
  return { ok: true };
}

/* ------------------------ subject / context loading ------------------------ */

type Subject = { kind: "booking"; res: ReservationRow } | { kind: "task"; item: PackingRow };
type Ctx = { subject: Subject | null; tripZone: string; isMember: boolean; prefs: ReminderPrefs };

async function loadCtx(db: Executor, row: ReminderRow, prefsCache?: Map<string, ReminderPrefs>): Promise<Ctx> {
  const [trip] = await db.select({ zone: trips.time_zone }).from(trips).where(and(eq(trips.id, row.trip_id), eq(trips.owner_id, row.owner_id)));
  let subject: Subject | null = null;
  if (row.reservation_id) {
    const [res] = await db.select().from(reservations).where(and(eq(reservations.id, row.reservation_id), eq(reservations.trip_id, row.trip_id)));
    if (res) subject = { kind: "booking", res };
  } else if (row.packing_item_id) {
    const [item] = await db.select().from(packingItems).where(and(eq(packingItems.id, row.packing_item_id), eq(packingItems.trip_id, row.trip_id)));
    if (item) subject = { kind: "task", item };
  }
  let prefs = prefsCache?.get(row.recipient_id);
  if (!prefs) {
    prefs = await effectivePrefs(db, row.recipient_id, row.packing_item_id ? "task" : "booking");
    prefsCache?.set(row.recipient_id, prefs);
  }
  return { subject, tripZone: trip?.zone ?? "UTC", isMember: await isCurrentMember(db, row.trip_id, row.recipient_id), prefs };
}

export const ruleOf = (r: Pick<ReminderRow, "lead_minutes" | "days_before" | "local_time">): ReminderRule =>
  r.lead_minutes !== null ? { kind: "lead", leadMinutes: r.lead_minutes } : { kind: "day", daysBefore: r.days_before!, localTime: hm(r.local_time!) };

const STICKY: ReminderReason[] = ["off", "recipient_muted", "unselected", "not_member", "reassigned", "task_unassigned", "rule_invalid", "error"];

type Desired =
  | { kind: "cancel"; reason: ReminderReason; sent: "canceled" | "completed" | null }
  | { kind: "active"; target: Target; targetMs: number; plan: FirePlan; snoozed: boolean };

const SENT_STATE: Partial<Record<ReminderReason, "canceled" | "completed">> = {
  booking_cancelled: "canceled",
  booking_unscheduled: "canceled",
  task_done: "completed",
  no_due: "canceled",
  task_unassigned: "canceled",
  reassigned: "canceled",
  not_member: "canceled",
  off: "canceled",
  unselected: "canceled",
  rule_invalid: "canceled",
};
const cancelOf = (reason: ReminderReason): Desired => ({ kind: "cancel", reason, sent: SENT_STATE[reason] ?? null });

/**
 * What SHOULD happen to this reminder, from the live record, the recipient's
 * membership and their preferences. Pure given its inputs. `delivering` = the
 * worker is about to send right now.
 */
export function evaluate(row: ReminderRow, ctx: Ctx, nowMs: number, delivering = false): Desired {
  if (!ctx.isMember) return cancelOf("not_member");
  if (row.status === "canceled" && row.status_reason && STICKY.includes(row.status_reason as ReminderReason)) return cancelOf(row.status_reason as ReminderReason);
  if (!ctx.subject) return cancelOf("off");
  let found: ReturnType<typeof bookingTarget> | ReturnType<typeof taskTarget>;
  if (ctx.subject.kind === "booking") {
    found = bookingTarget(ctx.subject.res, ctx.tripZone);
  } else {
    const item = ctx.subject.item;
    if (item.assignee_id !== row.recipient_id) return cancelOf(item.assignee_id ? "reassigned" : "task_unassigned");
    found = taskTarget(item, ctx.tripZone);
  }
  if (!found.ok) return cancelOf(found.reason);
  const rule = ruleOf(row);
  if (rule.kind === "lead" && found.target.atMs === null) return cancelOf("rule_invalid");
  if (!ctx.prefs.enabled) return cancelOf("recipient_off");

  const target = found.target;
  const targetMs = target.atMs ?? zonedInstant(target.date, "00:00", target.zone)!;
  const subject: ReminderSubject = ctx.subject.kind;

  // A snoozed occurrence fires at the time the person chose — quiet hours do not move an explicit choice.
  if (row.snoozed_until && (row.status === "pending" || row.status === "sending") && ms(row.target_at) === targetMs) {
    const fire = ms(row.fire_at)!;
    const limit = subject === "booking" ? target.atMs! : Infinity;
    if (nowMs >= limit) return { kind: "active", target, targetMs, snoozed: true, plan: { state: "skip", reason: "started", naturalAtMs: fire, note: "The booking has already started." } };
    const expires = ms(row.expires_at) ?? expiresAt(subject, fire, target);
    if (delivering && expires <= nowMs) return { kind: "active", target, targetMs, snoozed: true, plan: { state: "skip", reason: "expired", naturalAtMs: fire, note: null } };
    return { kind: "active", target, targetMs, snoozed: true, plan: { state: "scheduled", naturalAtMs: fire, fireAtMs: fire, expiresAtMs: expires, adjustment: "none", note: null } };
  }

  const quiet = quietFrom(ctx.prefs);
  const plan = delivering
    ? planDelivery({ subject, rule, target, nowMs, storedFireMs: ms(row.fire_at), storedNaturalMs: ms(row.natural_fire_at), quiet, allowQuiet: row.quiet_override })
    : planFire({ subject, rule, target, nowMs, quiet, allowQuiet: row.quiet_override });
  return { kind: "active", target, targetMs, plan, snoozed: false };
}

/* ----------------------- state changes on a row ----------------------- */

/** Marks inbox items already sent for this reminder (history is kept; the indicator tells the truth). */
export async function retireNotifications(tx: Executor, reminderId: string, state: "updated" | "canceled" | "completed" | "snoozed", opts: { onlyUnset?: boolean } = {}) {
  await tx.execute(sql`
    update notifications set metadata = metadata || jsonb_build_object('state', ${state}::text)
    where type = 'reminder' and resource_id = ${reminderId}
      ${opts.onlyUnset ? sql`and not (metadata ? 'state')` : sql``}`);
}

const delivered = (r: ReminderRow) => r.in_app_sent_at !== null || r.email_status === "sent" || r.email_status === "sending";

const resetDelivery = {
  claim_token: null,
  locked_until: null,
  decided_at: null,
  in_app_sent_at: null,
  sent_at: null,
  email_status: "none" as EmailStatus,
  email_attempts: 0,
  email_next_at: null,
  email_locked_until: null,
  email_sent_at: null,
  attempts: 0,
};

async function applyCancel(tx: Executor, row: ReminderRow, d: Extract<Desired, { kind: "cancel" }>): Promise<ReminderRow> {
  if (row.status === "canceled" && row.status_reason === d.reason) return row;
  const [next] = await tx
    .update(reminders)
    .set({
      status: "canceled",
      status_reason: d.reason,
      fire_at: null,
      expires_at: null,
      adjustment: null,
      adjustment_note: null,
      snoozed_until: null,
      claim_token: null,
      locked_until: null,
      email_status: ["pending", "sending", "failed"].includes(row.email_status) ? "skipped" : row.email_status,
      updated_at: sql`now()`,
    })
    .where(eq(reminders.id, row.id))
    .returning();
  if (d.sent && delivered(row)) await retireNotifications(tx, row.id, d.sent);
  return next;
}

/**
 * Brings one reminder in line with what should happen now (see `evaluate`).
 * Idempotent; safe to call from any write path. Returns the resulting row.
 */
export async function reconcileRow(tx: Executor, row: ReminderRow, ctx: Ctx, nowMs: number, opts: { forceNew?: boolean } = {}): Promise<ReminderRow> {
  const d = evaluate(row, ctx, nowMs);
  if (d.kind === "cancel") return applyCancel(tx, row, d);

  const sameTarget = ms(row.target_at) === d.targetMs;
  const settled = row.status === "sent" || (row.status === "sending" && row.decided_at !== null);
  const naturalSame = d.plan.naturalAtMs === null ? row.natural_fire_at === null : ms(row.natural_fire_at) === d.plan.naturalAtMs;
  if (settled && sameTarget && naturalSame && !opts.forceNew) return row;
  // A final outcome (expired, too late, started, failed) is a fact about what happened: an unrelated edit does not rewrite it.
  const terminal = row.status === "failed" || (row.status === "skipped" && ["expired", "past", "started", "no_channel"].includes(row.status_reason ?? ""));
  if (terminal && sameTarget && naturalSame && !opts.forceNew) return row;
  // A snooze stands while the record it counts down to is unchanged.
  if (d.snoozed && sameTarget && !opts.forceNew && row.status === "pending") return row;

  const revive = row.status === "canceled" && !(row.status_reason && STICKY.includes(row.status_reason as ReminderReason)) && (REVIVABLE as readonly string[]).includes(row.status_reason ?? "");
  if (row.status === "canceled" && !revive && !opts.forceNew) return row;

  const bump = delivered(row) || settled;
  if (bump && delivered(row)) await retireNotifications(tx, row.id, "updated", { onlyUnset: true });
  const occurrence = bump ? row.occurrence + 1 : row.occurrence;
  const common = {
    occurrence,
    target_at: iso(d.targetMs),
    natural_fire_at: iso(d.plan.naturalAtMs),
    snoozed_until: null,
    updated_at: sql`now()`,
    ...(bump || revive ? resetDelivery : { claim_token: null, locked_until: null }),
  };
  const [next] =
    d.plan.state === "scheduled"
      ? await tx
          .update(reminders)
          .set({
            ...common,
            status: "pending",
            status_reason: null,
            fire_at: iso(d.plan.fireAtMs),
            expires_at: iso(d.plan.expiresAtMs),
            adjustment: d.plan.adjustment === "none" ? null : d.plan.adjustment,
            adjustment_note: d.plan.note,
          })
          .where(eq(reminders.id, row.id))
          .returning()
      : await tx
          .update(reminders)
          .set({ ...common, status: "skipped", status_reason: d.plan.reason, fire_at: null, expires_at: null, adjustment: null, adjustment_note: d.plan.note })
          .where(eq(reminders.id, row.id))
          .returning();
  return next;
}

async function reconcileMany(tx: Executor, rows: ReminderRow[], nowMs: number) {
  const prefs = new Map<string, ReminderPrefs>();
  for (const r of rows) await reconcileRow(tx, r, await loadCtx(tx, r, prefs), nowMs);
}

/* ----------------------------- sync entry points ----------------------------- */

const subjectFilter = (type: ReminderSubject, id: string) => (type === "booking" ? eq(reminders.reservation_id, id) : eq(reminders.packing_item_id, id));

/**
 * After a booking or task was written (same transaction): cancel, reschedule
 * or leave each of its reminders. For a task, the reminder rule follows the
 * task to its new assignee (the old assignee's reminder is canceled): a
 * reassignment never leaves the previous person's reminder pending and never
 * creates one for a task that had none.
 */
export async function syncSubject(tx: Executor, tripId: string, type: ReminderSubject, id: string, nowMs = Date.now()) {
  if (type === "task") await migrateTaskRule(tx, tripId, id, nowMs);
  const rows = await tx.select().from(reminders).where(and(eq(reminders.trip_id, tripId), subjectFilter(type, id)));
  if (rows.length) await reconcileMany(tx, rows, nowMs);
}

async function migrateTaskRule(tx: Executor, tripId: string, itemId: string, nowMs: number) {
  const [item] = await tx.select().from(packingItems).where(and(eq(packingItems.id, itemId), eq(packingItems.trip_id, tripId)));
  if (!item?.assignee_id || item.is_packed || !item.due_date) return;
  const rows = await tx.select().from(reminders).where(and(eq(reminders.trip_id, tripId), eq(reminders.packing_item_id, itemId)));
  const mine = rows.find((r) => r.recipient_id === item.assignee_id);
  if (mine && mine.status !== "canceled") return;
  if (mine && mine.status_reason === "off") return;
  const source = rows
    .filter((r) => r.recipient_id !== item.assignee_id && r.status !== "canceled")
    .sort((a, b) => (ms(b.updated_at) ?? 0) - (ms(a.updated_at) ?? 0))[0];
  if (!source) return;
  if (!(await isCurrentMember(tx, tripId, item.assignee_id))) return;
  const rule = ruleOf(source);
  const rulePart = rule.kind === "lead" ? { lead_minutes: rule.leadMinutes, days_before: null, local_time: null } : { lead_minutes: null, days_before: rule.daysBefore, local_time: `${rule.localTime}:00` };
  if (mine) {
    await tx.update(reminders).set({ preset: source.preset, ...rulePart, status: "pending", status_reason: null, quiet_override: false, ...resetDelivery, updated_at: sql`now()` }).where(eq(reminders.id, mine.id));
  } else {
    await tx
      .insert(reminders)
      .values({ trip_id: tripId, owner_id: source.owner_id, subject_type: "task", packing_item_id: itemId, recipient_id: item.assignee_id, preset: source.preset, ...rulePart, created_by: source.created_by })
      .onConflictDoNothing();
  }
  void nowMs;
}

export async function syncTrip(tx: Executor, tripId: string, nowMs = Date.now()) {
  const rows = await tx.select().from(reminders).where(eq(reminders.trip_id, tripId));
  if (rows.length) await reconcileMany(tx, rows, nowMs);
}

export async function syncRecipient(tx: Executor, userId: string, nowMs = Date.now()) {
  const rows = await tx.select().from(reminders).where(eq(reminders.recipient_id, userId)).limit(500);
  if (rows.length) await reconcileMany(tx, rows, nowMs);
}

/**
 * A member left or was removed (call in the same transaction, after the
 * membership row is gone): unassign their tasks, then cancel every reminder
 * addressed to them on this trip. Their inbox items for the trip are purged
 * separately.
 */
export async function onMemberRemoved(tx: Executor, tripId: string, userId: string, nowMs = Date.now()) {
  await tx.update(packingItems).set({ assignee_id: null, updated_at: sql`now()` }).where(and(eq(packingItems.trip_id, tripId), eq(packingItems.assignee_id, userId)));
  const rows = await tx.select().from(reminders).where(and(eq(reminders.trip_id, tripId), eq(reminders.recipient_id, userId)));
  if (rows.length) await reconcileMany(tx, rows, nowMs);
}

/* --------------------------------- setup --------------------------------- */

/** What the setup form sends: the preset (or custom values) and who. The rule is built from the live record's shape (date-only or timed) on the server. */
export type SetupInput = { preset: PresetChoice; rule: Omit<RuleInput, "preset">; recipientIds: string[] };
export type SetupResult =
  | { ok: true; summary: { recipientId: string; status: ReminderStatus; reason: ReminderReason | null; fireAt: string | null; note: string | null }[] }
  | { ok: false; reason: "not_found" | "ineligible" | "no_recipients" | "not_member" | "unassigned" | "past" | "started" | "invalid"; detail?: string };

async function loadSubject(tx: Executor, ownerId: string, tripId: string, type: ReminderSubject, id: string) {
  const [trip] = await tx.select({ zone: trips.time_zone }).from(trips).where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)));
  if (!trip) return null;
  if (type === "booking") {
    const [res] = await tx.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId))).for("update");
    return res ? { tripZone: trip.zone, subject: { kind: "booking", res } as Subject } : null;
  }
  const [item] = await tx.select().from(packingItems).where(and(eq(packingItems.id, id), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId))).for("update");
  return item ? { tripZone: trip.zone, subject: { kind: "task", item } as Subject } : null;
}

/**
 * Creates / updates / turns off the reminder(s) of one booking or task.
 * Authorization (owner / editor) is the caller's job (the DAL's `editTrip`);
 * what is checked here is the data: the record is on this trip, confirmed
 * (bookings) or assigned (tasks), the time is still ahead, and every
 * recipient is a CURRENT member. Nothing is ever created implicitly.
 */
export async function setReminders(tx: Executor, ctx: { userId: string; ownerId: string }, tripId: string, type: ReminderSubject, id: string, input: SetupInput, nowMs = Date.now()): Promise<SetupResult> {
  const loaded = await loadSubject(tx, ctx.ownerId, tripId, type, id);
  if (!loaded) return { ok: false, reason: "not_found" };
  const { subject, tripZone } = loaded;
  const existing = await tx.select().from(reminders).where(and(eq(reminders.trip_id, tripId), subjectFilter(type, id)));

  const cancelAll = async (reason: ReminderReason, except: Set<string> = new Set()) => {
    for (const r of existing) {
      if (except.has(r.recipient_id) || (r.status === "canceled" && r.status_reason === reason)) continue;
      if (r.status === "canceled" && !REVIVABLE.includes(r.status_reason as ReminderReason) && r.status_reason !== "recipient_off") continue;
      await applyCancel(tx, r, cancelOf(reason) as Extract<Desired, { kind: "cancel" }>);
    }
  };

  if (input.preset === "off") {
    await cancelAll("off");
    return { ok: true, summary: [] };
  }

  const found = subject.kind === "booking" ? bookingTarget(subject.res, tripZone) : taskTarget(subject.item, tripZone);
  if (!found.ok) return { ok: false, reason: "ineligible", detail: found.reason };
  const built = buildRule(subject.kind, { ...input.rule, preset: input.preset }, found.target.atMs === null);
  if (!built.ok) return { ok: false, reason: "invalid", detail: built.error };
  const rule = built.rule;

  let recipients: string[];
  if (subject.kind === "task") {
    if (!subject.item.assignee_id) return { ok: false, reason: "unassigned" };
    recipients = [subject.item.assignee_id];
  } else {
    recipients = [...new Set(input.recipientIds)].slice(0, 20);
    if (recipients.length === 0) return { ok: false, reason: "no_recipients" };
  }
  for (const r of recipients) if (!(await isCurrentMember(tx, tripId, r))) return { ok: false, reason: "not_member" };

  const rulePart = rule.kind === "lead" ? { lead_minutes: rule.leadMinutes, days_before: null, local_time: null } : { lead_minutes: null, days_before: rule.daysBefore, local_time: `${rule.localTime}:00` };

  // Saving what is already set up and already delivered changes nothing (and must not be refused as "in the past").
  const hmOrNull = (t: string | null) => (t ? hm(t) : null);
  const targetMs = found.target.atMs ?? zonedInstant(found.target.date, "00:00", found.target.zone)!;
  const unchanged = recipients.every((rid) => {
    const r = existing.find((e) => e.recipient_id === rid);
    return Boolean(r) && r!.lead_minutes === rulePart.lead_minutes && r!.days_before === rulePart.days_before && hmOrNull(r!.local_time) === hmOrNull(rulePart.local_time) && (r!.status === "sent" || (r!.status === "sending" && r!.decided_at !== null)) && ms(r!.target_at) === targetMs;
  });
  if (unchanged) {
    await cancelAll("unselected", new Set(recipients));
    return { ok: true, summary: recipients.map((rid) => { const r = existing.find((e) => e.recipient_id === rid)!; return { recipientId: rid, status: r.status as ReminderStatus, reason: r.status_reason as ReminderReason | null, fireAt: r.fire_at, note: r.adjustment_note }; }) };
  }

  // Refuse up front if the time is already gone; the same for everyone, whatever their quiet hours.
  const probe = planFire({ subject: subject.kind, rule, target: found.target, nowMs, quiet: null, allowQuiet: true });
  if (probe.state === "skip") return { ok: false, reason: probe.reason === "started" ? "started" : "past" };

  const prefs = new Map<string, ReminderPrefs>();
  const summary: Extract<SetupResult, { ok: true }>["summary"] = [];
  for (const recipientId of recipients) {
    const row = existing.find((r) => r.recipient_id === recipientId);
    let current: ReminderRow;
    const ruleChanged = row && (row.lead_minutes !== rulePart.lead_minutes || row.days_before !== rulePart.days_before || (row.local_time && hm(row.local_time)) !== (rulePart.local_time ? hm(rulePart.local_time) : null));
    if (row) {
      const back = row.status === "canceled" || row.status === "skipped" || row.status === "failed";
      [current] = await tx
        .update(reminders)
        .set({
          preset: input.preset as ReminderPreset,
          ...rulePart,
          ...(back ? { status: "pending", status_reason: null } : {}),
          // A deliberate re-setup is a new decision about quiet hours too.
          quiet_override: false,
          updated_at: sql`now()`,
        })
        .where(eq(reminders.id, row.id))
        .returning();
    } else {
      const [inserted] = await tx
        .insert(reminders)
        .values({ trip_id: tripId, owner_id: ctx.ownerId, subject_type: type, ...(subject.kind === "booking" ? { reservation_id: id } : { packing_item_id: id }), recipient_id: recipientId, preset: input.preset as ReminderPreset, ...rulePart, created_by: ctx.userId })
        .onConflictDoNothing()
        .returning();
      if (inserted) current = inserted;
      else {
        const [raced] = await tx.select().from(reminders).where(and(eq(reminders.trip_id, tripId), subjectFilter(type, id), eq(reminders.recipient_id, recipientId)));
        current = raced;
      }
    }
    const out = await reconcileRow(tx, current, await loadCtx(tx, current, prefs), nowMs, { forceNew: Boolean(ruleChanged) });
    summary.push({ recipientId, status: out.status as ReminderStatus, reason: out.status_reason as ReminderReason | null, fireAt: out.fire_at, note: out.adjustment_note });
  }
  // People who were removed from the selection stop getting it.
  await cancelAll("unselected", new Set(recipients));
  return { ok: true, summary };
}

/** What a setup WOULD do for each chosen person — writes nothing. */
export async function previewReminders(
  db: Executor,
  ctx: { userId: string; ownerId: string },
  tripId: string,
  type: ReminderSubject,
  id: string,
  input: { preset: PresetChoice; rule: Omit<RuleInput, "preset">; recipientIds: string[] },
  nowMs = Date.now(),
) {
  const trip = await db.select({ zone: trips.time_zone }).from(trips).where(and(eq(trips.id, tripId), eq(trips.owner_id, ctx.ownerId)));
  if (!trip[0]) return null;
  let found: ReturnType<typeof bookingTarget> | ReturnType<typeof taskTarget>;
  let recipients = input.recipientIds;
  if (type === "booking") {
    const [res] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.trip_id, tripId), eq(reservations.owner_id, ctx.ownerId)));
    if (!res) return null;
    found = bookingTarget(res, trip[0].zone);
  } else {
    const [item] = await db.select().from(packingItems).where(and(eq(packingItems.id, id), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ctx.ownerId)));
    if (!item) return null;
    found = taskTarget(item, trip[0].zone);
    recipients = item.assignee_id ? [item.assignee_id] : [];
  }
  if (!found.ok) return { ok: false as const, reason: found.reason, detail: null };
  if (input.preset === "off") return { ok: true as const, zone: found.target.zone, zoneName: zoneName(found.target.zone), zoneSource: found.target.zoneSource, rows: [] };
  const built = buildRule(type, { ...input.rule, preset: input.preset }, found.target.atMs === null);
  if (!built.ok) return { ok: false as const, reason: "invalid" as const, detail: built.error };
  const rule = built.rule;
  const names = await displayNames(db, recipients);
  const out: { recipientId: string; name: string; text: string | null; note: string | null; problem: string | null }[] = [];
  for (const recipientId of recipients) {
    if (!(await isCurrentMember(db, tripId, recipientId))) continue;
    const prefs = await effectivePrefs(db, recipientId, type);
    const plan = planFire({ subject: type, rule, target: found.target, nowMs, quiet: prefs.enabled ? quietFrom(prefs) : null, allowQuiet: false });
    const name = names.get(recipientId) ?? "this person";
    if (!prefs.enabled) out.push({ recipientId, name, text: null, note: null, problem: `${name} has turned reminders off, so this won’t be sent.` });
    else if (plan.state === "scheduled") out.push({ recipientId, name, text: previewSentence(name, plan.fireAtMs, found.target.zone), note: plan.adjustment === "none" ? null : "Adjusted for quiet hours.", problem: null });
    else if (plan.reason === "quiet_hours") out.push({ recipientId, name, text: null, note: null, problem: `That falls in ${name}’s quiet hours and can’t be moved usefully, so it won’t be sent unless they allow it.` });
    else out.push({ recipientId, name, text: null, note: null, problem: plan.reason === "started" ? "This booking has already started." : "That reminder time has already passed." });
  }
  return { ok: true as const, zone: found.target.zone, zoneName: zoneName(found.target.zone), zoneSource: found.target.zoneSource, rows: out };
}

/* -------------------------- recipient actions -------------------------- */

export type OwnReminderResult = { ok: true; fireAt?: string; note?: string } | { ok: false; reason: "not_found" | "unavailable" | "too_late" | "invalid"; detail?: string };

async function ownRow(tx: Executor, reminderId: string, userId: string) {
  const [row] = await tx.select().from(reminders).where(and(eq(reminders.id, reminderId), eq(reminders.recipient_id, userId))).for("update");
  return row ?? null;
}

/**
 * Snooze: the recipient's own reminder, at an explicit time. Replaces the
 * pending occurrence (same row → no duplicate job), persists, and the
 * inbox item it came from is marked "snoozed". A booking snooze must end
 * before the booking starts.
 */
export async function snoozeReminder(tx: Executor, userId: string, reminderId: string, atMs: number, nowMs = Date.now()): Promise<OwnReminderResult> {
  const row = await ownRow(tx, reminderId, userId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "sent" && row.status !== "pending") return { ok: false, reason: "unavailable" };
  const ctx = await loadCtx(tx, row);
  const d = evaluate(row, ctx, nowMs);
  if (d.kind !== "active") {
    await applyCancel(tx, row, d);
    return { ok: false, reason: "unavailable" };
  }
  const subject: ReminderSubject = row.subject_type as ReminderSubject;
  const plan = planSnooze({ subject, target: d.target, atMs, nowMs });
  if (!plan.ok) return { ok: false, reason: plan.afterStart ? "too_late" : "invalid", detail: plan.error };
  // The same snooze twice is one snooze.
  if (row.status === "pending" && row.snoozed_until && ms(row.fire_at) === plan.fireAtMs) return { ok: true, fireAt: row.fire_at! };
  if (delivered(row)) await retireNotifications(tx, row.id, "snoozed", { onlyUnset: true });
  await tx
    .update(reminders)
    .set({
      occurrence: row.occurrence + 1,
      status: "pending",
      status_reason: null,
      target_at: iso(d.targetMs),
      natural_fire_at: iso(plan.fireAtMs),
      fire_at: iso(plan.fireAtMs),
      expires_at: iso(plan.expiresAtMs),
      adjustment: null,
      adjustment_note: null,
      snoozed_until: iso(plan.fireAtMs),
      snooze_count: row.snooze_count + 1,
      ...resetDelivery,
      updated_at: sql`now()`,
    })
    .where(eq(reminders.id, row.id));
  return { ok: true, fireAt: iso(plan.fireAtMs)! };
}

/** The recipient turns off just this reminder. It stays off (it does not come back by itself). */
export async function muteReminder(tx: Executor, userId: string, reminderId: string): Promise<OwnReminderResult> {
  const row = await ownRow(tx, reminderId, userId);
  if (!row) return { ok: false, reason: "not_found" };
  await applyCancel(tx, row, { kind: "cancel", reason: "recipient_muted", sent: null });
  return { ok: true };
}

/** The recipient chooses to receive a reminder that quiet hours had stopped. */
export async function allowQuietReminder(tx: Executor, userId: string, reminderId: string, nowMs = Date.now()): Promise<OwnReminderResult> {
  const row = await ownRow(tx, reminderId, userId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "skipped" || row.status_reason !== "quiet_hours") return { ok: false, reason: "unavailable" };
  const [updated] = await tx.update(reminders).set({ quiet_override: true, status: "pending", status_reason: null, updated_at: sql`now()` }).where(eq(reminders.id, row.id)).returning();
  const out = await reconcileRow(tx, updated, await loadCtx(tx, updated), nowMs);
  return out.status === "pending" ? { ok: true, fireAt: out.fire_at ?? undefined } : { ok: false, reason: "too_late", detail: "That time has passed." };
}

/* --------------------------------- reading --------------------------------- */

/** Everyone on the trip (owner first), with names — for the recipient picker. Names only. */
export async function tripPeopleChoices(db: Executor, tripId: string, viewerId: string): Promise<MemberChoice[]> {
  const [trip] = await db.select({ owner: trips.owner_id }).from(trips).where(eq(trips.id, tripId));
  if (!trip) return [];
  const members = await db.select({ id: tripMembers.user_id, role: tripMembers.role }).from(tripMembers).where(eq(tripMembers.trip_id, tripId)).orderBy(asc(tripMembers.joined_at));
  const ids = [trip.owner, ...members.map((m) => m.id)];
  const names = await displayNames(db, ids);
  const nameOf = (id: string) => (id === viewerId ? "You" : (names.get(id) ?? "A traveler"));
  return [
    { id: trip.owner, name: nameOf(trip.owner), role: "owner", isYou: trip.owner === viewerId },
    ...members.map((m) => ({ id: m.id, name: nameOf(m.id), role: m.role as "editor" | "viewer", isYou: m.id === viewerId })),
  ];
}

/** The scheduled job's last run, so the app never claims delivery is active when it is not. */
export async function schedulerStatus(db: Executor, now = new Date()): Promise<{ active: boolean; lastRunAt: string | null }> {
  const [row] = await db.select().from(schedulerHeartbeats).where(eq(schedulerHeartbeats.job, JOB_NAME));
  const last = row?.last_finished_at ?? null;
  const t = ms(last);
  return { active: t !== null && now.getTime() - t < HEARTBEAT_FRESH_MINUTES * 60_000, lastRunAt: last };
}

function viewOf(r: ReminderRow, who: { name: string; isYou: boolean }, target: Target | null, prefs: ReminderPrefs | null, viewerId: string, available: boolean): ReminderView {
  const rule = ruleOf(r);
  const zone = target?.zone ?? "UTC";
  const fireMs = ms(r.fire_at);
  const view: ReminderView = {
    id: r.id,
    recipient: { id: r.recipient_id, name: who.name, isYou: who.isYou },
    preset: r.preset as ReminderPreset,
    rule,
    ruleText: describeRule(rule),
    status: r.status as ReminderStatus,
    reason: r.status_reason as ReminderReason | null,
    snoozed: r.snoozed_until !== null && r.status === "pending",
    fireAt: r.fire_at ? iso(fireMs) : null,
    fireText: fireMs !== null ? `${formatInstant(fireMs, zone)}, ${zoneName(zone)}` : null,
    zone,
    zoneName: zoneName(zone),
    channels: { inApp: prefs?.in_app ?? true, email: Boolean(prefs?.email) },
    inAppSentAt: r.in_app_sent_at,
    emailStatus: r.email_status as EmailStatus,
    // Quiet-hour specifics are the recipient's business; others only learn that it was adjusted.
    adjustmentNote: r.recipient_id === viewerId ? r.adjustment_note : null,
    adjusted: r.adjustment !== null || r.status_reason === "quiet_hours",
    canSnooze: r.recipient_id === viewerId && (r.status === "sent" || r.status === "pending"),
    canAllowQuiet: r.recipient_id === viewerId && r.status === "skipped" && r.status_reason === "quiet_hours",
  };
  void available;
  return view;
}

const PROBLEM: Record<string, string> = {
  booking_cancelled: "Only confirmed bookings can have reminders. This one is cancelled.",
  booking_unscheduled: "Add a start date and time to this booking to set a reminder.",
  task_done: "This task is complete, so it has no reminder.",
  no_due: "Add a due date to this task to set a reminder.",
};

export async function getPanel(db: Executor, viewerId: string, ownerId: string, tripId: string, type: ReminderSubject, id: string, emailProvider: boolean, nowMs = Date.now()): Promise<ReminderPanel | null> {
  const [trip] = await db.select({ zone: trips.time_zone }).from(trips).where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)));
  if (!trip) return null;
  let title: string;
  let found: ReturnType<typeof bookingTarget> | ReturnType<typeof taskTarget>;
  let assigneeId: string | null = null;
  if (type === "booking") {
    const [res] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId)));
    if (!res) return null;
    title = res.title;
    found = bookingTarget(res, trip.zone);
  } else {
    const [item] = await db.select().from(packingItems).where(and(eq(packingItems.id, id), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId)));
    if (!item) return null;
    title = item.label;
    assigneeId = item.assignee_id;
    found = taskTarget(item, trip.zone);
  }
  const target = found.ok ? found.target : null;
  const rows = await db.select().from(reminders).where(and(eq(reminders.trip_id, tripId), subjectFilter(type, id))).orderBy(asc(reminders.created_at));
  const people = await tripPeopleChoices(db, tripId, viewerId);
  const byId = new Map(people.map((p) => [p.id, p]));
  const views: ReminderView[] = [];
  for (const r of rows) {
    // People who left no longer appear (their reminders are canceled anyway).
    const person = byId.get(r.recipient_id);
    if (!person) continue;
    if (r.status === "canceled" && r.status_reason && ["unselected", "off"].includes(r.status_reason)) continue;
    views.push(viewOf(r, { name: person.name, isYou: person.isYou }, target, await getPrefs(db, r.recipient_id), viewerId, true));
  }
  const me = await getPrefs(db, viewerId);
  const [address, scheduler] = await Promise.all([profileEmail(db, viewerId), schedulerStatus(db, new Date(nowMs))]);
  const dateOnly = Boolean(target && target.atMs === null);
  return {
    subject: {
      type,
      id,
      title,
      eligible: found.ok && (type === "booking" || Boolean(assigneeId)),
      problem: !found.ok ? (PROBLEM[found.reason] ?? "This can’t have a reminder.") : type === "task" && !assigneeId ? "Assign this task to someone to set a reminder — reminders go only to the assignee." : null,
      dateOnly,
      whenText: target ? (target.atMs !== null ? `${formatInstant(target.atMs, target.zone)}, ${zoneName(target.zone)}` : `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${target.date}T00:00:00Z`))} (no time set)`) : null,
      zone: target?.zone ?? null,
      zoneName: target ? zoneName(target.zone) : null,
      zoneNote: target ? (target.zoneSource === "booking" && type === "booking" ? "The booking’s own time zone (for a flight, the departure airport’s)." : target.zoneSource === "trip" ? "This booking has no time zone saved, so the trip’s zone is assumed." : null) : null,
      assigneeId,
      limitAtMs: target ? limitMs(type, target) : null,
    },
    snoozeOptions: target ? snoozeChoices({ subject: type, target, nowMs }) : [],
    people,
    reminders: views,
    defaultTaskTime: me.default_task_time,
    scheduler,
    email: { providerConfigured: emailProvider, hasAddress: Boolean(address) },
  };
}

/**
 * The review list behind "Set up reminders": every confirmed, scheduled
 * booking and every assigned, unfinished task with a due date that still lies
 * ahead — with whether anything is set up. Nothing is created by reading it.
 */
export async function getOverview(db: Executor, ownerId: string, tripId: string, nowMs = Date.now()): Promise<OverviewRow[]> {
  const [trip] = await db.select({ zone: trips.time_zone }).from(trips).where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)));
  if (!trip) return [];
  const [res, items, rows] = await Promise.all([
    db.select().from(reservations).where(and(eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId))),
    db.select().from(packingItems).where(and(eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId), isNotNull(packingItems.assignee_id), isNotNull(packingItems.due_date))),
    db.select().from(reminders).where(eq(reminders.trip_id, tripId)),
  ]);
  const out: OverviewRow[] = [];
  const activeFor = (pred: (r: ReminderRow) => boolean) => rows.filter((r) => pred(r) && r.status !== "canceled");
  for (const b of res) {
    const t = bookingTarget(b, trip.zone);
    if (!t.ok || t.target.atMs === null || t.target.atMs <= nowMs) continue;
    const mine = activeFor((r) => r.reservation_id === b.id);
    out.push({ type: "booking", id: b.id, title: b.title, whenText: `${formatInstant(t.target.atMs, t.target.zone)}, ${zoneName(t.target.zone)}`, active: mine.length, summary: mine[0] ? describeRule(ruleOf(mine[0])) : null });
  }
  for (const i of items) {
    const t = taskTarget(i, trip.zone);
    if (!t.ok) continue;
    const end = t.target.atMs ?? zonedInstant(addDays(t.target.date, 1), "00:00", t.target.zone)!;
    if (end <= nowMs) continue;
    const mine = activeFor((r) => r.packing_item_id === i.id);
    const when = t.target.atMs !== null ? `${formatInstant(t.target.atMs, t.target.zone)}, ${zoneName(t.target.zone)}` : `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${t.target.date}T00:00:00Z`))} (no time)`;
    out.push({ type: "task", id: i.id, title: i.label, whenText: when, active: mine.length, summary: mine[0] ? describeRule(ruleOf(mine[0])) : null });
  }
  return out;
}

/* ----------------------- what an inbox item may do ----------------------- */

export type ReminderItemLive = {
  reminderId: string;
  canComplete: boolean;
  taskDone: boolean;
  canSnooze: boolean;
  snoozeOptions: { id: string; label: string; atMs: number }[];
  directionsUrl: string | null;
  zoneName: string;
  zone: string;
  /** a snooze must end before this (a booking's start); null = no hard limit */
  limitAtMs: number | null;
  /** a later occurrence replaced the one this item is about */
  superseded: boolean;
};

/**
 * Live facts for reminder items in the viewer's inbox (their own rows only):
 * what they may do now. Re-derived at read time from current data — an old
 * item never offers an action the person can no longer take.
 */
export async function inboxActions(db: Executor, viewerId: string, items: { reminderId: string; occurrence: number }[], role: (tripId: string) => Promise<"owner" | "editor" | "viewer" | null>, nowMs = Date.now()): Promise<Map<string, ReminderItemLive>> {
  const out = new Map<string, ReminderItemLive>();
  if (items.length === 0) return out;
  const rows = await db.select().from(reminders).where(and(inArray(reminders.id, items.map((i) => i.reminderId)), eq(reminders.recipient_id, viewerId)));
  const prefsCache = new Map<string, ReminderPrefs>();
  for (const row of rows) {
    const occ = items.find((i) => i.reminderId === row.id)!.occurrence;
    const ctx = await loadCtx(db, row, prefsCache);
    if (!ctx.isMember || !ctx.subject) continue;
    const found = ctx.subject.kind === "booking" ? bookingTarget(ctx.subject.res, ctx.tripZone) : taskTarget(ctx.subject.item, ctx.tripZone);
    const target = found.ok ? found.target : null;
    const r = await role(row.trip_id);
    const canEdit = r === "owner" || r === "editor";
    const live = evaluate(row, ctx, nowMs).kind === "active";
    const subject: ReminderSubject = row.subject_type as ReminderSubject;
    let directionsUrl: string | null = null;
    if (ctx.subject.kind === "booking") {
      const [link] = await db
        .select({ name: places.name, address: places.address, maps_url: places.maps_url })
        .from(itineraryItems)
        .innerJoin(places, and(eq(places.id, itineraryItems.place_id), eq(places.trip_id, itineraryItems.trip_id)))
        .where(and(eq(itineraryItems.trip_id, row.trip_id), eq(itineraryItems.reservation_id, row.reservation_id!)))
        .limit(1);
      const url = link ? placeMapsUrl(link) : null;
      directionsUrl = url && /^https:\/\//.test(url) ? url : null;
    }
    out.set(row.id, {
      reminderId: row.id,
      canComplete: ctx.subject.kind === "task" && canEdit && !ctx.subject.item.is_packed && ctx.subject.item.assignee_id === viewerId,
      taskDone: ctx.subject.kind === "task" && ctx.subject.item.is_packed,
      canSnooze: live && target !== null && (row.status === "sent" || row.status === "pending") && row.occurrence === occ,
      snoozeOptions: live && target ? snoozeChoices({ subject, target, nowMs }) : [],
      directionsUrl,
      zoneName: target ? zoneName(target.zone) : "",
      zone: target?.zone ?? "UTC",
      limitAtMs: target ? limitMs(subject, target) : null,
      superseded: row.occurrence > occ,
    });
  }
  return out;
}

/* ---------------------------------- worker ---------------------------------- */

export type RunReport = {
  claimed: number;
  sent: number;
  duplicate: number;
  rescheduled: number;
  canceled: number;
  skipped: number;
  expired: number;
  retried: number;
  failed: number;
  lost: number;
  emailSent: number;
  emailFailed: number;
  emailSkipped: number;
  emailUnavailable: number;
  dryRun: boolean;
  /** dry run only: what would be delivered */
  due: { id: string; type: ReminderSubject; recipient: string; title: string; body: string; fireAt: string | null }[];
};

const emptyReport = (dryRun: boolean): RunReport => ({
  claimed: 0, sent: 0, duplicate: 0, rescheduled: 0, canceled: 0, skipped: 0, expired: 0, retried: 0, failed: 0, lost: 0,
  emailSent: 0, emailFailed: 0, emailSkipped: 0, emailUnavailable: 0, dryRun, due: [],
});

type Outcome = "sent" | "duplicate" | "rescheduled" | "canceled" | "skipped" | "lost";

function wording(row: ReminderRow, subject: Subject, target: Target, nowMs: number) {
  return subject.kind === "booking" ? bookingText(subject.res, target.atMs!, nowMs) : taskText({ label: subject.item.label }, target, nowMs);
}

/**
 * One pass of the scheduled job. Safe to run as often as you like and from
 * many workers at once:
 *  1. Housekeeping: anything past its freshness window is recorded as skipped
 *     ("expired") — after downtime nothing old is ever sent.
 *  2. Claim a batch with `FOR UPDATE SKIP LOCKED` (a short lease; a crashed
 *     worker's claim simply expires and is retried).
 *  3. Deliver each in its own transaction under a row lock: re-read the record,
 *     membership and preferences; refuse if anything changed. The inbox item
 *     and the status change commit together or not at all.
 *  4. Email phase for rows whose recipient opted in: leased, idempotency-keyed,
 *     at most MAX_EMAIL_ATTEMPTS, and only marked sent when the provider accepts.
 *
 * `dryRun` composes what is due and changes nothing.
 */
export async function runReminders(db: Db, opts: { now?: Date; email?: ReminderSender | null; dryRun?: boolean; batch?: number } = {}): Promise<RunReport> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const dryRun = opts.dryRun ?? false;
  const report = emptyReport(dryRun);
  const batch = opts.batch ?? 100;

  if (dryRun) return dryRunReport(db, now, report);

  await db
    .insert(schedulerHeartbeats)
    .values({ job: JOB_NAME, last_started_at: nowIso })
    .onConflictDoUpdate({ target: schedulerHeartbeats.job, set: { last_started_at: nowIso } });

  // 1. housekeeping
  const expired = await db.execute(sql`
    with gone as (
      update reminders set status = 'skipped', status_reason = 'expired', claim_token = null, locked_until = null,
             email_status = case when email_status in ('pending','sending','failed') then 'skipped' else email_status end, updated_at = now()
      where expires_at <= ${nowIso}::timestamptz
        and (status = 'pending' or (status = 'sending' and (decided_at is not null or locked_until < ${nowIso}::timestamptz)))
      returning id)
    select count(*)::int as n from gone`);
  report.expired = (expired.rows[0] as { n: number }).n;
  await db.execute(sql`
    update reminders set email_status = 'skipped', updated_at = now()
    where email_status in ('pending', 'failed', 'sending') and expires_at <= ${nowIso}::timestamptz`);
  const exhausted = await db.execute(sql`
    with dead as (
      update reminders set status = 'failed', status_reason = 'error', claim_token = null, locked_until = null, updated_at = now()
      where status = 'sending' and decided_at is null and locked_until < ${nowIso}::timestamptz and attempts >= ${MAX_DELIVERY_ATTEMPTS}
      returning id)
    select count(*)::int as n from dead`);
  report.failed += (exhausted.rows[0] as { n: number }).n;

  // 2. claim
  const claimed = await db.execute<{ id: string; claim_token: string }>(sql`
    update reminders set status = 'sending', claim_token = gen_random_uuid(), attempts = attempts + 1,
           locked_until = ${nowIso}::timestamptz + make_interval(mins => ${CLAIM_LEASE_MINUTES}), updated_at = now()
    where id in (
      select id from reminders
      where expires_at > ${nowIso}::timestamptz and attempts < ${MAX_DELIVERY_ATTEMPTS}
        and ((status = 'pending' and fire_at <= ${nowIso}::timestamptz and (locked_until is null or locked_until <= ${nowIso}::timestamptz))
          or (status = 'sending' and decided_at is null and locked_until < ${nowIso}::timestamptz))
      order by fire_at
      limit ${batch}
      for update skip locked)
    returning id, claim_token`);
  report.claimed = claimed.rows.length;

  // 3. deliver
  for (const c of claimed.rows) {
    try {
      const outcome = await deliverClaimed(db, c.id, c.claim_token, now, Boolean(opts.email));
      if (outcome === "sent") report.sent++;
      else if (outcome === "duplicate") report.duplicate++;
      else if (outcome === "rescheduled") report.rescheduled++;
      else if (outcome === "canceled") report.canceled++;
      else if (outcome === "lost") report.lost++;
      else report.skipped++;
    } catch (error) {
      console.error("[rove] reminder delivery failed:", (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code ?? (error as Error)?.name);
      const failed = await markAttemptFailed(db, c.id, c.claim_token, now);
      if (failed === "failed") report.failed++;
      else report.retried++;
    }
  }

  // 4. email
  if (opts.email) await runEmailPhase(db, now, opts.email, report, batch);
  else {
    const pending = await db.execute(sql`select count(*)::int as n from reminders where email_status in ('pending','failed') and expires_at > ${nowIso}::timestamptz`);
    report.emailUnavailable = (pending.rows[0] as { n: number }).n;
  }

  await db
    .update(schedulerHeartbeats)
    .set({ last_finished_at: new Date().toISOString(), last_result: { claimed: report.claimed, sent: report.sent, rescheduled: report.rescheduled, canceled: report.canceled, skipped: report.skipped, expired: report.expired, failed: report.failed, emailSent: report.emailSent } })
    .where(eq(schedulerHeartbeats.job, JOB_NAME));
  void nowMs;
  return report;
}

async function dryRunReport(db: Db, now: Date, report: RunReport): Promise<RunReport> {
  const nowIso = now.toISOString();
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, "pending"), sql`${reminders.fire_at} <= ${nowIso}::timestamptz`, sql`${reminders.expires_at} > ${nowIso}::timestamptz`))
    .limit(200);
  const prefs = new Map<string, ReminderPrefs>();
  for (const row of rows) {
    const ctx = await loadCtx(db, row, prefs);
    const d = evaluate(row, ctx, now.getTime(), true);
    report.claimed++;
    if (d.kind !== "active" || d.plan.state !== "scheduled" || !ctx.subject || ms(row.target_at) !== d.targetMs) {
      report.skipped++;
      continue;
    }
    const text = wording(row, ctx.subject, d.target, now.getTime());
    report.due.push({ id: row.id, type: row.subject_type as ReminderSubject, recipient: row.recipient_id, title: text.title, body: text.body, fireAt: row.fire_at });
  }
  return report;
}

async function markAttemptFailed(db: Db, id: string, token: string, now: Date): Promise<"failed" | "retry"> {
  const retryAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  const rows = await db.execute<{ status: string }>(sql`
    update reminders
       set status = case when attempts >= ${MAX_DELIVERY_ATTEMPTS} then 'failed' else 'pending' end,
           status_reason = case when attempts >= ${MAX_DELIVERY_ATTEMPTS} then 'error' else status_reason end,
           claim_token = null,
           -- Not before: the retry waits, while fire_at keeps the time it was scheduled for.
           locked_until = case when attempts >= ${MAX_DELIVERY_ATTEMPTS} then null else ${retryAt}::timestamptz end, updated_at = now()
     where id = ${id} and claim_token = ${token}::uuid
     returning status`);
  return rows.rows[0]?.status === "failed" ? "failed" : "retry";
}

/**
 * Decide and deliver one claimed reminder, in one transaction under a row
 * lock. The record, membership and preferences are read NOW; the stored
 * target must still match, or the job is stale and is rescheduled / canceled
 * instead of delivered.
 */
export async function deliverClaimed(db: Db, id: string, token: string, now: Date, emailAvailable: boolean): Promise<Outcome> {
  const nowMs = now.getTime();
  return db.transaction(async (tx): Promise<Outcome> => {
    const [row] = await tx.select().from(reminders).where(and(eq(reminders.id, id), eq(reminders.claim_token, token))).for("update");
    if (!row || row.status !== "sending" || row.decided_at) return "lost";
    const ctx = await loadCtx(tx, row);
    const d = evaluate(row, ctx, nowMs, true);
    if (d.kind === "cancel") {
      await applyCancel(tx, row, d);
      return "canceled";
    }
    if (ms(row.target_at) !== d.targetMs) {
      // The record moved since this was scheduled: never deliver the old time.
      await reconcileRow(tx, { ...row, status: "pending", claim_token: null }, ctx, nowMs);
      return "rescheduled";
    }
    if (d.plan.state === "skip") {
      await tx
        .update(reminders)
        .set({ status: "skipped", status_reason: d.plan.reason, adjustment_note: d.plan.note, claim_token: null, locked_until: null, fire_at: null, email_status: "none", updated_at: sql`now()` })
        .where(eq(reminders.id, row.id));
      return "skipped";
    }
    if (!d.snoozed && d.plan.fireAtMs > nowMs + 1000) {
      // Delivering now would break quiet hours: hold it (tasks) for the time the plan now says.
      await tx
        .update(reminders)
        .set({ status: "pending", fire_at: iso(d.plan.fireAtMs), expires_at: iso(d.plan.expiresAtMs), adjustment: d.plan.adjustment === "none" ? null : d.plan.adjustment, adjustment_note: d.plan.note, claim_token: null, locked_until: null, attempts: 0, updated_at: sql`now()` })
        .where(eq(reminders.id, row.id));
      return "rescheduled";
    }
    if (!ctx.subject) return "canceled";

    const address = ctx.prefs.email && emailAvailable ? await profileEmail(tx, row.recipient_id) : null;
    const wantsEmail = Boolean(address);
    const wantsInApp = ctx.prefs.in_app;
    if (!wantsInApp && !wantsEmail) {
      await tx.update(reminders).set({ status: "skipped", status_reason: "no_channel", claim_token: null, locked_until: null, updated_at: sql`now()` }).where(eq(reminders.id, row.id));
      return "skipped";
    }
    const text = wording(row, ctx.subject, d.target, nowMs);
    let createdInbox = 0;
    if (wantsInApp) {
      createdInbox = await createNotifications(tx, [
        {
          type: "reminder",
          recipientId: row.recipient_id,
          actorId: null,
          tripId: row.trip_id,
          reminderId: row.id,
          occurrence: row.occurrence,
          subject: row.subject_type as ReminderSubject,
          subjectId: (row.reservation_id ?? row.packing_item_id)!,
          dedupeKey: dedupeKeys.reminder(row.id, row.occurrence),
          title: text.title,
          body: text.body,
        },
      ]);
    }
    await tx
      .update(reminders)
      .set({
        status: wantsInApp ? "sent" : "sending",
        decided_at: stamp(now),
        in_app_sent_at: wantsInApp ? stamp(now) : null,
        sent_at: wantsInApp ? stamp(now) : null,
        claim_token: null,
        locked_until: null,
        email_status: wantsEmail ? "pending" : "none",
        email_next_at: wantsEmail ? stamp(now) : null,
        updated_at: sql`now()`,
      })
      .where(eq(reminders.id, row.id));
    return wantsInApp && createdInbox === 0 ? "duplicate" : "sent";
  });
}

const stamp = (d: Date) => d.toISOString();

async function runEmailPhase(db: Db, now: Date, send: ReminderSender, report: RunReport, batch: number) {
  const ts = stamp(now);
  const claimed = await db.execute<{ id: string; occurrence: number; email_attempts: number }>(sql`
    update reminders set email_status = 'sending', email_attempts = email_attempts + 1,
           email_locked_until = ${ts}::timestamptz + make_interval(mins => ${CLAIM_LEASE_MINUTES}), updated_at = now()
    where id in (
      select id from reminders
      where decided_at is not null and status in ('sent', 'sending') and expires_at > ${ts}::timestamptz
        and email_attempts < ${MAX_EMAIL_ATTEMPTS}
        and ((email_status in ('pending', 'failed') and coalesce(email_next_at, ${ts}::timestamptz) <= ${ts}::timestamptz)
          or (email_status = 'sending' and email_locked_until < ${ts}::timestamptz))
      order by email_next_at nulls first
      limit ${batch}
      for update skip locked)
    returning id, occurrence, email_attempts`);

  for (const c of claimed.rows) {
    try {
      // Re-check under lock: still the same occurrence, still wanted, still allowed.
      const prep = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(reminders).where(eq(reminders.id, c.id)).for("update");
        if (!row || row.occurrence !== c.occurrence || row.email_status !== "sending") return null;
        const ctx = await loadCtx(tx, row);
        const d = evaluate(row, { ...ctx }, now.getTime(), true);
        const to = ctx.prefs.email ? await profileEmail(tx, row.recipient_id) : null;
        const stale = d.kind !== "active" || !ctx.subject || ms(row.target_at) !== d.targetMs || (d.kind === "active" && ctx.subject.kind === "booking" && d.target.atMs! <= now.getTime());
        if (stale || !to) {
          if (d.kind === "cancel") await applyCancel(tx, row, d);
          await tx.update(reminders).set({ email_status: "skipped", ...(row.status === "sending" ? { status: "skipped", status_reason: stale ? (d.kind === "cancel" ? d.reason : "expired") : "no_channel" } : {}), updated_at: sql`now()` }).where(and(eq(reminders.id, row.id), eq(reminders.occurrence, c.occurrence)));
          return null;
        }
        const target = (d as Extract<Desired, { kind: "active" }>).target;
        return { row, to, text: wording(row, ctx.subject!, target, now.getTime()) };
      });
      if (!prep) {
        report.emailSkipped++;
        continue;
      }
      const result = await send({
        to: prep.to,
        tripId: prep.row.trip_id,
        subject: prep.row.subject_type as ReminderSubject,
        subjectId: (prep.row.reservation_id ?? prep.row.packing_item_id)!,
        title: prep.text.title,
        body: prep.text.body,
        idempotencyKey: `reminder:${prep.row.id}:${prep.row.occurrence}`,
      });
      if (result === "sent") {
        await db.execute(sql`
          update reminders set email_status = 'sent', email_sent_at = ${ts}::timestamptz, email_locked_until = null,
                 status = case when status = 'sending' then 'sent' else status end,
                 sent_at = coalesce(sent_at, ${ts}::timestamptz), updated_at = now()
          where id = ${c.id} and occurrence = ${c.occurrence}`);
        report.emailSent++;
      } else {
        const next = new Date(now.getTime() + c.email_attempts * 2 * 60_000).toISOString();
        const final = c.email_attempts >= MAX_EMAIL_ATTEMPTS;
        await db.execute(sql`
          update reminders set email_status = 'failed', email_locked_until = null, email_next_at = ${next}::timestamptz,
                 status = case when ${final} and status = 'sending' then 'failed' else status end,
                 status_reason = case when ${final} and status = 'sending' then 'error' else status_reason end, updated_at = now()
          where id = ${c.id} and occurrence = ${c.occurrence}`);
        report.emailFailed++;
      }
    } catch (error) {
      report.emailFailed++;
      console.error("[rove] reminder email failed:", (error as Error)?.name);
      await db.execute(sql`update reminders set email_status = 'failed', email_locked_until = null, email_next_at = ${new Date(now.getTime() + 120_000).toISOString()}::timestamptz where id = ${c.id} and occurrence = ${c.occurrence} and email_status = 'sending'`);
    }
  }
}
