/**
 * Reminders — the pure, client-safe half: presets, when a reminder fires,
 * quiet hours, freshness windows, the minimal notification wording and the
 * preview sentence. Nothing here touches the database or secrets; the
 * persistence, the worker and the authorization checks live in
 * src/db/reminders.ts (reached only through src/lib/dal.ts).
 *
 * Times: a booking moment is a local wall-clock date + time plus the IANA zone
 * it happens in (a flight keeps its departure airport's zone). A task's due
 * moment is wall-clock in the zone saved with it (the trip's zone when it was
 * set). Instants are derived only to compare and schedule; the stored
 * wall-clock values are never rewritten through UTC.
 */
import { zonedInstant, isValidTimeZone, timeZoneLabel } from "@/lib/time-zones";

/* ------------------------------ vocabulary ------------------------------ */

export type ReminderSubject = "booking" | "task";

export const BOOKING_PRESETS = ["24h", "2h", "custom", "off"] as const;
export const TASK_PRESETS = ["at_due", "1d_before", "custom", "off"] as const;
export type ReminderPreset = "24h" | "2h" | "at_due" | "1d_before" | "custom";
export type PresetChoice = ReminderPreset | "off";

export const PRESET_LABEL: Record<PresetChoice, string> = {
  "24h": "24 hours before",
  "2h": "2 hours before",
  at_due: "At due time",
  "1d_before": "1 day before",
  custom: "Custom",
  off: "Off",
};

export const REMINDER_STATUSES = ["pending", "sending", "sent", "failed", "skipped", "canceled"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export const EMAIL_STATUSES = ["none", "pending", "sending", "sent", "failed", "skipped"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Why a reminder is not (or no longer) going to be delivered. Stored in `status_reason`. */
export const REASONS = [
  "past", // the reminder time had already passed
  "started", // the booking has begun
  "expired", // outside its freshness window (e.g. the scheduler was down)
  "quiet_hours", // falls in the recipient's quiet hours and nothing useful was possible
  "booking_cancelled",
  "booking_unscheduled", // no start date / time any more
  "task_done",
  "no_due", // the task no longer has a due date
  "task_unassigned",
  "reassigned",
  "not_member",
  "recipient_off", // the recipient turned reminders off
  "recipient_muted", // the recipient turned this one off
  "off", // a manager turned it off
  "unselected", // a manager removed this person from the booking's reminder
  "rule_invalid", // the task lost the time this reminder counted down to
  "no_channel", // nowhere to deliver (inbox off, email unavailable)
  "error", // gave up after repeated failures
] as const;
export type ReminderReason = (typeof REASONS)[number];

/** Canceled for these reasons → comes back by itself if the cause goes away (and the time is still ahead). */
export const REVIVABLE: readonly ReminderReason[] = ["booking_cancelled", "booking_unscheduled", "task_done", "no_due", "recipient_off"];

export const MAX_LEAD_MINUTES = 30 * 24 * 60;
export const MAX_DAYS_BEFORE = 30;
export const MAX_DELIVERY_ATTEMPTS = 3;
export const MAX_EMAIL_ATTEMPTS = 3;
export const CLAIM_LEASE_MINUTES = 5;
export const HEARTBEAT_FRESH_MINUTES = 20;

/** How long after its time a reminder is still worth delivering. Never past the booking's start. */
export const BOOKING_FRESHNESS_MINUTES = 30;
export const TASK_FRESHNESS_MINUTES = 120;
/** A booking reminder may be moved earlier (before quiet hours) by at most this much. */
export const MAX_EARLIER_SHIFT_MINUTES = 180;
/** A snooze needs at least this long; a booking snooze must still end before the booking starts. */
export const MIN_SNOOZE_MINUTES = 5;
export const DEFAULT_TASK_TIME = "09:00";

const MIN = 60_000;
const DAY = 86_400_000;

/* ------------------------------- the rule ------------------------------- */

/** When, relative to the due moment. `lead` = N minutes before an exact moment; `day` = N days before, at a local time (date-only tasks). */
export type ReminderRule = { kind: "lead"; leadMinutes: number } | { kind: "day"; daysBefore: number; localTime: string };

export type RuleInput = {
  preset: ReminderPreset;
  /** custom, exact-moment subjects */
  customAmount?: number;
  customUnit?: "minutes" | "hours" | "days";
  /** date-only tasks: how many days before (custom) */
  customDays?: number;
  /** date-only tasks: the time of day to remind; required, never assumed */
  localTime?: string | null;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClockTime = (v: unknown): v is string => typeof v === "string" && TIME.test(v);
export const trimTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export type RuleResult = { ok: true; rule: ReminderRule } | { ok: false; error: string };

/** Turns what the setup form sent into a rule, or says what is wrong. `dateOnly` = a task with a date but no time. */
export function buildRule(subject: ReminderSubject, input: RuleInput, dateOnly: boolean): RuleResult {
  const { preset } = input;
  if (subject === "booking") {
    if (preset === "24h") return { ok: true, rule: { kind: "lead", leadMinutes: 1440 } };
    if (preset === "2h") return { ok: true, rule: { kind: "lead", leadMinutes: 120 } };
    if (preset !== "custom") return { ok: false, error: "Choose when to remind." };
  } else if (!dateOnly) {
    if (preset === "at_due") return { ok: true, rule: { kind: "lead", leadMinutes: 0 } };
    if (preset === "1d_before") return { ok: true, rule: { kind: "lead", leadMinutes: 1440 } };
    if (preset !== "custom") return { ok: false, error: "Choose when to remind." };
  }
  if (subject === "task" && dateOnly) {
    // A date alone is not a moment: the person picks the time of day (or accepts the displayed default).
    if (!isClockTime(input.localTime)) return { ok: false, error: "Choose a reminder time of day." };
    if (preset === "at_due") return { ok: true, rule: { kind: "day", daysBefore: 0, localTime: input.localTime } };
    if (preset === "1d_before") return { ok: true, rule: { kind: "day", daysBefore: 1, localTime: input.localTime } };
    if (preset !== "custom") return { ok: false, error: "Choose when to remind." };
    const days = input.customDays;
    if (!Number.isInteger(days) || days! < 0 || days! > MAX_DAYS_BEFORE) return { ok: false, error: `Days before must be 0–${MAX_DAYS_BEFORE}.` };
    return { ok: true, rule: { kind: "day", daysBefore: days!, localTime: input.localTime } };
  }
  const amount = input.customAmount;
  const unit = input.customUnit ?? "hours";
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < (subject === "task" ? 0 : 1)) {
    return { ok: false, error: "Enter a whole number for the custom time." };
  }
  const minutes = amount * (unit === "minutes" ? 1 : unit === "hours" ? 60 : 1440);
  if (minutes > MAX_LEAD_MINUTES) return { ok: false, error: "Custom reminders can be at most 30 days ahead." };
  return { ok: true, rule: { kind: "lead", leadMinutes: minutes } };
}

/** "2 hours before", "1 day before at 9:00 AM" … for lists. */
export function describeRule(rule: ReminderRule): string {
  if (rule.kind === "day") {
    const when = rule.daysBefore === 0 ? "On the due date" : rule.daysBefore === 1 ? "1 day before" : `${rule.daysBefore} days before`;
    return `${when} at ${clock12(rule.localTime)}`;
  }
  const m = rule.leadMinutes;
  if (m === 0) return "At due time";
  if (m % 1440 === 0) return `${m / 1440} ${m === 1440 ? "day" : "days"} before`;
  if (m % 60 === 0) return `${m / 60} ${m === 60 ? "hour" : "hours"} before`;
  return `${m} minutes before`;
}

/** Which preset a stored rule corresponds to (for re-opening the form). */
export function presetOf(subject: ReminderSubject, rule: ReminderRule): ReminderPreset {
  if (rule.kind === "day") return rule.daysBefore === 0 ? "at_due" : rule.daysBefore === 1 ? "1d_before" : "custom";
  if (subject === "booking") return rule.leadMinutes === 1440 ? "24h" : rule.leadMinutes === 120 ? "2h" : "custom";
  return rule.leadMinutes === 0 ? "at_due" : rule.leadMinutes === 1440 ? "1d_before" : "custom";
}

/* ----------------------------- formatting ----------------------------- */

export function clock12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** "Aruba time" from "America/Aruba"; "New York time"; a bare zone like "UTC" stays "UTC". */
export function zoneName(zone: string) {
  if (!zone.includes("/")) return zone;
  return `${timeZoneLabel(zone).replace(/ \(.*\)$/, "")} time`;
}

function localParts(ms: number, zone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => f.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

export const localDateIn = (ms: number, zone: string) => localParts(ms, zone).date;

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** "October 16 at 11:00 AM" in `zone`. */
export function formatInstant(ms: number, zone: string) {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "long", day: "numeric" }).format(new Date(ms));
  const p = localParts(ms, zone);
  return `${date} at ${clock12(`${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`)}`;
}

/** "Remind Pavani on October 16 at 11:00 AM, Aruba time." */
export function previewSentence(name: string, fireAtMs: number, zone: string) {
  return `Remind ${name} on ${formatInstant(fireAtMs, zone)}, ${zoneName(zone)}.`;
}

/* -------------------------------- targets -------------------------------- */

/** What a reminder counts down to. `atMs` is null for a date-only task. */
export type Target = {
  atMs: number | null;
  date: string;
  time: string | null;
  zone: string;
  /** where the zone came from: the booking's own, the trip's (booking had none), or the task's */
  zoneSource: "booking" | "trip" | "task";
};

export type BookingLike = {
  status: string;
  kind: string;
  start_date: string | null;
  start_time: string | null;
  start_time_zone: string | null;
};

export type TargetResult = { ok: true; target: Target } | { ok: false; reason: "booking_cancelled" | "booking_unscheduled" | "no_due" };

/**
 * A booking qualifies only when its stored status is "confirmed" AND it has a
 * start date and time. Nothing is inferred from a title; a date-only booking
 * has no moment to count down to, so it cannot be reminded.
 */
export function bookingTarget(b: BookingLike, tripZone: string): TargetResult {
  if (b.status !== "confirmed") return { ok: false, reason: "booking_cancelled" };
  if (!b.start_date || !b.start_time) return { ok: false, reason: "booking_unscheduled" };
  const own = b.start_time_zone && isValidTimeZone(b.start_time_zone) ? b.start_time_zone : null;
  const zone = own ?? tripZone;
  const time = b.start_time.slice(0, 5);
  const atMs = zonedInstant(b.start_date, time, zone);
  if (atMs === null) return { ok: false, reason: "booking_unscheduled" };
  return { ok: true, target: { atMs, date: b.start_date, time, zone, zoneSource: own ? "booking" : "trip" } };
}

export type TaskLike = { is_packed: boolean; due_date: string | null; due_time: string | null; due_time_zone: string | null };

export function taskTarget(t: TaskLike, tripZone: string): TargetResult | { ok: false; reason: "task_done" } {
  if (t.is_packed) return { ok: false, reason: "task_done" };
  if (!t.due_date) return { ok: false, reason: "no_due" };
  const zone = t.due_time_zone && isValidTimeZone(t.due_time_zone) ? t.due_time_zone : tripZone;
  const time = t.due_time ? t.due_time.slice(0, 5) : null;
  const atMs = time ? zonedInstant(t.due_date, time, zone) : null;
  if (time && atMs === null) return { ok: false, reason: "no_due" };
  return { ok: true, target: { atMs, date: t.due_date, time, zone, zoneSource: "task" } };
}

/* ------------------------------ quiet hours ------------------------------ */

export type QuietHours = { startMin: number; endMin: number; zone: string };

export function quietFrom(p: { quiet_enabled: boolean; quiet_start: string; quiet_end: string; quiet_zone: string | null }): QuietHours | null {
  if (!p.quiet_enabled || !p.quiet_zone || !isValidTimeZone(p.quiet_zone)) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const startMin = mins(p.quiet_start);
  const endMin = mins(p.quiet_end);
  return startMin === endMin ? null : { startMin, endMin, zone: p.quiet_zone };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** The quiet window containing `ms` ({start, end} instants), or null when `ms` is outside quiet hours. */
export function quietWindowAt(ms: number, q: QuietHours): { startMs: number; endMs: number } | null {
  const { date, minutes } = localParts(ms, q.zone);
  const wraps = q.startMin > q.endMin;
  const inside = wraps ? minutes >= q.startMin || minutes < q.endMin : minutes >= q.startMin && minutes < q.endMin;
  if (!inside) return null;
  const startDate = wraps && minutes < q.endMin ? addDays(date, -1) : date;
  const endDate = wraps && minutes >= q.startMin ? addDays(date, 1) : date;
  const startMs = zonedInstant(startDate, hhmm(q.startMin), q.zone);
  const endMs = zonedInstant(endDate, hhmm(q.endMin), q.zone);
  return startMs === null || endMs === null ? null : { startMs, endMs };
}

/* -------------------------------- planning -------------------------------- */

export type Adjustment = "none" | "earlier" | "later" | "allowed";

export type FirePlan =
  | {
      state: "scheduled";
      naturalAtMs: number;
      fireAtMs: number;
      expiresAtMs: number;
      adjustment: Adjustment;
      /** plain-language account of an adjustment, for the recipient */
      note: string | null;
    }
  | { state: "skip"; reason: "past" | "started" | "quiet_hours" | "expired"; naturalAtMs: number | null; note: string | null };

/** The moment the rule fires, before quiet hours: lead minutes before the due moment, or N days before at a local time. */
export function naturalFireMs(rule: ReminderRule, target: Target): number | null {
  if (rule.kind === "lead") return target.atMs === null ? null : target.atMs - rule.leadMinutes * MIN;
  return zonedInstant(addDays(target.date, -rule.daysBefore), rule.localTime, target.zone);
}

/** The hard end of usefulness: a booking's start; a task's due moment (+ grace) or the end of its due date. */
export function limitMs(subject: ReminderSubject, target: Target): number {
  if (subject === "booking") return target.atMs!;
  if (target.atMs !== null) return target.atMs + TASK_FRESHNESS_MINUTES * MIN;
  return zonedInstant(addDays(target.date, 1), "00:00", target.zone)!;
}

const windowMs = (subject: ReminderSubject) => (subject === "booking" ? BOOKING_FRESHNESS_MINUTES : TASK_FRESHNESS_MINUTES) * MIN;

/** Freshness: never later than the window after the fire time, never past the hard limit. */
export const expiresAt = (subject: ReminderSubject, fireAtMs: number, target: Target) => Math.min(fireAtMs + windowMs(subject), limitMs(subject, target));

/**
 * When a reminder should actually be delivered.
 *
 * - The natural time is checked against the hard limit (a booking never fires
 *   at or after its start) and, for a first schedule, against `now`.
 * - Quiet hours: a BOOKING reminder falling inside them moves EARLIER, to the
 *   moment quiet hours begin, only if that is still ahead and not more than
 *   MAX_EARLIER_SHIFT_MINUTES sooner; otherwise it is skipped with
 *   `quiet_hours` (the recipient can choose to allow it). A TASK reminder
 *   moves LATER, to the moment quiet hours end, if that is still before it is
 *   due; otherwise it is skipped the same way. Nothing is ever moved silently:
 *   `note` says what happened.
 * - `allowQuiet` (the recipient's explicit choice) delivers at the natural time.
 */
export function planFire(input: {
  subject: ReminderSubject;
  rule: ReminderRule;
  target: Target;
  nowMs: number;
  quiet: QuietHours | null;
  allowQuiet: boolean;
}): FirePlan {
  const { subject, rule, target, nowMs, quiet, allowQuiet } = input;
  const natural = naturalFireMs(rule, target);
  if (natural === null) return { state: "skip", reason: "past", naturalAtMs: null, note: null };
  const limit = limitMs(subject, target);
  if (subject === "booking" && nowMs >= limit) return { state: "skip", reason: "started", naturalAtMs: natural, note: "The booking has already started." };

  // The moment the reminder is MEANT for (before any quiet-hours move). Freshness counts from the
  // intended moment, so a late worker cannot make an old reminder look new.
  let fire = natural;
  let adjustment: Adjustment = "none";
  let note: string | null = null;
  const window = quiet && !allowQuiet ? quietWindowAt(natural, quiet) : null;
  if (window && quiet) {
    if (subject === "booking") {
      const earlier = window.startMs;
      const shift = natural - earlier;
      if (earlier > nowMs && shift <= MAX_EARLIER_SHIFT_MINUTES * MIN) {
        fire = earlier;
        adjustment = "earlier";
        note = `Moved earlier to ${formatInstant(earlier, quiet.zone)} so it arrives before your quiet hours.`;
      } else {
        return { state: "skip", reason: "quiet_hours", naturalAtMs: natural, note: "This falls in your quiet hours, so it won’t be sent unless you choose to allow it." };
      }
    } else {
      const later = window.endMs;
      if (later < limit && (target.atMs === null || later < target.atMs)) {
        fire = later;
        adjustment = "later";
        note = `Held until ${formatInstant(later, quiet.zone)}, when your quiet hours end.`;
      } else {
        return { state: "skip", reason: "quiet_hours", naturalAtMs: natural, note: "This falls in your quiet hours and can’t wait until they end, so it won’t be sent unless you choose to allow it." };
      }
    }
  } else if (allowQuiet && quiet && quietWindowAt(natural, quiet)) {
    adjustment = "allowed";
    note = "Delivered during your quiet hours because you allowed it.";
  }

  const expires = expiresAt(subject, fire, target);
  if (expires <= fire) return { state: "skip", reason: subject === "booking" ? "started" : "past", naturalAtMs: natural, note: null };
  // Scheduling never reaches back: a time that has already gone by is not created.
  if (fire < nowMs - MIN) return { state: "skip", reason: "past", naturalAtMs: natural, note: null };
  return { state: "scheduled", naturalAtMs: natural, fireAtMs: fire, expiresAtMs: expires, adjustment, note };
}

/**
 * The same plan, re-derived at DELIVERY time from the live record and
 * preferences. It replays the scheduling decision as of just before the stored
 * fire time (so a reminder that was deliberately moved earlier for quiet hours
 * is not re-judged from the moment it was moved to), then applies the rules
 * that only the real clock can: a booking that has started is never delivered,
 * and nothing is delivered after its freshness window.
 */
export function planDelivery(input: {
  subject: ReminderSubject;
  rule: ReminderRule;
  target: Target;
  nowMs: number;
  /** what was stored when it was scheduled: the (possibly quiet-hour-adjusted) fire time and the natural one */
  storedFireMs: number | null;
  storedNaturalMs: number | null;
  quiet: QuietHours | null;
  allowQuiet: boolean;
}): FirePlan {
  const { subject, target, nowMs } = input;
  const replay = Math.min(nowMs, (input.storedFireMs ?? nowMs) - 1, (input.storedNaturalMs ?? nowMs) - 1);
  const plan = planFire({ subject, rule: input.rule, target, nowMs: replay, quiet: input.quiet, allowQuiet: input.allowQuiet });
  if (plan.state === "skip") return plan;
  if (subject === "booking" && nowMs >= target.atMs!) return { state: "skip", reason: "started", naturalAtMs: plan.naturalAtMs, note: "The booking has already started." };
  if (plan.expiresAtMs <= nowMs) return { state: "skip", reason: "expired", naturalAtMs: plan.naturalAtMs, note: null };
  return plan;
}

/** A snooze: an explicit time. Booking snoozes must end before the booking starts. */
export function planSnooze(input: { subject: ReminderSubject; target: Target; atMs: number; nowMs: number }):
  | { ok: true; fireAtMs: number; expiresAtMs: number }
  | { ok: false; error: string; afterStart?: boolean } {
  const { subject, target, atMs, nowMs } = input;
  if (!Number.isFinite(atMs) || atMs < nowMs + MIN_SNOOZE_MINUTES * MIN - 1000) return { ok: false, error: `Choose a time at least ${MIN_SNOOZE_MINUTES} minutes from now.` };
  if (atMs > nowMs + 30 * DAY) return { ok: false, error: "Snooze for at most 30 days." };
  const limit = limitMs(subject, target);
  if (subject === "booking" && atMs >= limit) {
    return { ok: false, afterStart: true, error: "That’s after this booking starts, so a reminder then would be too late. Pick an earlier time." };
  }
  if (subject === "task" && atMs >= limit) return { ok: false, error: "That’s after this task is due. Pick an earlier time." };
  return { ok: true, fireAtMs: atMs, expiresAtMs: expiresAt(subject, atMs, target) };
}

/** The snooze choices offered under a reminder: a few quick ones that are still before the limit. */
export function snoozeChoices(input: { subject: ReminderSubject; target: Target; nowMs: number }) {
  const { subject, target, nowMs } = input;
  const limit = limitMs(subject, target);
  const options: { id: string; label: string; atMs: number }[] = [];
  const push = (id: string, label: string, atMs: number) => {
    if (atMs < limit && atMs >= nowMs + MIN_SNOOZE_MINUTES * MIN) options.push({ id, label, atMs });
  };
  push("15m", "In 15 minutes", nowMs + 15 * MIN);
  push("1h", "In 1 hour", nowMs + 60 * MIN);
  if (subject === "task") {
    const today = localDateIn(nowMs, target.zone);
    push("tonight", "This evening (6:00 PM)", zonedInstant(today, "18:00", target.zone) ?? 0);
    push("tomorrow", "Tomorrow at 9:00 AM", zonedInstant(addDays(today, 1), "09:00", target.zone) ?? 0);
  }
  return options;
}

/* -------------------------------- wording -------------------------------- */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function span(minutes: number) {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  if (m < 90) return "1 hour";
  if (m < 36 * 60) {
    const h = Math.round(m / 60);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const d = Math.round(m / 1440);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

const DEPARTS = new Set(["flight", "train"]);

/** “Sunset Spa” starts in 2 hours. Title only — never a confirmation code, unit, address or note. */
export function bookingText(b: { title: string; kind: string }, startMs: number, nowMs: number) {
  const verb = DEPARTS.has(b.kind) ? "departs" : "starts";
  const remaining = (startMs - nowMs) / MIN;
  return { title: "Booking reminder", body: `Your “${clip(b.title, 80)}” ${verb} in ${span(remaining)}.` };
}

/** Your task “Aruba packing” is due today. */
export function taskText(t: { label: string }, target: Target, nowMs: number) {
  const label = clip(t.label, 80);
  let phrase: string;
  if (target.atMs !== null && target.atMs - nowMs <= 90 * MIN && target.atMs - nowMs > -15 * MIN) {
    const mins = (target.atMs - nowMs) / MIN;
    phrase = mins <= 5 ? "due now" : `due in ${span(mins)}`;
  } else if (target.atMs !== null && target.atMs < nowMs) {
    phrase = "past due";
  } else {
    const today = localDateIn(nowMs, target.zone);
    phrase = target.date === today ? "due today" : target.date === addDays(today, 1) ? "due tomorrow" : `due ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${target.date}T00:00:00Z`))}`;
  }
  return { title: "Task reminder", body: `Your task “${label}” is ${phrase}.` };
}

/* --------------------------- what the browser gets --------------------------- */

/** One reminder, as the setup / detail UI shows it. Plain data. */
export type ReminderView = {
  id: string;
  recipient: { id: string; name: string; isYou: boolean };
  preset: ReminderPreset;
  rule: ReminderRule;
  ruleText: string;
  status: ReminderStatus;
  reason: ReminderReason | null;
  /** snoozed = a snooze is the pending occurrence */
  snoozed: boolean;
  fireAt: string | null;
  fireText: string | null;
  zone: string;
  zoneName: string;
  /** inbox / email, as the recipient chose them */
  channels: { inApp: boolean; email: boolean };
  inAppSentAt: string | null;
  emailStatus: EmailStatus;
  /** shown to the recipient only */
  adjustmentNote: string | null;
  adjusted: boolean;
  canSnooze: boolean;
  canAllowQuiet: boolean;
};

export type MemberChoice = { id: string; name: string; role: "owner" | "editor" | "viewer"; isYou: boolean };

/** Short, honest label of where a reminder stands. */
export function statusText(v: Pick<ReminderView, "status" | "reason" | "snoozed" | "fireText" | "emailStatus" | "channels" | "inAppSentAt">): string {
  if (v.status === "sent") {
    const parts = [v.channels.inApp && v.inAppSentAt ? "Sent to inbox" : null];
    if (v.emailStatus === "sent") parts.push("emailed");
    else if (v.emailStatus === "failed") parts.push("email failed");
    else if (v.emailStatus === "pending" || v.emailStatus === "sending") parts.push("email on its way");
    return parts.filter(Boolean).join(" · ") || "Sent";
  }
  if (v.status === "sending") return v.emailStatus === "pending" || v.emailStatus === "sending" ? "Email on its way" : "Sending";
  if (v.status === "pending") return v.snoozed ? `Snoozed until ${v.fireText ?? "later"}` : `Pending · ${v.fireText ?? ""}`.trim();
  if (v.status === "failed") return "Failed";
  if (v.status === "skipped") return REASON_TEXT[v.reason ?? "expired"] ?? "Skipped";
  return REASON_TEXT[v.reason ?? "off"] ?? "Canceled";
}

export const REASON_TEXT: Partial<Record<ReminderReason, string>> = {
  past: "Not scheduled — that time had passed",
  started: "Skipped — it had already started",
  expired: "Skipped — too late to be useful",
  quiet_hours: "Not sent — quiet hours",
  booking_cancelled: "Canceled — booking cancelled",
  booking_unscheduled: "Canceled — booking has no start time",
  task_done: "Canceled — task completed",
  no_due: "Canceled — no due date",
  task_unassigned: "Canceled — task unassigned",
  reassigned: "Canceled — task reassigned",
  not_member: "Canceled — no longer on the trip",
  recipient_off: "Paused — reminders are off for them",
  recipient_muted: "Turned off by the recipient",
  off: "Off",
  unselected: "Canceled — no longer a recipient",
  rule_invalid: "Canceled — the due time was removed",
  no_channel: "Skipped — nowhere to deliver",
  error: "Failed after several tries",
};

/* ------------------------- shared by the screens ------------------------- */

export type ReminderPrefs = {
  enabled: boolean;
  in_app: boolean;
  email: boolean;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  quiet_zone: string | null;
  default_task_time: string;
};

export type EmailAvailability = { providerConfigured: boolean; hasAddress: boolean };

export type ReminderPanel = {
  subject: {
    type: ReminderSubject;
    id: string;
    title: string;
    eligible: boolean;
    problem: string | null;
    /** a date with no time: the person must pick a time of day */
    dateOnly: boolean;
    whenText: string | null;
    zone: string | null;
    zoneName: string | null;
    zoneNote: string | null;
    assigneeId: string | null;
    /** the hard end of usefulness (a booking's start); a snooze must end before it */
    limitAtMs: number | null;
  };
  /** quick snooze choices for the viewer's own reminder, from the live record */
  snoozeOptions: { id: string; label: string; atMs: number }[];
  people: MemberChoice[];
  reminders: ReminderView[];
  /** the viewer's own default time of day for date-only tasks (shown, never silently applied) */
  defaultTaskTime: string;
  scheduler: { active: boolean; lastRunAt: string | null };
  email: EmailAvailability;
};

export type OverviewRow = {
  type: ReminderSubject;
  id: string;
  title: string;
  whenText: string;
  /** 0 = nothing set up yet */
  active: number;
  summary: string | null;
};

