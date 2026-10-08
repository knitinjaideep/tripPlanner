/**
 * Booking and task reminders against a disposable database: eligibility,
 * recipients, time zones, rescheduling / cancellation / reassignment, member
 * removal, preferences and quiet hours, freshness (no backlog), stale-job
 * protection, concurrent workers, retries, email with a MOCK provider, snooze,
 * authorization. Nothing real is ever sent.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:reminders
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as n from "../src/db/notifications";
import * as q from "../src/db/queries";
import * as rem from "../src/db/reminders";
import * as sh from "../src/db/sharing";
import * as st from "../src/db/settings";
import { buildReminderEmail, createReminderSender, type ReminderSender } from "../src/lib/email/reminder-email";
import { isSafeInternalPath, resolveDestination } from "../src/lib/notifications";
import { zonedInstant } from "../src/lib/time-zones";
import type { PackingItemInput, ReservationInput, TripInput } from "../src/lib/types";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to a migrated, disposable database.");
  process.exit(1);
}
const { db, pool } = createDb(url);
const id = () => `test-${randomUUID()}`;
const [OWNER, EDITOR, VIEWER, STRANGER] = [id(), id(), id(), id()];
let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const TZ = "America/Aruba"; // UTC−4, no DST
const MIN = 60_000;
const at = (date: string, hhmm: string, zone = TZ) => new Date(zonedInstant(date, hhmm, zone)!);
const tripInput: TripInput = { title: "Aruba trip", destination: "Aruba", start_date: "2026-10-14", end_date: "2026-10-19", time_zone: TZ, travelers: ["A"], cover_image: "beach", notes: null };
const booking: ReservationInput = {
  kind: "activity", status: "confirmed", title: "Catamaran", provider: null, confirmation_code: "SECRET-REF-9", start_date: "2026-10-16", start_time: "11:00",
  start_time_zone: TZ, end_date: "2026-10-16", end_time: "13:00", end_time_zone: TZ, origin: null, destination: null, location: "12 Private Lane Unit 4B", booking_url: "https://example.com/booking/xyz", notes: "door code 4321", details: {},
};
const NOW0 = at("2026-10-10", "12:00");

async function join(tripId: string, userId: string, role: "editor" | "viewer") {
  const made = await sh.createInvitation(db, { ownerId: OWNER, tripId, invitedBy: OWNER, inviterName: "Olive", email: null, role });
  assert.ok(made.ok);
  assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId, verifiedEmail: null, emailUnverified: false })).status, "ok");
}

async function main() {
  console.log("Setup");
  const { id: T } = await q.createTrip(db, OWNER, tripInput);
  await join(T, EDITOR, "editor");
  await join(T, VIEWER, "viewer");
  for (const [u, name, e] of [[OWNER, "Olive", "owner@example.com"], [EDITOR, "Edie", "editor@example.com"], [VIEWER, "Pavani", "viewer@example.com"]] as const) {
    await sh.upsertProfile(db, { id: u, name, email: e });
  }
  const cat = await q.createPackingCategory(db, OWNER, T, { name: "Aruba" });
  assert.ok(cat.ok);
  const CAT = cat.id;

  const mkBooking = async (over: Partial<ReservationInput> = {}) => (await q.createReservation(db, OWNER, T, { ...booking, ...over }))!.id;
  const mkTask = async (over: Partial<PackingItemInput> = {}) => {
    const r = await q.createPackingItem(db, OWNER, T, { category_id: CAT, label: "Aruba packing", quantity: 1, traveler_name: null, notes: null, assignee_id: EDITOR, due_date: "2026-10-16", due_time: null, ...over });
    assert.ok(r.ok, JSON.stringify(r));
    return r.id;
  };
  const ctx = { userId: OWNER, ownerId: OWNER };
  const setupB = (bookingId: string, preset: "24h" | "2h" | "custom" | "off", recipients: string[], rule: Record<string, unknown> = {}, now = NOW0) =>
    rem.setReminders(db, ctx, T, "booking", bookingId, { preset, rule, recipientIds: recipients }, now.getTime());
  const setupT = (taskId: string, preset: "at_due" | "1d_before" | "custom" | "off", rule: Record<string, unknown> = {}, now = NOW0) =>
    rem.setReminders(db, ctx, T, "task", taskId, { preset, rule, recipientIds: [] }, now.getTime());
  const row = async (subjectId: string, user: string) => {
    const r = await db.execute<Record<string, unknown>>(sql`select * from reminders where (reservation_id = ${subjectId} or packing_item_id = ${subjectId}) and recipient_id = ${user}`);
    return r.rows[0] as { id: string; status: string; status_reason: string | null; occurrence: number; fire_at: Date | null; expires_at: Date | null; target_at: Date | null; attempts: number; email_status: string; email_attempts: number; locked_until: Date | null; in_app_sent_at: Date | null; adjustment: string | null; adjustment_note: string | null; snoozed_until: Date | null; snooze_count: number; claim_token: string | null; recipient_id: string; quiet_override: boolean } | undefined;
  };
  const inbox = async (user: string) =>
    (await db.execute<{ id: string; body: string; title: string; metadata: Record<string, string>; recipient_id: string }>(sql`select id, body, title, metadata, recipient_id from notifications where recipient_id = ${user} and type = 'reminder' order by created_at, id`)).rows;
  const allReminderNotifications = async () => Number((await db.execute(sql`select count(*)::int as c from notifications where trip_id = ${T} and type = 'reminder'`)).rows[0].c);
  const wipe = async () => {
    await db.execute(sql`delete from notifications where trip_id = ${T} and type = 'reminder'`);
    await db.execute(sql`delete from reminders where trip_id = ${T}`);
    await db.execute(sql`delete from reminder_prefs where user_id in (${OWNER}, ${EDITOR}, ${VIEWER})`);
    await db.execute(sql`delete from user_settings where user_id in (${OWNER}, ${EDITOR}, ${VIEWER})`);
    await db.execute(sql`delete from packing_items where trip_id = ${T}`);
    await db.execute(sql`delete from reservations where trip_id = ${T}`);
    await db.execute(sql`delete from scheduler_heartbeats where job = 'reminders'`);
  };
  const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);
  const sender = (log: { to: string; key: string; body: string; subject: string }[], outcome: () => "sent" | "failed" = () => "sent"): ReminderSender => async (input) => {
    log.push({ to: input.to, key: input.idempotencyKey, body: input.body, subject: input.subject });
    return outcome();
  };
  const prefs = (over: Partial<rem.ReminderPrefs> = {}): rem.ReminderPrefs => ({ ...rem.DEFAULT_PREFS, ...over });

  console.log("Nothing is created implicitly");
  await check("bookings and assigned tasks with dates create no reminders; the review list only reads", async () => {
    const b = await mkBooking();
    const t = await mkTask({ due_time: "11:00" });
    assert.equal(Number((await db.execute(sql`select count(*)::int as c from reminders where trip_id = ${T}`)).rows[0].c), 0);
    const overview = await rem.getOverview(db, OWNER, T, NOW0.getTime());
    assert.deepEqual(overview.map((o) => [o.type, o.active]).sort(), [["booking", 0], ["task", 0]]);
    assert.ok(overview.find((o) => o.id === b) && overview.find((o) => o.id === t));
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:00") });
    assert.equal(r.claimed, 0);
    assert.equal(await allReminderNotifications(), 0);
    assert.equal(Number((await db.execute(sql`select count(*)::int as c from reminders where trip_id = ${T}`)).rows[0].c), 0, "reading the overview and running the worker created nothing");
    await wipe();
  });

  console.log("Eligibility");
  await check("only a confirmed, scheduled booking qualifies; nothing is inferred from a title or a date", async () => {
    const cancelled = await mkBooking({ status: "cancelled" });
    const noTime = await mkBooking({ start_time: null, end_time: null });
    const noDate = await mkBooking({ start_date: null, start_time: null, end_date: null, end_time: null, title: "Sunset dinner (proposed?)" });
    assert.deepEqual(await setupB(cancelled, "2h", [EDITOR]), { ok: false, reason: "ineligible", detail: "booking_cancelled" });
    assert.deepEqual(await setupB(noTime, "2h", [EDITOR]), { ok: false, reason: "ineligible", detail: "booking_unscheduled" });
    assert.deepEqual(await setupB(noDate, "2h", [EDITOR]), { ok: false, reason: "ineligible", detail: "booking_unscheduled" });
    // An itinerary activity or an Explore suggestion is not a booking: its id is simply not found as one.
    const visit = await q.createItineraryItem(db, OWNER, T, { place_id: null, reservation_id: null, title: "Proposed snorkel", category: "activity", local_date: "2026-10-16", local_start_time: "10:00", local_end_date: null, local_end_time: null, timezone: null, planning_notes: null }, {});
    assert.ok(visit.ok);
    assert.deepEqual(await setupB(visit.id, "2h", [EDITOR]), { ok: false, reason: "not_found" });
    assert.equal(Number((await db.execute(sql`select count(*)::int as c from reminders where trip_id = ${T}`)).rows[0].c), 0);
    await wipe();
    await db.execute(sql`delete from itinerary_items where trip_id = ${T}`);
  });
  await check("the database itself refuses a reminder with no subject, two subjects, or a booking with no lead", async () => {
    const b = await mkBooking();
    const t = await mkTask();
    await assert.rejects(db.execute(sql`insert into reminders (trip_id, owner_id, subject_type, recipient_id, preset, lead_minutes) values (${T}, ${OWNER}, 'booking', ${EDITOR}, '2h', 120)`));
    await assert.rejects(db.execute(sql`insert into reminders (trip_id, owner_id, subject_type, reservation_id, packing_item_id, recipient_id, preset, lead_minutes) values (${T}, ${OWNER}, 'booking', ${b}, ${t}, ${EDITOR}, '2h', 120)`));
    await assert.rejects(db.execute(sql`insert into reminders (trip_id, owner_id, subject_type, reservation_id, recipient_id, preset, lead_minutes) values (${T}, ${OWNER}, 'booking', ${b}, ${EDITOR}, 'custom', 0)`));
    // A reminder cannot point at a booking of another trip (composite FK).
    const other = await q.createTrip(db, OWNER, tripInput);
    await assert.rejects(db.execute(sql`insert into reminders (trip_id, owner_id, subject_type, reservation_id, recipient_id, preset, lead_minutes) values (${other.id}, ${OWNER}, 'booking', ${b}, ${EDITOR}, '2h', 120)`));
    await db.execute(sql`delete from trips where id = ${other.id}`);
    await wipe();
  });

  console.log("Recipients");
  await check("a booking needs explicitly chosen current members — never everyone because a booking exists", async () => {
    const b = await mkBooking();
    assert.deepEqual(await setupB(b, "24h", []), { ok: false, reason: "no_recipients" });
    assert.deepEqual(await setupB(b, "24h", [STRANGER]), { ok: false, reason: "not_member" });
    assert.deepEqual(await setupB(b, "24h", [EDITOR, STRANGER]), { ok: false, reason: "not_member" });
    assert.equal((await row(b, EDITOR)), undefined, "a refused request creates nothing, not even for the valid person");
    const ok = await setupB(b, "24h", [EDITOR, VIEWER]);
    assert.ok(ok.ok);
    assert.ok(await row(b, EDITOR) && await row(b, VIEWER));
    assert.equal(await row(b, OWNER), undefined, "the owner was not chosen, so they get nothing");
    await rem.runReminders(db, { now: at("2026-10-15", "11:01") });
    assert.equal((await inbox(EDITOR)).length, 1);
    assert.equal((await inbox(VIEWER)).length, 1);
    assert.equal((await inbox(OWNER)).length, 0);
    assert.equal((await inbox(STRANGER)).length, 0);
    await wipe();
  });
  await check("a task reminder goes only to its current assignee; unassigned tasks have none", async () => {
    const t = await mkTask({ due_time: "11:00" });
    const un = await mkTask({ assignee_id: null, due_time: "11:00" });
    assert.deepEqual(await setupT(un, "at_due"), { ok: false, reason: "unassigned" });
    assert.ok((await setupT(t, "1d_before")).ok);
    assert.equal((await db.execute(sql`select count(*)::int as c from reminders where packing_item_id = ${t}`)).rows[0].c, 1);
    assert.ok(await row(t, EDITOR));
    await rem.runReminders(db, { now: at("2026-10-15", "11:01") });
    assert.equal((await inbox(EDITOR)).length, 1);
    assert.equal((await inbox(OWNER)).length + (await inbox(VIEWER)).length, 0);
    await wipe();
  });
  await check("a task can only be assigned to a current member", async () => {
    const r = await q.createPackingItem(db, OWNER, T, { category_id: CAT, label: "x", quantity: 1, traveler_name: null, notes: null, assignee_id: STRANGER, due_date: null, due_time: null });
    assert.deepEqual(r, { ok: false, reason: "assignee_not_member" });
    const ok = await mkTask({ assignee_id: OWNER });
    const upd = await q.updatePackingItem(db, OWNER, T, ok, { category_id: CAT, label: "x", quantity: 1, traveler_name: null, notes: null, assignee_id: STRANGER });
    assert.deepEqual(upd, { ok: false, reason: "assignee_not_member" });
    await wipe();
  });

  console.log("Time handling");
  await check("fires in the booking's own zone: Aruba activity and a Chicago-departure flight", async () => {
    const b = await mkBooking();
    const f = await mkBooking({ kind: "flight", title: "AA 1234", start_date: "2026-10-16", start_time: "08:20", start_time_zone: "America/Chicago", end_time_zone: TZ });
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    assert.ok((await setupB(f, "24h", [EDITOR])).ok);
    assert.equal(ms((await row(b, EDITOR))!.fire_at), Date.parse("2026-10-15T15:00:00Z"));
    assert.equal(ms((await row(f, EDITOR))!.fire_at), Date.parse("2026-10-15T13:20:00Z"), "08:20 CDT, not 08:20 Aruba time");
    await wipe();
  });
  await check("a date-only task needs a chosen time of day (never midnight), and fires at it in the task's zone", async () => {
    const t = await mkTask(); // due 2026-10-16, no time
    assert.deepEqual(await setupT(t, "1d_before"), { ok: false, reason: "invalid", detail: "Choose a reminder time of day." });
    assert.ok((await setupT(t, "1d_before", { localTime: "09:00" })).ok);
    const r = (await row(t, EDITOR))!;
    assert.equal(ms(r.fire_at), at("2026-10-15", "09:00").getTime());
    const rule = await db.execute(sql`select days_before, local_time::text as t, lead_minutes from reminders where id = ${r.id}`);
    assert.deepEqual([rule.rows[0].days_before, rule.rows[0].t, rule.rows[0].lead_minutes], [1, "09:00:00", null]);
    await wipe();
  });
  await check("a reminder time that has already passed is refused, not silently sent", async () => {
    const b = await mkBooking();
    assert.deepEqual(await setupB(b, "2h", [EDITOR], {}, at("2026-10-16", "09:30")), { ok: false, reason: "past" });
    assert.deepEqual(await setupB(b, "2h", [EDITOR], {}, at("2026-10-16", "11:30")), { ok: false, reason: "started" });
    assert.equal(await row(b, EDITOR), undefined);
    await wipe();
  });

  console.log("Delivery");
  await check("delivers once, at its time, with minimal text and an in-app link — no confirmation code, unit, address or notes", async () => {
    const b = await mkBooking({ title: "Spa appointment" });
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "08:59") })).claimed, 0, "not before its time");
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    assert.equal(r.sent, 1);
    const [item] = await inbox(EDITOR);
    assert.equal(item.title, "Booking reminder");
    assert.equal(item.body, "Your “Spa appointment” starts in 2 hours.");
    for (const secret of ["SECRET-REF-9", "Private Lane", "4B", "door code", "example.com"]) assert.ok(!JSON.stringify(item).includes(secret), `leaked ${secret}`);
    const listed = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.find((i) => i.id === item.id)!;
    assert.equal(listed.href, `/trips/${T}/bookings?booking=${b}`);
    assert.ok(isSafeInternalPath(listed.href));
    assert.equal(listed.reminder?.subject, "booking");
    const rr = (await row(b, EDITOR))!;
    assert.equal(rr.status, "sent");
    assert.ok(rr.in_app_sent_at);
    await wipe();
  });
  await check("duplicate triggers and six concurrent workers deliver exactly once", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR, VIEWER])).ok);
    const now = at("2026-10-16", "09:02");
    const reports = await Promise.all(Array.from({ length: 6 }, () => rem.runReminders(db, { now })));
    assert.equal(reports.reduce((a, r) => a + r.sent, 0), 2, "one per recipient in total");
    assert.equal((await inbox(EDITOR)).length, 1);
    assert.equal((await inbox(VIEWER)).length, 1);
    const again = await rem.runReminders(db, { now });
    assert.equal(again.claimed, 0);
    assert.equal((await inbox(EDITOR)).length, 1);
    // The notification key is per occurrence: a forced duplicate write is a no-op.
    const [r] = [(await row(b, EDITOR))!];
    assert.equal(await n.createNotifications(db, [{ type: "reminder", recipientId: EDITOR, actorId: null, tripId: T, reminderId: r.id, occurrence: 1, subject: "booking", subjectId: b, dedupeKey: `reminder:${r.id}:1`, title: "Booking reminder", body: "again" }]), 0);
    await wipe();
  });
  await check("a dry run reports what is due and changes nothing", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    const dry = await rem.runReminders(db, { now: at("2026-10-16", "09:05"), dryRun: true });
    assert.equal(dry.due.length, 1);
    assert.equal(dry.due[0].body, "Your “Catamaran” starts in 2 hours.");
    assert.equal((await row(b, EDITOR))!.status, "pending");
    assert.equal(await allReminderNotifications(), 0);
    assert.equal((await rem.schedulerStatus(db, at("2026-10-16", "09:06"))).active, false, "a dry run is not a scheduler heartbeat");
    await wipe();
  });
  await check("the scheduler status is honest: active only after a recent run", async () => {
    const now = new Date();
    assert.equal((await rem.schedulerStatus(db, now)).active, false);
    await rem.runReminders(db, { now });
    assert.equal((await rem.schedulerStatus(db, new Date())).active, true);
    assert.equal((await rem.schedulerStatus(db, new Date(Date.now() + 25 * MIN))).active, false);
    await wipe();
  });

  console.log("Rescheduling and cancellation");
  const update = (bookingId: string, over: Partial<ReservationInput>) => q.updateReservation(db, OWNER, T, bookingId, { ...booking, ...over });
  await check("changing a pending booking's time moves its reminder; the old time delivers nothing", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    const before = (await row(b, EDITOR))!;
    assert.ok((await update(b, { start_time: "12:00", end_time: "14:00" })).ok);
    const after = (await row(b, EDITOR))!;
    assert.equal(after.occurrence, before.occurrence, "nothing was sent yet, so it is still the same occurrence");
    assert.equal(ms(after.fire_at), at("2026-10-15", "12:00").getTime());
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "11:05") })).claimed, 0, "the old time is dead");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "12:05") })).sent, 1);
    assert.match((await inbox(EDITOR))[0].body, /starts in 24 hours/);
    await wipe();
  });
  await check("after a reminder was sent, a time change keeps the old inbox item (marked Updated) and schedules a new occurrence", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "11:02") })).sent, 1);
    assert.ok((await update(b, { start_time: "14:00", end_time: "16:00" })).ok);
    const r = (await row(b, EDITOR))!;
    assert.equal(r.occurrence, 2);
    assert.equal(r.status, "pending");
    assert.equal(ms(r.fire_at), at("2026-10-15", "14:00").getTime());
    assert.equal(r.in_app_sent_at, null, "delivery state is reset for the new occurrence");
    let items = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.filter((i) => i.type === "reminder");
    assert.equal(items.length, 1, "history is kept");
    assert.equal(items[0].reminder?.state, "updated");
    assert.equal(items[0].href, `/trips/${T}/bookings?booking=${b}`, "its link opens current data");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "14:03") })).sent, 1);
    items = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.filter((i) => i.type === "reminder");
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.reminder?.state).sort(), [null, "updated"].sort());
    await wipe();
  });
  await check("cancelling a booking cancels its reminders (and marks what was already sent); un-cancelling brings back what is still ahead", async () => {
    const b = await mkBooking();
    const b2 = await mkBooking({ title: "Dinner" });
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    assert.ok((await setupB(b2, "2h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-15", "11:02") }); // b delivered
    assert.ok((await update(b, { status: "cancelled" })).ok);
    assert.ok((await update(b2, { title: "Dinner", status: "cancelled" })).ok);
    assert.equal((await row(b, EDITOR))!.status, "canceled");
    assert.equal((await row(b2, EDITOR))!.status_reason, "booking_cancelled");
    const item = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.find((i) => i.type === "reminder")!;
    assert.equal(item.reminder?.state, "canceled");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "09:01") })).claimed, 0, "nothing is delivered for a cancelled booking");
    // Un-cancelled before its time: the pending one is revived; the already-delivered one starts a new occurrence.
    assert.ok((await update(b2, { title: "Dinner", status: "confirmed" }, )).ok);
    const revived = (await row(b2, EDITOR))!;
    assert.equal(revived.status, "pending");
    assert.equal(ms(revived.fire_at), at("2026-10-16", "09:00").getTime());
    await wipe();
  });
  await check("deleting a booking removes its reminders and marks a sent inbox item canceled — the item stays", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-15", "11:02") });
    assert.ok(await q.deleteReservation(db, OWNER, T, b));
    assert.equal(await row(b, EDITOR), undefined);
    const items = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.filter((i) => i.type === "reminder");
    assert.equal(items.length, 1);
    assert.equal(items[0].reminder?.state, "canceled");
    await wipe();
  });
  await check("a booking that loses its start time cancels the reminder instead of guessing", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    assert.ok((await update(b, { start_time: null, end_time: null })).ok);
    const r = (await row(b, EDITOR))!;
    assert.deepEqual([r.status, r.status_reason], ["canceled", "booking_unscheduled"]);
    await wipe();
  });
  await check("turning a booking's reminder off cancels it; choosing a different set of people cancels the rest", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR, VIEWER])).ok);
    assert.ok((await setupB(b, "24h", [VIEWER])).ok);
    assert.deepEqual([(await row(b, EDITOR))!.status, (await row(b, EDITOR))!.status_reason], ["canceled", "unselected"]);
    assert.equal((await row(b, VIEWER))!.status, "pending");
    assert.ok((await setupB(b, "off", [])).ok);
    assert.equal((await row(b, VIEWER))!.status_reason, "off");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "11:02") })).claimed, 0);
    await wipe();
  });
  await check("changing the rule after it was sent starts a new occurrence; changing nothing does not", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-15", "11:02") });
    assert.ok((await setupB(b, "24h", [EDITOR], {}, at("2026-10-15", "12:00"))).ok);
    assert.equal((await row(b, EDITOR))!.status, "sent", "same rule, same time: left alone");
    assert.ok((await setupB(b, "2h", [EDITOR], {}, at("2026-10-15", "12:00"))).ok);
    const r = (await row(b, EDITOR))!;
    assert.equal(r.occurrence, 2);
    assert.equal(ms(r.fire_at), at("2026-10-16", "09:00").getTime());
    await wipe();
  });

  console.log("Tasks");
  const updateTask = (taskId: string, over: Partial<PackingItemInput>) => q.updatePackingItem(db, OWNER, T, taskId, { category_id: CAT, label: "Aruba packing", quantity: 1, traveler_name: null, notes: null, assignee_id: EDITOR, due_date: "2026-10-16", due_time: null, ...over });
  await check("a task due date change reschedules; removing the due date cancels (no deadline is invented)", async () => {
    const t = await mkTask({ due_time: "11:00" });
    assert.ok((await setupT(t, "1d_before")).ok);
    assert.equal(ms((await row(t, EDITOR))!.fire_at), at("2026-10-15", "11:00").getTime());
    assert.ok((await updateTask(t, { due_time: "15:30" })).ok);
    assert.equal(ms((await row(t, EDITOR))!.fire_at), at("2026-10-15", "15:30").getTime());
    assert.ok((await updateTask(t, { due_date: null, due_time: null })).ok);
    assert.deepEqual([(await row(t, EDITOR))!.status, (await row(t, EDITOR))!.status_reason], ["canceled", "no_due"]);
    assert.ok((await updateTask(t, { due_date: "2026-10-17", due_time: "10:00" })).ok);
    assert.equal((await row(t, EDITOR))!.status, "pending", "a due date coming back revives what was canceled for lack of one");
    await wipe();
  });
  await check("completing a task cancels its reminder and marks the sent item; un-completing revives what is still ahead", async () => {
    const t = await mkTask();
    assert.ok((await setupT(t, "at_due", { localTime: "09:00" })).ok); // 2026-10-16 09:00
    const t2 = await mkTask({ label: "Print tickets" });
    assert.ok((await setupT(t2, "at_due", { localTime: "09:00" })).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    assert.equal((await inbox(EDITOR)).length, 2);
    assert.equal(await q.setPackingItemPacked(db, OWNER, T, t, true), true);
    assert.deepEqual([(await row(t, EDITOR))!.status, (await row(t, EDITOR))!.status_reason], ["canceled", "task_done"]);
    const items = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.filter((i) => i.type === "reminder");
    assert.deepEqual(items.map((i) => i.reminder?.state).sort(), [null, "completed"].sort());
    // Pending one: complete then un-complete before its time.
    const t3 = await mkTask({ label: "Charge camera" });
    assert.ok((await setupT(t3, "1d_before", { localTime: "09:00" }, NOW0)).ok);
    await q.setPackingItemPacked(db, OWNER, T, t3, true);
    assert.equal((await row(t3, EDITOR))!.status, "canceled");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "09:01") })).claimed, 0, "no reminder for a completed task");
    await q.setPackingItemPacked(db, OWNER, T, t3, false);
    assert.equal((await row(t3, EDITOR))!.status, "pending");
    await wipe();
  });
  await check("reassignment cancels the old assignee's pending reminder and follows the task to the new one; unassigning cancels", async () => {
    const t = await mkTask({ due_time: "11:00" });
    assert.ok((await setupT(t, "1d_before")).ok);
    assert.ok((await updateTask(t, { due_time: "11:00", assignee_id: VIEWER })).ok);
    const old = (await row(t, EDITOR))!;
    assert.deepEqual([old.status, old.status_reason], ["canceled", "reassigned"]);
    const next = (await row(t, VIEWER))!;
    assert.equal(next.status, "pending");
    assert.equal(ms(next.fire_at), at("2026-10-15", "11:00").getTime(), "same rule");
    await rem.runReminders(db, { now: at("2026-10-15", "11:01") });
    assert.equal((await inbox(EDITOR)).length, 0, "the previous assignee is not reminded");
    assert.equal((await inbox(VIEWER)).length, 1);
    assert.ok((await updateTask(t, { due_time: "11:00", assignee_id: null })).ok);
    assert.equal((await row(t, VIEWER))!.status_reason, "task_unassigned");
    // A task with NO reminder does not gain one by being reassigned.
    const plain = await mkTask({ due_time: "11:00" });
    assert.ok((await updateTask(plain, { due_time: "11:00", assignee_id: VIEWER })).ok);
    assert.equal(await row(plain, VIEWER), undefined);
    await wipe();
  });
  await check("deleting a task removes its reminders; a stale pending job cannot survive it", async () => {
    const t = await mkTask({ due_time: "11:00" });
    assert.ok((await setupT(t, "at_due")).ok);
    assert.equal(await q.deletePackingItem(db, OWNER, T, t), true);
    assert.equal(await row(t, EDITOR), undefined);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "11:01") })).claimed, 0);
    await wipe();
  });

  console.log("People leaving");
  await check("removing a member cancels their reminders, unassigns their tasks and clears their inbox for the trip", async () => {
    const extra = id();
    await join(T, extra, "editor");
    await sh.upsertProfile(db, { id: extra, name: "Ed Extra", email: "extra@example.com" });
    const b = await mkBooking();
    const t = await mkTask({ assignee_id: extra, due_time: "11:00" });
    assert.ok((await setupB(b, "24h", [extra, EDITOR])).ok);
    assert.ok((await setupT(t, "at_due")).ok);
    await rem.runReminders(db, { now: at("2026-10-15", "11:02") });
    assert.equal((await inbox(extra)).length, 1);
    assert.deepEqual(await sh.removeMember(db, OWNER, T, extra), { ok: true });
    assert.equal((await row(b, extra))!.status_reason, "not_member");
    assert.equal((await row(t, extra))!.status_reason, "not_member");
    assert.equal((await db.execute(sql`select assignee_id from packing_items where id = ${t}`)).rows[0].assignee_id, null);
    assert.equal((await inbox(extra)).length, 0);
    assert.equal((await row(b, EDITOR))!.status, "sent", "other recipients are untouched");
    // Re-adding them later does not resurrect anything by itself.
    await join(T, extra, "editor");
    assert.equal((await row(b, extra))!.status, "canceled");
    await sh.leaveTrip(db, extra, T);
    await wipe();
  });
  await check("delivery re-checks membership: a recipient who was removed behind the app's back gets nothing", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [VIEWER])).ok);
    await db.execute(sql`delete from trip_members where trip_id = ${T} and user_id = ${VIEWER}`); // bypasses the removal hook
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    assert.equal(r.canceled, 1);
    assert.equal((await inbox(VIEWER)).length, 0);
    assert.equal((await row(b, VIEWER))!.status_reason, "not_member");
    await join(T, VIEWER, "viewer");
    await wipe();
  });
  await check("a member who leaves on their own is handled the same way", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [VIEWER])).ok);
    assert.equal(await sh.leaveTrip(db, VIEWER, T), true);
    assert.equal((await row(b, VIEWER))!.status_reason, "not_member");
    await join(T, VIEWER, "viewer");
    await wipe();
  });

  console.log("Recipient preferences and quiet hours");
  await check("turning reminders off cancels what is pending; turning them back on brings back what is still ahead", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    assert.deepEqual(await rem.savePrefs(db, EDITOR, prefs({ enabled: false })), { ok: true });
    assert.deepEqual([(await row(b, EDITOR))!.status, (await row(b, EDITOR))!.status_reason], ["canceled", "recipient_off"]);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "11:02") })).claimed, 0);
    await rem.savePrefs(db, EDITOR, prefs({ enabled: true }));
    assert.equal((await row(b, EDITOR))!.status, "pending");
    await wipe();
  });
  await check("a preference changed behind the app's back is still honored at delivery", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    await db.execute(sql`insert into reminder_prefs (user_id, enabled) values (${EDITOR}, false)`);
    const r = await rem.runReminders(db, { now: at("2026-10-15", "11:02") });
    assert.equal(r.canceled, 1);
    assert.equal((await inbox(EDITOR)).length, 0);
    await wipe();
  });
  await check("settings are validated: a channel is required; quiet hours need a zone and a real span", async () => {
    assert.equal((await rem.savePrefs(db, EDITOR, prefs({ in_app: false, email: false }))).ok, false);
    assert.equal((await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: null }))).ok, false);
    assert.equal((await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: "Not/AZone" }))).ok, false);
    assert.equal((await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ, quiet_start: "22:00", quiet_end: "22:00" }))).ok, false);
    assert.equal((await rem.savePrefs(db, EDITOR, prefs({ default_task_time: "25:00" }))).ok, false);
    await assert.rejects(db.execute(sql`insert into reminder_prefs (user_id, in_app, email) values (${STRANGER}, false, false)`));
    assert.deepEqual(await rem.getPrefs(db, STRANGER), rem.DEFAULT_PREFS);
    assert.equal(rem.DEFAULT_PREFS.enabled, true);
    assert.equal(rem.DEFAULT_PREFS.email, false, "email is opt-in");
  });
  await check("quiet hours move a booking reminder EARLIER and say so; the recipient sees the explanation", async () => {
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ, quiet_start: "22:00", quiet_end: "07:00" }));
    const b = await mkBooking({ start_date: "2026-10-17", start_time: "00:30", end_date: "2026-10-17", end_time: "02:00", title: "Late show" });
    const res = await setupB(b, "2h", [EDITOR, VIEWER]);
    assert.ok(res.ok);
    const e = (await row(b, EDITOR))!;
    assert.equal(e.adjustment, "earlier");
    assert.equal(ms(e.fire_at), at("2026-10-16", "22:00").getTime());
    assert.match(e.adjustment_note ?? "", /Moved earlier/);
    assert.equal(ms((await row(b, VIEWER))!.fire_at), at("2026-10-16", "22:30").getTime(), "someone with no quiet hours is not adjusted");
    const panel = await rem.getPanel(db, EDITOR, OWNER, T, "booking", b, false, NOW0.getTime());
    assert.match(panel!.reminders.find((r) => r.recipient.id === EDITOR)!.adjustmentNote ?? "", /Moved earlier/);
    const viewerSeesOther = await rem.getPanel(db, VIEWER, OWNER, T, "booking", b, false, NOW0.getTime());
    assert.equal(viewerSeesOther!.reminders.find((r) => r.recipient.id === EDITOR)!.adjustmentNote, null, "another person's quiet-hour times are not shown");
    assert.equal(viewerSeesOther!.reminders.find((r) => r.recipient.id === EDITOR)!.adjusted, true);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "22:01") })).sent, 1);
    assert.equal((await inbox(EDITOR)).length, 1);
    assert.equal((await inbox(VIEWER)).length, 0, "the viewer's own time (22:30) has not come");
    await wipe();
  });
  await check("when moving earlier is not useful the reminder is NOT sent unless the recipient chooses to allow it — and never after the start", async () => {
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ, quiet_start: "22:00", quiet_end: "07:00" }));
    const b = await mkBooking({ start_date: "2026-10-17", start_time: "06:00", end_date: "2026-10-17", end_time: "08:00", title: "Sunrise hike" });
    assert.ok((await setupB(b, "2h", [EDITOR])).ok); // 04:00 is deep in quiet hours; quiet began 6 h earlier
    const r = (await row(b, EDITOR))!;
    assert.deepEqual([r.status, r.status_reason], ["skipped", "quiet_hours"]);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-17", "04:01") })).claimed, 0, "nothing arrives silently");
    // A different person cannot make that choice for them.
    assert.deepEqual(await rem.allowQuietReminder(db, VIEWER, r.id, NOW0.getTime()), { ok: false, reason: "not_found" });
    const allowed = await rem.allowQuietReminder(db, EDITOR, r.id, NOW0.getTime());
    assert.equal(allowed.ok, true);
    const p = (await row(b, EDITOR))!;
    assert.equal(p.status, "pending");
    assert.equal(p.adjustment, "allowed");
    assert.equal(ms(p.fire_at), at("2026-10-17", "04:00").getTime());
    assert.equal((await rem.runReminders(db, { now: at("2026-10-17", "04:02") })).sent, 1);
    await wipe();
    // Allowed, but the worker was down until after the start: nothing is delivered then.
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ }));
    const b2 = await mkBooking({ start_date: "2026-10-17", start_time: "06:00", end_date: "2026-10-17", end_time: "08:00" });
    assert.ok((await setupB(b2, "2h", [EDITOR])).ok);
    await rem.allowQuietReminder(db, EDITOR, (await row(b2, EDITOR))!.id, NOW0.getTime());
    const late = await rem.runReminders(db, { now: at("2026-10-17", "06:10") });
    assert.equal(late.sent, 0);
    assert.equal(await allReminderNotifications(), 0, "never delivered after the booking has started");
    await wipe();
  });
  await check("a task reminder inside quiet hours is held until they end", async () => {
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ, quiet_start: "22:00", quiet_end: "07:00" }));
    const t = await mkTask({ due_date: "2026-10-17", due_time: "10:00" });
    assert.ok((await setupT(t, "custom", { customAmount: 600, customUnit: "minutes" })).ok); // 00:00
    const r = (await row(t, EDITOR))!;
    assert.equal(r.adjustment, "later");
    assert.equal(ms(r.fire_at), at("2026-10-17", "07:00").getTime());
    assert.equal((await rem.runReminders(db, { now: at("2026-10-17", "00:05") })).claimed, 0);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-17", "07:01") })).sent, 1);
    await wipe();
  });
  await check("changing quiet hours re-evaluates reminders already scheduled", async () => {
    const b = await mkBooking({ start_date: "2026-10-17", start_time: "00:30", end_date: "2026-10-17", end_time: "02:00" });
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-16", "22:30").getTime());
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ, quiet_start: "22:00", quiet_end: "07:00" }));
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-16", "22:00").getTime());
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: false }));
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-16", "22:30").getTime());
    await wipe();
  });

  console.log("Freshness and stale jobs");
  await check("after downtime nothing old is sent: past its window it is recorded as expired, not delivered", async () => {
    const b1 = await mkBooking({ title: "One" });
    const b2 = await mkBooking({ title: "Two", start_time: "15:00", end_time: "16:00" });
    const t = await mkTask({ due_time: "11:00" });
    assert.ok((await setupB(b1, "2h", [EDITOR])).ok); // 09:00
    assert.ok((await setupB(b2, "24h", [EDITOR])).ok); // Oct 15 15:00
    assert.ok((await setupT(t, "at_due")).ok); // 11:00 Oct 16
    // The job was down for a day; the first run is on the 17th.
    const r = await rem.runReminders(db, { now: at("2026-10-17", "08:00") });
    assert.equal(r.sent, 0);
    assert.equal(r.expired, 3);
    assert.equal(await allReminderNotifications(), 0);
    assert.equal((await row(b1, EDITOR))!.status_reason, "expired");
    await wipe();
  });
  await check("just inside the window it still goes; just outside it does not", async () => {
    const a = await mkBooking({ title: "A" });
    const b = await mkBooking({ title: "B" });
    assert.ok((await setupB(a, "2h", [EDITOR])).ok);
    assert.ok((await setupB(b, "2h", [VIEWER])).ok);
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:29") });
    assert.equal(r.sent, 2);
    await wipe();
    const c = await mkBooking({ title: "C" });
    assert.ok((await setupB(c, "2h", [EDITOR])).ok);
    const late = await rem.runReminders(db, { now: at("2026-10-16", "09:31") });
    assert.equal(late.sent, 0);
    assert.equal(late.expired, 1);
    await wipe();
  });
  await check("stale-job protection: the booking moved behind the worker's back — the old time is never delivered", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    // A write that bypassed every hook (the safety net that matters most):
    await db.execute(sql`update reservations set start_time = '15:00', end_time = '16:00' where id = ${b}`);
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    assert.equal(r.sent, 0);
    assert.equal(r.rescheduled, 1);
    assert.equal(await allReminderNotifications(), 0);
    const moved = (await row(b, EDITOR))!;
    assert.equal(moved.status, "pending");
    assert.equal(ms(moved.fire_at), at("2026-10-16", "13:00").getTime());
    await wipe();
  });
  await check("race: a claimed job whose record is then edited is dropped — the editor's reschedule wins", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    const r = (await row(b, EDITOR))!;
    const token = randomUUID();
    await db.execute(sql`update reminders set status = 'sending', claim_token = ${token}::uuid, locked_until = ${at("2026-10-16", "09:05").toISOString()}::timestamptz, attempts = 1 where id = ${r.id}`);
    assert.ok((await update(b, { start_time: "15:00", end_time: "16:00" })).ok); // the DAL-path hook reschedules and revokes the claim
    assert.equal(await rem.deliverClaimed(db, r.id, token, at("2026-10-16", "09:01"), false), "lost");
    assert.equal(await allReminderNotifications(), 0);
    assert.equal((await row(b, EDITOR))!.status, "pending");
    await wipe();
  });
  await check("race: workers and edits at the same moment never leave a stale or double delivery", async () => {
    for (let i = 0; i < 6; i++) {
      const b = await mkBooking({ title: `Race ${i}` });
      assert.ok((await setupB(b, "2h", [EDITOR])).ok);
      const [, edited] = await Promise.all([rem.runReminders(db, { now: at("2026-10-16", "09:01") }), update(b, { title: `Race ${i}`, start_time: "15:00", end_time: "16:00" })]);
      assert.ok(edited.ok);
      const r = (await row(b, EDITOR))!;
      const sent = (await inbox(EDITOR)).filter((x) => x.metadata.sid === b);
      assert.equal(ms(r.target_at), at("2026-10-16", "15:00").getTime(), "the reminder follows the final time");
      if (sent.length === 0) {
        assert.equal(r.occurrence, 1);
        assert.equal(r.status, "pending");
      } else {
        // It was delivered a moment before the edit: kept as history, marked updated, and a new occurrence is waiting.
        assert.equal(sent.length, 1);
        assert.equal(sent[0].metadata.state, "updated");
        assert.equal(r.occurrence, 2);
        assert.equal(r.status, "pending");
      }
      assert.equal(ms(r.fire_at), at("2026-10-16", "13:00").getTime());
      await wipe();
    }
  });
  await check("a booking that has already started is never delivered, even if its row says it is due", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await db.execute(sql`update reminders set expires_at = ${at("2026-10-20", "00:00").toISOString()}::timestamptz where recipient_id = ${EDITOR} and reservation_id = ${b}`);
    const r = await rem.runReminders(db, { now: at("2026-10-16", "11:05") });
    assert.equal(r.sent, 0);
    assert.equal((await row(b, EDITOR))!.status_reason, "started");
    await wipe();
  });

  console.log("Retries");
  await check("a failing delivery is retried later and then succeeds, exactly once", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await db.execute(sql.raw(`create function reminder_test_fail() returns trigger as $$ begin if new.recipient_id = '${EDITOR}' and new.type = 'reminder' then raise exception 'provider down'; end if; return new; end $$ language plpgsql`));
    await db.execute(sql`create trigger reminder_test_fail before insert on notifications for each row execute function reminder_test_fail()`);
    try {
      const first = await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
      assert.equal(first.retried, 1);
      const r1 = (await row(b, EDITOR))!;
      assert.deepEqual([r1.status, r1.attempts], ["pending", 1]);
      assert.equal(ms(r1.fire_at), at("2026-10-16", "09:00").getTime(), "it keeps the time it was scheduled for");
      assert.equal(ms(r1.locked_until), at("2026-10-16", "09:03").getTime(), "backoff: two minutes");
      assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "09:02") })).claimed, 0, "not before the retry time");
      const second = await rem.runReminders(db, { now: at("2026-10-16", "09:04") });
      assert.equal(second.retried, 1);
      assert.equal((await row(b, EDITOR))!.attempts, 2);
    } finally {
      await db.execute(sql`drop trigger reminder_test_fail on notifications`);
      await db.execute(sql`drop function reminder_test_fail()`);
    }
    const third = await rem.runReminders(db, { now: at("2026-10-16", "09:09") });
    assert.equal(third.sent, 1);
    assert.equal((await inbox(EDITOR)).length, 1);
    assert.equal((await row(b, EDITOR))!.status, "sent");
    await wipe();
  });
  await check("after the last attempt it is marked failed — it does not retry forever", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    await db.execute(sql.raw(`create function reminder_test_fail() returns trigger as $$ begin if new.type = 'reminder' then raise exception 'down'; end if; return new; end $$ language plpgsql`));
    await db.execute(sql`create trigger reminder_test_fail before insert on notifications for each row execute function reminder_test_fail()`);
    try {
      await rem.runReminders(db, { now: at("2026-10-15", "11:01") });
      await rem.runReminders(db, { now: at("2026-10-15", "11:04") });
      const last = await rem.runReminders(db, { now: at("2026-10-15", "11:09") });
      assert.equal(last.failed, 1);
      const r = (await row(b, EDITOR))!;
      assert.deepEqual([r.status, r.status_reason, r.attempts], ["failed", "error", 3]);
      assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "11:20") })).claimed, 0);
    } finally {
      await db.execute(sql`drop trigger reminder_test_fail on notifications`);
      await db.execute(sql`drop function reminder_test_fail()`);
    }
    await wipe();
  });
  await check("a crashed worker's claim expires and another worker takes over", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    const r = (await row(b, EDITOR))!;
    await db.execute(sql`update reminders set status = 'sending', claim_token = gen_random_uuid(), locked_until = ${at("2026-10-16", "09:06").toISOString()}::timestamptz, attempts = 1 where id = ${r.id}`);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "09:03") })).claimed, 0, "still leased");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "09:07") })).sent, 1);
    await wipe();
  });

  console.log("Email (mock provider)");
  await check("email only goes to people who turned it on, only after the in-app item, and 'sent' means the provider accepted it", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR, VIEWER])).ok);
    await rem.savePrefs(db, EDITOR, prefs({ email: true }));
    const log: { to: string; key: string; body: string; subject: string }[] = [];
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: sender(log) });
    assert.equal(r.sent, 2);
    assert.equal(r.emailSent, 1);
    assert.deepEqual(log.map((l) => l.to), ["editor@example.com"], "the viewer never opted in");
    const e = (await row(b, EDITOR))!;
    assert.equal(e.email_status, "sent");
    assert.equal(log[0].key, `reminder:${e.id}:1`);
    assert.equal(log[0].body, "Your “Catamaran” starts in 2 hours.");
    assert.equal((await row(b, VIEWER))!.email_status, "none");
    // Re-running never re-sends.
    await rem.runReminders(db, { now: at("2026-10-16", "09:05"), email: sender(log) });
    assert.equal(log.length, 1);
    await wipe();
  });
  await check("a provider failure is retried (same idempotency key), the inbox item stands, and it gives up after three tries", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.savePrefs(db, EDITOR, prefs({ email: true }));
    const log: { to: string; key: string; body: string; subject: string }[] = [];
    const failing = sender(log, () => "failed");
    const r1 = await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: failing });
    assert.equal(r1.sent, 1);
    assert.equal(r1.emailFailed, 1);
    assert.equal((await row(b, EDITOR))!.email_status, "failed", "not marked sent without the provider's acceptance");
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "09:02"), email: failing })).emailFailed, 0, "waits for the retry time");
    await rem.runReminders(db, { now: at("2026-10-16", "09:04"), email: failing });
    await rem.runReminders(db, { now: at("2026-10-16", "09:10"), email: failing });
    const e = (await row(b, EDITOR))!;
    assert.equal(e.email_attempts, 3);
    assert.equal(e.email_status, "failed");
    assert.equal(e.status, "sent", "the in-app delivery is unaffected");
    assert.equal(new Set(log.map((l) => l.key)).size, 1, "one idempotency key across retries");
    await rem.runReminders(db, { now: at("2026-10-16", "09:20"), email: failing });
    assert.equal(log.length, 3, "no fourth attempt");
    await wipe();
  });
  await check("a retry that works is marked sent once", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.savePrefs(db, EDITOR, prefs({ email: true }));
    const log: { to: string; key: string; body: string; subject: string }[] = [];
    let ok = false;
    await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: sender(log, () => (ok ? "sent" : "failed")) });
    ok = true;
    await rem.runReminders(db, { now: at("2026-10-16", "09:04"), email: sender(log, () => "sent") });
    assert.equal((await row(b, EDITOR))!.email_status, "sent");
    assert.equal(log.length, 2);
    await wipe();
  });
  await check("email-only recipients: 'sent' only after acceptance; failing three times marks it failed", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.savePrefs(db, EDITOR, prefs({ in_app: false, email: true }));
    const log: { to: string; key: string; body: string; subject: string }[] = [];
    await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: sender(log, () => "failed") });
    let r = (await row(b, EDITOR))!;
    assert.equal(r.status, "sending", "nothing was delivered yet");
    assert.equal(r.in_app_sent_at, null);
    assert.equal((await inbox(EDITOR)).length, 0);
    await rem.runReminders(db, { now: at("2026-10-16", "09:04"), email: sender(log, () => "failed") });
    await rem.runReminders(db, { now: at("2026-10-16", "09:10"), email: sender(log, () => "failed") });
    r = (await row(b, EDITOR))!;
    assert.deepEqual([r.status, r.status_reason, r.email_status], ["failed", "error", "failed"]);
    await wipe();
    await rem.savePrefs(db, EDITOR, prefs({ in_app: false, email: true }));
    const c = await mkBooking({ title: "Second" });
    assert.ok((await setupB(c, "2h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: sender(log) });
    const ok = (await row(c, EDITOR))!;
    assert.deepEqual([ok.status, ok.email_status], ["sent", "sent"]);
    await wipe();
  });
  await check("no provider, or no address: nothing is claimed to be emailed", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.savePrefs(db, EDITOR, prefs({ email: true }));
    const r = await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: null });
    assert.equal(r.sent, 1);
    assert.equal((await row(b, EDITOR))!.email_status, "none");
    assert.equal(createReminderSender({ config: null }), null);
    await wipe();
    await rem.savePrefs(db, EDITOR, prefs({ in_app: false, email: true }));
    const c = await mkBooking({ title: "Nowhere" });
    assert.ok((await setupB(c, "2h", [EDITOR])).ok);
    const none = await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: null });
    assert.equal(none.sent, 0);
    assert.equal((await row(c, EDITOR))!.status_reason, "no_channel");
    await wipe();
  });
  await check("an email still waiting when the booking is cancelled is withdrawn, not sent", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.savePrefs(db, EDITOR, prefs({ email: true }));
    const log: { to: string; key: string; body: string; subject: string }[] = [];
    await rem.runReminders(db, { now: at("2026-10-16", "09:01"), email: sender(log, () => "failed") });
    assert.ok((await update(b, { status: "cancelled" })).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:05"), email: sender(log) });
    assert.equal(log.length, 1, "only the failed first attempt was ever made");
    assert.equal((await row(b, EDITOR))!.email_status, "skipped");
    await wipe();
  });
  await check("the email carries the one-line reminder and sign-in-required links — no secrets, no state-changing link", async () => {
    const mail = buildReminderEmail({ to: "x@example.com", tripId: T, subject: "booking", subjectId: randomUUID(), title: "Booking reminder", body: "Your “Spa” starts in 2 hours.", idempotencyKey: "k" }, "https://atlas.example");
    assert.match(mail.text, /Your “Spa” starts in 2 hours\./);
    const links = [...mail.text.matchAll(/https:\/\/\S+/g)].map((m) => m[0]);
    assert.equal(links.length, 2);
    for (const l of links) assert.match(l, /^https:\/\/atlas\.example\/trips\/[0-9a-f-]+\/bookings\?booking=[0-9a-f-]+(&reminders=1)?$/);
    assert.ok(!/complete|snooze|mark/i.test(links.join(" ")), "no action is performed by a link");
    assert.ok(!/SECRET|Private Lane|door code/.test(mail.html + mail.text));
    const taskMail = buildReminderEmail({ to: "x@example.com", tripId: T, subject: "task", subjectId: randomUUID(), title: "Task reminder", body: "Your task “x” is due today.", idempotencyKey: "k" }, "https://atlas.example");
    assert.match(taskMail.text, /\/packing\?task=/);
    const sent: { to: string; subject: string; idem?: string }[] = [];
    const real = createReminderSender({ config: { origin: "https://atlas.example", apiKey: "k", from: "Atlas <a@example.com>", devInbox: "dev@example.com" }, transport: async (m) => { sent.push({ to: m.to, subject: m.subject, idem: m.idempotencyKey }); return { accepted: true }; } })!;
    assert.equal(await real({ to: "someone@example.com", tripId: T, subject: "booking", subjectId: randomUUID(), title: "Booking reminder", body: "Your “Spa” starts in 2 hours.", idempotencyKey: "reminder:1:1" }), "sent");
    assert.deepEqual(sent.map((s) => [s.to, s.idem]), [["dev@example.com", "reminder:1:1"]]);
    const refusing = createReminderSender({ config: { origin: "https://atlas.example", apiKey: "k", from: "a", devInbox: null }, transport: async () => ({ accepted: false }) })!;
    assert.equal(await refusing({ to: "a@b.c", tripId: T, subject: "task", subjectId: randomUUID(), title: "t", body: "b", idempotencyKey: "k" }), "failed");
  });

  console.log("Snooze");
  await check("snooze persists, replaces the pending occurrence, marks the old item, and cannot be duplicated", async () => {
    const t = await mkTask({ due_date: "2026-10-17", due_time: "18:00" });
    assert.ok((await setupT(t, "custom", { customAmount: 3, customUnit: "hours" })).ok); // 15:00 on the 17th
    await rem.runReminders(db, { now: at("2026-10-17", "15:01") });
    const r = (await row(t, EDITOR))!;
    const when = at("2026-10-17", "16:30");
    const a = await rem.snoozeReminder(db, EDITOR, r.id, when.getTime(), at("2026-10-17", "15:02").getTime());
    assert.equal(a.ok, true);
    const s = (await row(t, EDITOR))!;
    assert.deepEqual([s.status, s.occurrence, s.snooze_count], ["pending", 2, 1]);
    assert.equal(ms(s.snoozed_until), when.getTime());
    assert.equal(ms(s.fire_at), when.getTime());
    // The same request twice is one snooze.
    await rem.snoozeReminder(db, EDITOR, r.id, when.getTime(), at("2026-10-17", "15:03").getTime());
    const again = (await row(t, EDITOR))!;
    assert.deepEqual([again.occurrence, again.snooze_count], [2, 1]);
    // The earlier item is marked snoozed; no new item before the time.
    const items = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.filter((i) => i.type === "reminder");
    assert.deepEqual(items.map((i) => i.reminder?.state), ["snoozed"]);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-17", "16:00") })).claimed, 0);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-17", "16:31") })).sent, 1);
    const after = await inbox(EDITOR);
    assert.equal(after.length, 2);
    assert.equal(after[1].metadata.occ, "2");
    // The snoozed occurrence also survives an unrelated edit of the task.
    await wipe();
  });
  await check("a snooze survives changes that do not touch the due time, but is replaced when the due time moves", async () => {
    const t = await mkTask({ due_date: "2026-10-17", due_time: "18:00" });
    assert.ok((await setupT(t, "custom", { customAmount: 3, customUnit: "hours" })).ok);
    await rem.runReminders(db, { now: at("2026-10-17", "15:01") });
    const r = (await row(t, EDITOR))!;
    await rem.snoozeReminder(db, EDITOR, r.id, at("2026-10-17", "16:30").getTime(), at("2026-10-17", "15:02").getTime());
    assert.ok((await updateTask(t, { label: "Renamed", due_date: "2026-10-17", due_time: "18:00" })).ok);
    assert.equal(ms((await row(t, EDITOR))!.fire_at), at("2026-10-17", "16:30").getTime());
    assert.ok((await updateTask(t, { label: "Renamed", due_date: "2026-10-17", due_time: "20:00" })).ok);
    const moved = (await row(t, EDITOR))!;
    assert.equal(ms(moved.fire_at), at("2026-10-17", "17:00").getTime());
    assert.equal(moved.snoozed_until, null);
    await wipe();
  });
  await check("a booking snooze that would fall after the booking starts is refused, with a clear reason", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    const r = (await row(b, EDITOR))!;
    const late = await rem.snoozeReminder(db, EDITOR, r.id, at("2026-10-16", "11:00").getTime(), at("2026-10-16", "09:02").getTime());
    assert.equal(late.ok, false);
    assert.equal(!late.ok && late.reason, "too_late");
    assert.match(!late.ok ? (late.detail ?? "") : "", /after this booking starts/);
    const soon = await rem.snoozeReminder(db, EDITOR, r.id, at("2026-10-16", "09:03").getTime(), at("2026-10-16", "09:02").getTime());
    assert.equal(soon.ok, false, "too short a snooze");
    assert.equal((await row(b, EDITOR))!.status, "sent", "a refused snooze changes nothing");
    const ok = await rem.snoozeReminder(db, EDITOR, r.id, at("2026-10-16", "10:15").getTime(), at("2026-10-16", "09:02").getTime());
    assert.equal(ok.ok, true);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "10:16") })).sent, 1);
    assert.match((await inbox(EDITOR)).at(-1)!.body, /starts in 44 minutes/);
    await wipe();
  });
  await check("a snoozed reminder is not moved by quiet hours (an explicit choice), but is dropped if the booking is cancelled", async () => {
    await rem.savePrefs(db, EDITOR, prefs({ quiet_enabled: true, quiet_zone: TZ, quiet_start: "22:00", quiet_end: "07:00" }));
    const b = await mkBooking({ start_date: "2026-10-17", start_time: "00:40", end_date: "2026-10-17", end_time: "02:00" });
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    // 24 h before is 00:40 on the 16th — inside quiet hours — so it was moved earlier to 22:00 on the 15th.
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-15", "22:00").getTime());
    assert.equal((await rem.runReminders(db, { now: at("2026-10-15", "22:01") })).sent, 1);
    const r = (await row(b, EDITOR))!;
    assert.equal((await rem.snoozeReminder(db, EDITOR, r.id, at("2026-10-16", "23:00").getTime(), at("2026-10-15", "22:02").getTime())).ok, true);
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-16", "23:00").getTime(), "23:00 is inside quiet hours, and the explicit choice stands");
    assert.ok((await update(b, { start_date: "2026-10-17", start_time: "00:40", end_date: "2026-10-17", end_time: "02:00", status: "cancelled" })).ok);
    assert.equal((await rem.runReminders(db, { now: at("2026-10-16", "23:01") })).sent, 0);
    await wipe();
  });

  console.log("Authorization");
  await check("only the recipient can snooze, mute or allow their own reminder; someone else's id is simply not found", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR, VIEWER])).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    const e = (await row(b, EDITOR))!;
    const v = (await row(b, VIEWER))!;
    const t = at("2026-10-16", "10:00").getTime();
    const now = at("2026-10-16", "09:02").getTime();
    assert.deepEqual(await rem.snoozeReminder(db, VIEWER, e.id, t, now), { ok: false, reason: "not_found" });
    assert.deepEqual(await rem.snoozeReminder(db, OWNER, e.id, t, now), { ok: false, reason: "not_found" }, "not even the owner");
    assert.deepEqual(await rem.snoozeReminder(db, STRANGER, e.id, t, now), { ok: false, reason: "not_found" });
    assert.deepEqual(await rem.muteReminder(db, OWNER, e.id), { ok: false, reason: "not_found" });
    assert.deepEqual(await rem.allowQuietReminder(db, VIEWER, e.id), { ok: false, reason: "not_found" });
    assert.equal((await row(b, EDITOR))!.status, "sent", "nothing changed");
    // A viewer may snooze or mute the reminder addressed to THEM (it changes nothing about the trip).
    assert.equal((await rem.snoozeReminder(db, VIEWER, v.id, t, now)).ok, true);
    assert.equal((await rem.muteReminder(db, VIEWER, v.id)).ok, true);
    const muted = (await row(b, VIEWER))!;
    assert.deepEqual([muted.status, muted.status_reason], ["canceled", "recipient_muted"]);
    // …and a muted reminder stays off through later edits of the booking.
    assert.ok((await update(b, { title: "Catamaran 2" })).ok);
    assert.equal((await row(b, VIEWER))!.status, "canceled");
    // A removed member can do nothing with it either.
    await sh.leaveTrip(db, EDITOR, T);
    assert.deepEqual(await rem.snoozeReminder(db, EDITOR, e.id, t, now), { ok: false, reason: "unavailable" });
    await join(T, EDITOR, "editor");
    await wipe();
  });
  await check("setting reminders up needs edit rights (owner / editor); a viewer is refused by the same gate every edit uses", async () => {
    await assert.rejects(sh.runTripWrite(db, VIEWER, T, "contribute", null, async () => "should not run"), /./);
    assert.equal(await sh.runTripWrite(db, EDITOR, T, "contribute", null, async () => "ok"), "ok");
    assert.equal(await sh.runTripWrite(db, VIEWER, T, "read", null, async () => "ok"), "ok", "recipient actions need only membership");
    assert.equal(await sh.runTripWrite(db, STRANGER, T, "read", "none", async () => "ok"), "none");
    const dal = readFileSync("src/lib/dal.ts", "utf8");
    const fn = (name: string) => dal.slice(dal.indexOf(`export async function ${name}`), dal.indexOf("\n}\n", dal.indexOf(`export async function ${name}`)));
    for (const name of ["setRemindersForUser", "previewRemindersForUser"]) assert.match(fn(name), /editTrip\(/, `${name} must require edit rights`);
    for (const name of ["snoozeReminderForUser", "muteReminderForUser", "allowQuietReminderForUser"]) {
      const body = fn(name);
      assert.match(body, /withTripWrite\(tripId, "read"/, `${name} must check membership of THIS trip`);
      assert.match(body, /ctx\.userId/, `${name} must act for the verified session user`);
      assert.ok(!/recipient/i.test(body.replace(/recipient actions/gi, "")), `${name} must not take a recipient from the request`);
    }
    // No exported action takes an owner, a user or a single recipient as a parameter: authority comes from the session.
    const actions = readFileSync("src/app/actions/reminders.ts", "utf8");
    const signatures = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    assert.ok(signatures.length >= 8, `found ${signatures.length} reminder actions`);
    for (const [, name, params] of signatures) assert.ok(!/\b(owner|ownerId|userId|user|recipient|recipientId)\b\s*[:,?]/.test(params), `${name} must not take a person as an argument`);
  });
  await check("the inbox only offers actions the person can take now — a viewer cannot complete a task", async () => {
    await join(T, EDITOR, "editor").catch(() => undefined);
    const tEd = await mkTask({ assignee_id: EDITOR, due_date: "2026-10-16", due_time: "11:00", label: "Print tickets" });
    const tVi = await mkTask({ assignee_id: VIEWER, due_date: "2026-10-16", due_time: "11:00", label: "Buy sunscreen" });
    assert.ok((await setupT(tEd, "at_due")).ok);
    assert.ok((await setupT(tVi, "at_due")).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "11:01") });
    const role = async (user: string) => (await sh.resolveTripAccess(db, user, T))?.role ?? null;
    const items = async (user: string) => {
      const list = (await n.listNotifications(db, { id: user, verifiedEmail: null })).items.filter((i) => i.reminder);
      return rem.inboxActions(db, user, list.map((i) => ({ reminderId: i.reminder!.reminderId, occurrence: i.reminder!.occurrence })), async () => role(user), at("2026-10-16", "11:02").getTime());
    };
    const editorActions = [...(await items(EDITOR)).values()][0];
    assert.equal(editorActions.canComplete, true);
    assert.equal(editorActions.canSnooze, true);
    assert.deepEqual(editorActions.snoozeOptions.map((o) => o.id), ["15m", "1h"]);
    const viewerActions = [...(await items(VIEWER)).values()][0];
    assert.equal(viewerActions.canComplete, false, "a viewer's edit rights are not broadened by being assigned a task");
    assert.equal(viewerActions.canSnooze, true);
    await q.setPackingItemPacked(db, OWNER, T, tEd, true);
    const done = [...(await items(EDITOR)).values()][0];
    assert.equal(done.canComplete, false);
    assert.equal(done.canSnooze, false, "a completed task has nothing to snooze");
    assert.equal(done.taskDone, true);
    await wipe();
  });
  await check("a booking's inbox item offers directions only when a linked place already has a link", async () => {
    const b = await mkBooking({ title: "Spa" });
    const place = await q.createPlace(db, OWNER, T, { name: "Spa Aruba", kind: "place", category: "spa", priority: "must_do", address: "Palm Beach", maps_url: "https://maps.google.com/?q=spa", website_url: null, planning_notes: null } as never);
    assert.ok(place);
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:01") });
    const list = (await n.listNotifications(db, { id: EDITOR, verifiedEmail: null })).items.filter((i) => i.reminder);
    const ask = async () => [...(await rem.inboxActions(db, EDITOR, list.map((i) => ({ reminderId: i.reminder!.reminderId, occurrence: i.reminder!.occurrence })), async () => "editor", at("2026-10-16", "09:02").getTime())).values()][0];
    assert.equal((await ask()).directionsUrl, null, "no linked place, no invented link");
    await db.execute(sql`insert into itinerary_items (trip_id, owner_id, place_id, reservation_id, status) values (${T}, ${OWNER}, ${(place as { id: string }).id}, ${b}, 'planned')`);
    assert.equal((await ask()).directionsUrl, "https://maps.google.com/?q=spa");
    await db.execute(sql`delete from itinerary_items where trip_id = ${T}`);
    await db.execute(sql`delete from places where trip_id = ${T}`);
    await wipe();
  });
  await check("the notification type is live and its destinations are checked", async () => {
    const sid = randomUUID();
    const href = (meta: Record<string, string>) => resolveDestination("reminder", { tripId: T, resourceId: randomUUID(), metadata: meta, isMember: true });
    assert.equal(href({ s: "booking", sid }), `/trips/${T}/bookings?booking=${sid}`);
    assert.equal(href({ s: "task", sid }), `/trips/${T}/packing?task=${sid}`);
    assert.equal(href({ s: "task", sid: "../../etc" }), `/trips/${T}`, "tampered metadata falls back to the trip");
    assert.equal(href({ s: "evil", sid }), `/trips/${T}`);
    assert.equal(isSafeInternalPath(`/trips/${T}/packing?task=${sid}`), true);
    assert.equal(isSafeInternalPath(`/trips/${T}/packing?task=${sid}&x=1`), false);
    assert.equal(isSafeInternalPath(`//evil.example`), false);
  });

  console.log("Edge cases");
  await check("a final outcome (expired, failed) is not rewritten by an unrelated edit of the record", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-16", "09:45") }); // too late: expired
    assert.deepEqual([(await row(b, EDITOR))!.status, (await row(b, EDITOR))!.status_reason], ["skipped", "expired"]);
    assert.ok((await update(b, { notes: "just a note" })).ok);
    assert.equal((await row(b, EDITOR))!.status_reason, "expired");
    // …but moving the booking to a time that is still ahead gives it a fresh, honest schedule.
    assert.ok((await update(b, { start_time: "18:00", end_time: "19:00" })).ok);
    const r = (await row(b, EDITOR))!;
    assert.equal(r.status, "pending");
    assert.equal(ms(r.fire_at), at("2026-10-16", "16:00").getTime());
    await wipe();
  });
  await check("copying a packing list from another trip carries no assignee, due date or reminder", async () => {
    const source = await q.createTrip(db, OWNER, tripInput);
    const sc = await q.createPackingCategory(db, OWNER, source.id, { name: "Clothes" });
    assert.ok(sc.ok);
    const si = await q.createPackingItem(db, OWNER, source.id, { category_id: sc.id, label: "Hat", quantity: 1, traveler_name: null, notes: null, assignee_id: OWNER, due_date: "2026-10-12", due_time: "09:00" });
    assert.ok(si.ok);
    await rem.setReminders(db, ctx, source.id, "task", si.id, { preset: "at_due", rule: {}, recipientIds: [] }, at("2026-10-01", "12:00").getTime());
    assert.deepEqual(await q.copyPackingFromTrip(db, OWNER, T, source.id, "all"), { ok: true, addedItems: 1, skippedItems: 0, newCategories: 1 });
    const copied = (await db.execute(sql`select assignee_id, due_date, due_time_zone from packing_items where trip_id = ${T} and label = 'Hat'`)).rows[0];
    assert.deepEqual([copied.assignee_id, copied.due_date, copied.due_time_zone], [null, null, null]);
    assert.equal(Number((await db.execute(sql`select count(*)::int as c from reminders where trip_id = ${T}`)).rows[0].c), 0);
    await q.deleteTrip(db, OWNER, source.id);
    await wipe();
    await db.execute(sql`delete from packing_categories where trip_id = ${T} and name = 'Clothes'`);
  });

  console.log("Trip changes");
  await check("a booking with no zone of its own follows the trip's zone when that changes", async () => {
    const b = await mkBooking({ start_time_zone: null, end_time_zone: null });
    assert.ok((await setupB(b, "2h", [EDITOR])).ok);
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-16", "09:00").getTime());
    assert.equal(await q.updateTrip(db, OWNER, T, { ...tripInput, time_zone: "America/New_York" }), true);
    assert.equal(ms((await row(b, EDITOR))!.fire_at), at("2026-10-16", "09:00", "America/New_York").getTime());
    await q.updateTrip(db, OWNER, T, tripInput);
    await wipe();
  });
  console.log("Account Settings gate");
  await check("a reminder type switched off in Settings is not delivered (nothing deleted), the other type is unaffected, and it resumes when switched back on", async () => {
    const b = await mkBooking();
    const t = await mkTask({ due_time: "11:00" });
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    assert.ok((await setupT(t, "1d_before")).ok);
    await st.saveSection(db, EDITOR, "notifications", { booking_reminders: false }, rem.syncRecipient);
    await rem.runReminders(db, { now: at("2026-10-15", "11:01") });
    const kinds = async () => (await inbox(EDITOR)).map((i) => i.metadata.s).sort();
    assert.deepEqual(await kinds(), ["task"], "only the task reminder arrived");
    assert.ok(await row(b, EDITOR), "the booking reminder is still set up");
    await st.saveSection(db, EDITOR, "notifications", { booking_reminders: true }, rem.syncRecipient);
    await rem.runReminders(db, { now: at("2026-10-15", "11:03") });
    assert.deepEqual(await kinds(), ["booking", "task"], "back on: the booking reminder is delivered while still ahead of the booking");
    await wipe();
  });
  await check("a type switched off stops new reminders but never removes what is already in the inbox", async () => {
    const b = await mkBooking();
    assert.ok((await setupB(b, "24h", [EDITOR])).ok);
    await rem.runReminders(db, { now: at("2026-10-15", "11:01") });
    assert.equal((await inbox(EDITOR)).length, 1);
    await st.saveSection(db, EDITOR, "notifications", { booking_reminders: false }, rem.syncRecipient);
    assert.equal((await inbox(EDITOR)).length, 1);
    await wipe();
  });
  await check("deleting the trip deletes its reminders", async () => {
    const other = await q.createTrip(db, OWNER, tripInput);
    const r = await q.createReservation(db, OWNER, other.id, booking);
    await rem.setReminders(db, ctx, other.id, "booking", r!.id, { preset: "24h", rule: {}, recipientIds: [OWNER] }, NOW0.getTime());
    assert.equal(Number((await db.execute(sql`select count(*)::int as c from reminders where trip_id = ${other.id}`)).rows[0].c), 1);
    await q.deleteTrip(db, OWNER, other.id);
    assert.equal(Number((await db.execute(sql`select count(*)::int as c from reminders where trip_id = ${other.id}`)).rows[0].c), 0);
  });

  await q.deleteTrip(db, OWNER, T);
  await db.execute(sql`delete from reminder_prefs where user_id in (${OWNER}, ${EDITOR}, ${VIEWER}, ${STRANGER})`);
  await db.execute(sql`delete from user_profiles where user_id in (${OWNER}, ${EDITOR}, ${VIEWER})`);
  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
