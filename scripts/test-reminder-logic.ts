/**
 * Reminder logic that needs no database: presets and custom times, which
 * records qualify, time zones (incl. a flight's departure zone), quiet hours,
 * freshness, snooze limits and the wording. Also run with
 * TZ=Pacific/Kiritimati and TZ=Pacific/Pago_Pago — nothing depends on the
 * machine's zone.
 *
 *   npm run test:reminder-logic
 */
import assert from "node:assert/strict";
import {
  BOOKING_FRESHNESS_MINUTES,
  MAX_EARLIER_SHIFT_MINUTES,
  TASK_FRESHNESS_MINUTES,
  bookingTarget,
  bookingText,
  buildRule,
  describeRule,
  expiresAt,
  formatInstant,
  planDelivery,
  planFire,
  planSnooze,
  presetOf,
  previewSentence,
  quietFrom,
  quietWindowAt,
  snoozeChoices,
  taskTarget,
  taskText,
  zoneName,
  type QuietHours,
  type ReminderRule,
} from "../src/lib/reminders";
import { zonedInstant } from "../src/lib/time-zones";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const ARUBA = "America/Aruba"; // UTC−4, no DST
const MIN = 60_000;
const at = (date: string, hhmm: string, zone = ARUBA) => zonedInstant(date, hhmm, zone)!;
const confirmed = (over: Record<string, unknown> = {}) => ({ status: "confirmed", kind: "activity", start_date: "2026-10-16", start_time: "11:00:00", start_time_zone: ARUBA, ...over });
const booking = (over: Record<string, unknown> = {}) => {
  const t = bookingTarget(confirmed(over), ARUBA);
  assert.ok(t.ok);
  return t.target;
};
const lead = (m: number): ReminderRule => ({ kind: "lead", leadMinutes: m });

console.log("Presets and custom times");
check("booking presets: 24 hours, 2 hours, custom; off is not a rule", () => {
  assert.deepEqual(buildRule("booking", { preset: "24h" }, false), { ok: true, rule: lead(1440) });
  assert.deepEqual(buildRule("booking", { preset: "2h" }, false), { ok: true, rule: lead(120) });
  assert.deepEqual(buildRule("booking", { preset: "custom", customAmount: 3, customUnit: "hours" }, false), { ok: true, rule: lead(180) });
  assert.deepEqual(buildRule("booking", { preset: "custom", customAmount: 2, customUnit: "days" }, false), { ok: true, rule: lead(2880) });
  assert.equal(buildRule("booking", { preset: "at_due" }, false).ok, false, "at due time is a task preset");
  assert.equal(buildRule("booking", { preset: "custom", customAmount: 0, customUnit: "minutes" }, false).ok, false, "a booking reminder needs a lead");
  assert.equal(buildRule("booking", { preset: "custom", customAmount: 31, customUnit: "days" }, false).ok, false, "at most 30 days ahead");
  assert.equal(buildRule("booking", { preset: "custom", customAmount: 1.5, customUnit: "hours" }, false).ok, false);
});
check("task presets with a due time: at due time, 1 day before, custom", () => {
  assert.deepEqual(buildRule("task", { preset: "at_due" }, false), { ok: true, rule: lead(0) });
  assert.deepEqual(buildRule("task", { preset: "1d_before" }, false), { ok: true, rule: lead(1440) });
  assert.deepEqual(buildRule("task", { preset: "custom", customAmount: 90, customUnit: "minutes" }, false), { ok: true, rule: lead(90) });
});
check("a date with no time is never treated as midnight: the person must choose a time of day", () => {
  assert.equal(buildRule("task", { preset: "at_due" }, true).ok, false);
  assert.equal(buildRule("task", { preset: "at_due", localTime: "" }, true).ok, false);
  assert.deepEqual(buildRule("task", { preset: "at_due", localTime: "09:00" }, true), { ok: true, rule: { kind: "day", daysBefore: 0, localTime: "09:00" } });
  assert.deepEqual(buildRule("task", { preset: "1d_before", localTime: "18:30" }, true), { ok: true, rule: { kind: "day", daysBefore: 1, localTime: "18:30" } });
  assert.deepEqual(buildRule("task", { preset: "custom", customDays: 3, localTime: "08:00" }, true), { ok: true, rule: { kind: "day", daysBefore: 3, localTime: "08:00" } });
  assert.equal(buildRule("task", { preset: "custom", customDays: 31, localTime: "08:00" }, true).ok, false);
});
check("rules read back as their preset and as plain words", () => {
  assert.equal(presetOf("booking", lead(1440)), "24h");
  assert.equal(presetOf("booking", lead(120)), "2h");
  assert.equal(presetOf("booking", lead(45)), "custom");
  assert.equal(presetOf("task", lead(0)), "at_due");
  assert.equal(presetOf("task", { kind: "day", daysBefore: 1, localTime: "09:00" }), "1d_before");
  assert.equal(describeRule(lead(120)), "2 hours before");
  assert.equal(describeRule(lead(1440)), "1 day before");
  assert.equal(describeRule(lead(0)), "At due time");
  assert.equal(describeRule({ kind: "day", daysBefore: 1, localTime: "09:00" }), "1 day before at 9:00 AM");
});

console.log("Which records qualify");
check("only a CONFIRMED booking with a start date and time qualifies — nothing is inferred", () => {
  assert.equal(bookingTarget(confirmed(), ARUBA).ok, true);
  assert.deepEqual(bookingTarget(confirmed({ status: "cancelled" }), ARUBA), { ok: false, reason: "booking_cancelled" });
  assert.deepEqual(bookingTarget(confirmed({ status: "proposed" }), ARUBA), { ok: false, reason: "booking_cancelled" }, "any status other than confirmed");
  assert.deepEqual(bookingTarget(confirmed({ start_time: null }), ARUBA), { ok: false, reason: "booking_unscheduled" });
  assert.deepEqual(bookingTarget(confirmed({ start_date: null, start_time: null }), ARUBA), { ok: false, reason: "booking_unscheduled" });
});
check("tasks: a completed task or one with no due date does not qualify; a date alone is date-only", () => {
  const task = (over: Record<string, unknown> = {}) => ({ is_packed: false, due_date: "2026-10-16", due_time: "11:00:00", due_time_zone: ARUBA, ...over });
  assert.deepEqual(taskTarget(task({ is_packed: true }), ARUBA), { ok: false, reason: "task_done" });
  assert.deepEqual(taskTarget(task({ due_date: null, due_time: null, due_time_zone: null }), ARUBA), { ok: false, reason: "no_due" });
  const dateOnly = taskTarget(task({ due_time: null }), ARUBA);
  assert.ok(dateOnly.ok);
  assert.equal(dateOnly.target.atMs, null);
  const timed = taskTarget(task(), ARUBA);
  assert.ok(timed.ok);
  assert.equal(timed.target.atMs, Date.parse("2026-10-16T15:00:00Z"));
});

console.log("Time zones");
check("a booking is counted down in its OWN zone — a flight keeps its departure airport's zone", () => {
  const chicago = bookingTarget(confirmed({ kind: "flight", start_date: "2026-10-16", start_time: "08:20:00", start_time_zone: "America/Chicago" }), ARUBA);
  assert.ok(chicago.ok);
  assert.equal(chicago.target.zone, "America/Chicago");
  assert.equal(chicago.target.zoneSource, "booking");
  assert.equal(chicago.target.atMs, Date.parse("2026-10-16T13:20:00Z")); // CDT, UTC−5
  // The same wall clock read in the trip's zone would be a different moment — it must not be used.
  assert.notEqual(chicago.target.atMs, at("2026-10-16", "08:20"));
  const fire = planFire({ subject: "booking", rule: lead(1440), target: chicago.target, nowMs: Date.parse("2026-10-01T00:00:00Z"), quiet: null, allowQuiet: false });
  assert.equal(fire.state, "scheduled");
  assert.equal(fire.state === "scheduled" && fire.fireAtMs, Date.parse("2026-10-15T13:20:00Z"));
  assert.equal(previewSentence("Pavani", Date.parse("2026-10-15T13:20:00Z"), "America/Chicago"), "Remind Pavani on October 15 at 8:20 AM, Chicago time.");
});
check("a booking with no zone of its own falls back to the trip's zone and says so", () => {
  const t = bookingTarget(confirmed({ start_time_zone: null }), ARUBA);
  assert.ok(t.ok);
  assert.equal(t.target.zone, ARUBA);
  assert.equal(t.target.zoneSource, "trip");
  const bad = bookingTarget(confirmed({ start_time_zone: "Not/AZone" }), ARUBA);
  assert.ok(bad.ok);
  assert.equal(bad.target.zoneSource, "trip");
});
check("the preview sentence matches the spec's wording", () => {
  assert.equal(previewSentence("Pavani", at("2026-10-16", "11:00"), ARUBA), "Remind Pavani on October 16 at 11:00 AM, Aruba time.");
  assert.equal(zoneName("America/New_York"), "New York time");
  assert.equal(zoneName("UTC"), "UTC");
});
check("daylight saving: 24 hours before is 24 real hours, the wall clock follows the zone", () => {
  const NY = "America/New_York";
  // Booking Sunday 2026-03-08 12:00 EDT (spring forward at 02:00). 24 h before = Saturday 2026-03-07 11:00 EST.
  const t = bookingTarget(confirmed({ start_date: "2026-03-08", start_time: "12:00:00", start_time_zone: NY }), NY);
  assert.ok(t.ok);
  const plan = planFire({ subject: "booking", rule: lead(1440), target: t.target, nowMs: Date.parse("2026-03-01T00:00:00Z"), quiet: null, allowQuiet: false });
  assert.equal(plan.state === "scheduled" && formatInstant(plan.fireAtMs, NY), "March 7 at 11:00 AM");
  // A date-only task, "1 day before at 9:00 AM": a wall-clock rule, so 9:00 on the calendar day before in every zone.
  const d = taskTarget({ is_packed: false, due_date: "2026-03-09", due_time: null, due_time_zone: NY }, NY);
  assert.ok(d.ok);
  const dp = planFire({ subject: "task", rule: { kind: "day", daysBefore: 1, localTime: "09:00" }, target: d.target, nowMs: Date.parse("2026-03-01T00:00:00Z"), quiet: null, allowQuiet: false });
  assert.equal(dp.state === "scheduled" && formatInstant(dp.fireAtMs, NY), "March 8 at 9:00 AM");
  assert.equal(dp.state === "scheduled" && dp.fireAtMs, Date.parse("2026-03-08T13:00:00Z"), "9:00 AM EDT is 13:00Z");
});

console.log("When it fires, and freshness");
check("fires at lead minutes before; expires after the window but never after the booking starts", () => {
  const target = booking();
  const plan = planFire({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-15", "08:00"), quiet: null, allowQuiet: false });
  assert.equal(plan.state, "scheduled");
  if (plan.state !== "scheduled") return;
  assert.equal(plan.fireAtMs, at("2026-10-16", "09:00"));
  assert.equal(plan.expiresAtMs, at("2026-10-16", "09:00") + BOOKING_FRESHNESS_MINUTES * MIN);
  // A 20-minute lead: the window is cut off by the start itself.
  const short = planFire({ subject: "booking", rule: lead(20), target, nowMs: at("2026-10-15", "08:00"), quiet: null, allowQuiet: false });
  assert.equal(short.state === "scheduled" && short.expiresAtMs, target.atMs, "never later than the start");
  assert.equal(expiresAt("booking", target.atMs! - 5 * MIN, target), target.atMs);
});
check("a time that has already passed is not scheduled; a started booking never fires", () => {
  const target = booking();
  assert.deepEqual(planFire({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "09:30"), quiet: null, allowQuiet: false }), { state: "skip", reason: "past", naturalAtMs: at("2026-10-16", "09:00"), note: null });
  const started = planFire({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "11:00"), quiet: null, allowQuiet: false });
  assert.equal(started.state === "skip" && started.reason, "started");
  const stored = at("2026-10-16", "09:00");
  const deliver = (nowMs: number) => planDelivery({ subject: "booking", rule: lead(120), target, nowMs, storedFireMs: stored, storedNaturalMs: stored, quiet: null, allowQuiet: false });
  const deliveringLate = deliver(at("2026-10-16", "09:31"));
  assert.equal(deliveringLate.state === "skip" && deliveringLate.reason, "expired", "30 minutes after its time it is no longer fresh");
  assert.equal(deliver(at("2026-10-16", "09:10")).state, "scheduled");
  assert.equal(deliver(at("2026-10-16", "09:29")).state, "scheduled", "just inside the window");
  assert.equal(deliver(at("2026-10-16", "09:30")).state, "skip", "the window is 30 minutes, exclusive");
  assert.equal(planDelivery({ subject: "booking", rule: lead(20), target, nowMs: at("2026-10-16", "11:00"), storedFireMs: at("2026-10-16", "10:40"), storedNaturalMs: at("2026-10-16", "10:40"), quiet: null, allowQuiet: false }).state, "skip", "never at or after the start");
});
check("task freshness: two hours, and a date-only task's reminder is gone by the end of its due date", () => {
  const t = taskTarget({ is_packed: false, due_date: "2026-10-16", due_time: "11:00:00", due_time_zone: ARUBA }, ARUBA);
  assert.ok(t.ok);
  const atDue = planFire({ subject: "task", rule: lead(0), target: t.target, nowMs: at("2026-10-16", "10:00"), quiet: null, allowQuiet: false });
  assert.equal(atDue.state === "scheduled" && atDue.expiresAtMs, at("2026-10-16", "11:00") + TASK_FRESHNESS_MINUTES * MIN);
  const d = taskTarget({ is_packed: false, due_date: "2026-10-16", due_time: null, due_time_zone: ARUBA }, ARUBA);
  assert.ok(d.ok);
  const late = planFire({ subject: "task", rule: { kind: "day", daysBefore: 0, localTime: "22:00" }, target: d.target, nowMs: at("2026-10-16", "08:00"), quiet: null, allowQuiet: false });
  assert.equal(late.state === "scheduled" && late.expiresAtMs, at("2026-10-17", "00:00"), "cut off at midnight after the due date");
});

console.log("Quiet hours");
const quiet = (start: string, end: string, zone = ARUBA): QuietHours => quietFrom({ quiet_enabled: true, quiet_start: start, quiet_end: end, quiet_zone: zone })!;
check("quiet windows wrap midnight and are read in the recipient's zone", () => {
  const q = quiet("22:00", "07:00");
  const w = quietWindowAt(at("2026-10-16", "23:30"), q)!;
  assert.equal(w.startMs, at("2026-10-16", "22:00"));
  assert.equal(w.endMs, at("2026-10-17", "07:00"));
  const after = quietWindowAt(at("2026-10-17", "05:00"), q)!;
  assert.equal(after.startMs, at("2026-10-16", "22:00"));
  assert.equal(quietWindowAt(at("2026-10-16", "12:00"), q), null);
  assert.equal(quietWindowAt(at("2026-10-16", "07:00"), q), null, "quiet hours end exactly at the end time");
  // The same instant read in another zone is a different local time.
  const tokyo = quiet("22:00", "07:00", "Asia/Tokyo");
  assert.equal(quietWindowAt(at("2026-10-16", "23:30"), tokyo), null, "23:30 in Aruba is 12:30 the next day in Tokyo");
});
check("a booking reminder inside quiet hours moves EARLIER, before they begin, and says so", () => {
  const q = quiet("22:00", "07:00");
  const target = booking({ start_date: "2026-10-17", start_time: "00:30:00" }); // 2 h before = 22:30 the evening before
  const plan = planFire({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "12:00"), quiet: q, allowQuiet: false });
  assert.equal(plan.state, "scheduled");
  if (plan.state !== "scheduled") return;
  assert.equal(plan.adjustment, "earlier");
  assert.equal(plan.fireAtMs, at("2026-10-16", "22:00"));
  assert.ok(plan.fireAtMs < plan.naturalAtMs);
  assert.match(plan.note ?? "", /Moved earlier to October 16 at 10:00 PM/);
  assert.ok(plan.fireAtMs < target.atMs!, "still before the booking");
});
check("when moving earlier would not be useful (too far) or is no longer possible, it is skipped — never silently late", () => {
  const q = quiet("22:00", "07:00");
  // 06:00 booking, 2 h before = 04:00 — quiet hours began 6 h earlier (more than the allowed shift).
  const target = booking({ start_date: "2026-10-17", start_time: "06:00:00" });
  const plan = planFire({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "12:00"), quiet: q, allowQuiet: false });
  assert.equal(plan.state, "skip");
  assert.equal(plan.state === "skip" && plan.reason, "quiet_hours");
  assert.ok(6 * 60 > MAX_EARLIER_SHIFT_MINUTES);
  // Quiet hours already began (now is 22:10) and the reminder time is 22:30: nothing earlier is possible.
  const t2 = booking({ start_date: "2026-10-17", start_time: "00:30:00" });
  const p2 = planFire({ subject: "booking", rule: lead(120), target: t2, nowMs: at("2026-10-16", "22:10"), quiet: q, allowQuiet: false });
  assert.equal(p2.state === "skip" && p2.reason, "quiet_hours");
});
check("the recipient can choose to allow it: delivered at the natural time, labelled", () => {
  const q = quiet("22:00", "07:00");
  const target = booking({ start_date: "2026-10-17", start_time: "06:00:00" });
  const plan = planFire({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "12:00"), quiet: q, allowQuiet: true });
  assert.equal(plan.state, "scheduled");
  if (plan.state !== "scheduled") return;
  assert.equal(plan.adjustment, "allowed");
  assert.equal(plan.fireAtMs, at("2026-10-17", "04:00"));
});
check("a task reminder inside quiet hours is held until they end (if still before it is due), else skipped", () => {
  const q = quiet("22:00", "07:00");
  const t = taskTarget({ is_packed: false, due_date: "2026-10-17", due_time: "10:00:00", due_time_zone: ARUBA }, ARUBA);
  assert.ok(t.ok);
  const held = planFire({ subject: "task", rule: lead(600), target: t.target, nowMs: at("2026-10-16", "12:00"), quiet: q, allowQuiet: false }); // natural 00:00
  assert.equal(held.state === "scheduled" && held.adjustment, "later");
  assert.equal(held.state === "scheduled" && held.fireAtMs, at("2026-10-17", "07:00"));
  const tooLate = taskTarget({ is_packed: false, due_date: "2026-10-17", due_time: "06:30:00", due_time_zone: ARUBA }, ARUBA);
  assert.ok(tooLate.ok);
  const skipped = planFire({ subject: "task", rule: lead(60), target: tooLate.target, nowMs: at("2026-10-16", "12:00"), quiet: q, allowQuiet: false }); // natural 05:30, quiet ends 07:00 > due
  assert.equal(skipped.state === "skip" && skipped.reason, "quiet_hours");
});
check("delivery re-checks quiet hours: a reminder moved earlier stays valid; one that would land in quiet hours is not sent silently", () => {
  const q = quiet("22:00", "07:00");
  const target = booking({ start_date: "2026-10-17", start_time: "00:30:00" });
  // Scheduled for 22:00 (moved earlier from 22:30). The worker runs at 22:01 — still the same decision.
  const moved = planDelivery({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "22:01"), storedFireMs: at("2026-10-16", "22:00"), storedNaturalMs: at("2026-10-16", "22:30"), quiet: q, allowQuiet: false });
  assert.equal(moved.state, "scheduled");
  assert.equal(moved.state === "scheduled" && moved.fireAtMs, at("2026-10-16", "22:00"));
  // Quiet hours were switched on behind the app's back after a 22:30 schedule: not delivered at 22:35.
  const late = planDelivery({ subject: "booking", rule: lead(120), target, nowMs: at("2026-10-16", "22:35"), storedFireMs: at("2026-10-16", "22:30"), storedNaturalMs: at("2026-10-16", "22:30"), quiet: q, allowQuiet: false });
  assert.equal(late.state === "skip" && late.reason, "quiet_hours");
  // A task is held instead: the plan says when.
  const t = taskTarget({ is_packed: false, due_date: "2026-10-17", due_time: "10:00:00", due_time_zone: ARUBA }, ARUBA);
  assert.ok(t.ok);
  const held = planDelivery({ subject: "task", rule: lead(600), target: t.target, nowMs: at("2026-10-17", "00:01"), storedFireMs: at("2026-10-17", "07:00"), storedNaturalMs: at("2026-10-17", "00:00"), quiet: q, allowQuiet: false });
  assert.equal(held.state === "scheduled" && held.fireAtMs, at("2026-10-17", "07:00"));
});
check("quiet hours are off unless enabled with a zone and distinct times", () => {
  assert.equal(quietFrom({ quiet_enabled: false, quiet_start: "22:00", quiet_end: "07:00", quiet_zone: ARUBA }), null);
  assert.equal(quietFrom({ quiet_enabled: true, quiet_start: "22:00", quiet_end: "07:00", quiet_zone: null }), null);
  assert.equal(quietFrom({ quiet_enabled: true, quiet_start: "22:00", quiet_end: "22:00", quiet_zone: ARUBA }), null);
});

console.log("Snooze");
check("a snooze needs a few minutes' notice; a booking snooze must end before the booking starts", () => {
  const target = booking();
  const now = at("2026-10-16", "09:00");
  assert.equal(planSnooze({ subject: "booking", target, atMs: now + MIN, nowMs: now }).ok, false);
  const ok = planSnooze({ subject: "booking", target, atMs: now + 30 * MIN, nowMs: now });
  assert.equal(ok.ok, true);
  const late = planSnooze({ subject: "booking", target, atMs: at("2026-10-16", "11:00"), nowMs: now });
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.afterStart, true, "the warning that it would fall after the booking starts");
  assert.equal(planSnooze({ subject: "booking", target, atMs: at("2026-10-16", "12:00"), nowMs: now }).ok, false);
  assert.equal(planSnooze({ subject: "booking", target, atMs: now + 40 * 86_400_000, nowMs: now }).ok, false);
});
check("snooze choices never include a time after the limit", () => {
  const target = booking();
  const choices = snoozeChoices({ subject: "booking", target, nowMs: at("2026-10-16", "10:30") });
  assert.deepEqual(choices.map((c) => c.id), ["15m"], "an hour from 10:30 is after the 11:00 start");
  assert.ok(choices.every((c) => c.atMs < target.atMs!));
  const t = taskTarget({ is_packed: false, due_date: "2026-10-17", due_time: "10:00:00", due_time_zone: ARUBA }, ARUBA);
  assert.ok(t.ok);
  const task = snoozeChoices({ subject: "task", target: t.target, nowMs: at("2026-10-16", "13:00") });
  assert.deepEqual(task.map((c) => c.id), ["15m", "1h", "tonight", "tomorrow"]);
});

console.log("Wording");
check("minimal text: the title and the time left — never a confirmation code, unit, address or note", () => {
  const spa = bookingText({ title: "Spa appointment", kind: "activity" }, at("2026-10-16", "11:00"), at("2026-10-16", "09:00"));
  assert.equal(spa.body, "Your “Spa appointment” starts in 2 hours.");
  assert.equal(spa.title, "Booking reminder");
  assert.equal(bookingText({ title: "AA 1234", kind: "flight" }, at("2026-10-16", "11:00"), at("2026-10-15", "11:00")).body, "Your “AA 1234” departs in 24 hours.");
  assert.equal(bookingText({ title: "Dinner", kind: "restaurant" }, at("2026-10-16", "19:00"), at("2026-10-16", "18:30")).body, "Your “Dinner” starts in 30 minutes.");
  assert.equal(bookingText({ title: "Tour", kind: "activity" }, at("2026-10-18", "09:00"), at("2026-10-15", "09:00")).body, "Your “Tour” starts in 3 days.");
  const long = bookingText({ title: "x".repeat(200), kind: "other" }, at("2026-10-16", "11:00"), at("2026-10-16", "09:00"));
  assert.ok(long.body.length < 140);
  // The function only ever receives a title and a kind, so nothing else can leak in.
  assert.equal(bookingText.length, 3);
});
check("task wording: today, tomorrow, soon, now, and a date", () => {
  const dateOnly = taskTarget({ is_packed: false, due_date: "2026-10-16", due_time: null, due_time_zone: ARUBA }, ARUBA);
  assert.ok(dateOnly.ok);
  assert.equal(taskText({ label: "Aruba packing" }, dateOnly.target, at("2026-10-16", "09:00")).body, "Your task “Aruba packing” is due today.");
  assert.equal(taskText({ label: "Aruba packing" }, dateOnly.target, at("2026-10-15", "09:00")).body, "Your task “Aruba packing” is due tomorrow.");
  assert.equal(taskText({ label: "Aruba packing" }, dateOnly.target, at("2026-10-12", "09:00")).body, "Your task “Aruba packing” is due Oct 16.");
  const timed = taskTarget({ is_packed: false, due_date: "2026-10-16", due_time: "11:00:00", due_time_zone: ARUBA }, ARUBA);
  assert.ok(timed.ok);
  assert.equal(taskText({ label: "Pay deposit" }, timed.target, at("2026-10-16", "10:15")).body, "Your task “Pay deposit” is due in 45 minutes.");
  assert.equal(taskText({ label: "Pay deposit" }, timed.target, at("2026-10-16", "11:00")).body, "Your task “Pay deposit” is due now.");
  assert.equal(taskText({ label: "Pay deposit" }, timed.target, at("2026-10-15", "11:00")).body, "Your task “Pay deposit” is due tomorrow.");
});

console.log(`\n${passed} checks passed.`);
