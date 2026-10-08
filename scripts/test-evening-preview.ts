/**
 * Evening preview of tomorrow: schedule maths (trip calendar, DST, boundaries,
 * staleness), opt-in / opt-out, removed members, duplicate and concurrent
 * workers, email retries with a mock provider, poll selection, empty days,
 * privacy, dry runs. Nothing real is ever sent.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:evening
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as ev from "../src/db/evening-preview";
import * as n from "../src/db/notifications";
import * as pollDb from "../src/db/polls";
import * as q from "../src/db/queries";
import * as sh from "../src/db/sharing";
import * as st from "../src/db/settings";
import { trips } from "../src/db/schema";
import { buildPreviewEmail, createPreviewSender, type PreviewSender } from "../src/lib/email/evening-email";
import { composePreview, evaluateSchedule, sampleTarget, selectPoll, SEND_TIMES, STALE_AFTER_MINUTES } from "../src/lib/evening-preview";
import { resolveDestination } from "../src/lib/notifications";
import type { ItineraryItemInput, ReservationInput, TripInput } from "../src/lib/types";

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

const TZ = "America/Aruba"; // UTC−4, no DST: 19:05 local = 23:05Z the same date.
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`);
const tripInput: TripInput = { title: "Aruba trip", destination: "Aruba", start_date: "2026-10-14", end_date: "2026-10-19", time_zone: TZ, travelers: ["A"], cover_image: "beach", notes: null };
const visit = (title: string | null, date: string, time: string | null, over: Partial<ItineraryItemInput> = {}): ItineraryItemInput => ({
  place_id: null, reservation_id: null, title, category: "activity", local_date: date, local_start_time: time, local_end_date: null, local_end_time: null, timezone: null, planning_notes: null, ...over,
});
const booking: ReservationInput = {
  kind: "activity", status: "confirmed", title: "Catamaran", provider: null, confirmation_code: "SECRET-REF-9", start_date: "2026-10-16", start_time: "10:00",
  start_time_zone: TZ, end_date: "2026-10-16", end_time: "13:00", end_time_zone: TZ, origin: null, destination: null, location: "12 Private Lane", booking_url: "https://example.com/booking/xyz", notes: "door code 4321", details: {},
};

async function join(tripId: string, userId: string, role: "editor" | "viewer") {
  const made = await sh.createInvitation(db, { ownerId: OWNER, tripId, invitedBy: OWNER, inviterName: "Olive", email: null, role });
  assert.ok(made.ok);
  assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId, verifiedEmail: null, emailUnverified: false })).status, "ok");
}

async function main() {
  console.log("Schedule (pure)");
  const sched = (nowIso: string, tz = TZ, time = "19:00", start = "2026-10-14", end = "2026-10-19") =>
    evaluateSchedule({ now: new Date(nowIso), timeZone: tz, sendTime: time, tripStart: start, tripEnd: end });
  await check("tomorrow is the trip's calendar date, not the server's", () => {
    // 2026-10-14 01:00Z is still the 13th evening in Aruba (21:00): tomorrow = the 14th.
    const d = sched("2026-10-14T01:00:00Z");
    assert.equal(d.localToday, "2026-10-13");
    assert.equal(d.targetDate, "2026-10-14");
    assert.equal(d.state, "due");
    // Same instant, a zone far ahead: it is already the 14th at 15:00 (Kiritimati +14) and tomorrow is the 15th.
    const k = sched("2026-10-14T01:00:00Z", "Pacific/Kiritimati", "16:00");
    assert.equal(k.localToday, "2026-10-14");
    assert.equal(k.targetDate, "2026-10-15");
    assert.equal(sched("2026-10-14T01:00:00Z", "Pacific/Pago_Pago", "16:00").localToday, "2026-10-13");
  });
  await check("the evening before day one is included; the last evening and later are not", () => {
    assert.equal(sched("2026-10-13T23:05:00Z").state, "due"); // 19:05 on the 13th → target = first day
    assert.equal(sched("2026-10-12T23:05:00Z").state, "outside"); // target = the 13th, before the trip
    assert.equal(sched("2026-10-18T23:05:00Z").state, "due"); // target = last day (19th)
    assert.equal(sched("2026-10-19T23:05:00Z").state, "outside"); // target = the 20th: trip is over
    assert.equal(sched("2026-10-25T23:05:00Z").state, "outside");
  });
  await check("not due before the time, due for a window after it, stale after that", () => {
    assert.equal(sched("2026-10-14T22:59:00Z").state, "not_due");
    assert.equal(sched("2026-10-14T23:00:00Z").state, "due");
    assert.equal(sched(new Date(Date.parse("2026-10-14T23:00:00Z") + STALE_AFTER_MINUTES * 60_000).toISOString()).state, "due");
    assert.equal(sched(new Date(Date.parse("2026-10-14T23:00:00Z") + (STALE_AFTER_MINUTES + 1) * 60_000).toISOString()).state, "stale");
    assert.equal(sched("2026-10-15T00:30:00Z").state, "due"); // 20:30 local, 90 minutes after 7:00 PM
  });
  await check("daylight saving: the local wall clock decides, in both directions", () => {
    const NY = "America/New_York";
    // Spring forward 2026-03-08 (02:00 → 03:00). 19:00 local that day is EDT (UTC−4) = 23:00Z.
    assert.equal(evaluateSchedule({ now: new Date("2026-03-08T22:59:00Z"), timeZone: NY, sendTime: "19:00", tripStart: "2026-03-01", tripEnd: "2026-03-20" }).state, "not_due");
    const spring = evaluateSchedule({ now: new Date("2026-03-08T23:01:00Z"), timeZone: NY, sendTime: "19:00", tripStart: "2026-03-01", tripEnd: "2026-03-20" });
    assert.equal(spring.state, "due");
    assert.equal(spring.targetDate, "2026-03-09");
    assert.equal(spring.scheduledFor, "2026-03-08T23:00:00.000Z");
    // The evening before spring-forward is still EST (UTC−5): 19:00 = 00:00Z next day.
    const before = evaluateSchedule({ now: new Date("2026-03-08T00:01:00Z"), timeZone: NY, sendTime: "19:00", tripStart: "2026-03-01", tripEnd: "2026-03-20" });
    assert.equal(before.localToday, "2026-03-07");
    assert.equal(before.targetDate, "2026-03-08", "tomorrow is a 23-hour day, still exactly one calendar day ahead");
    assert.equal(before.state, "due");
    // Fall back 2026-11-01: the evening of the 1st is EST (UTC−5): 19:00 = 00:00Z on the 2nd; 23:30Z is only 18:30.
    assert.equal(evaluateSchedule({ now: new Date("2026-11-01T23:30:00Z"), timeZone: NY, sendTime: "19:00", tripStart: "2026-10-30", tripEnd: "2026-11-05" }).state, "not_due");
    const fall = evaluateSchedule({ now: new Date("2026-11-02T00:10:00Z"), timeZone: NY, sendTime: "19:00", tripStart: "2026-10-30", tripEnd: "2026-11-05" });
    assert.equal(fall.state, "due");
    assert.equal(fall.targetDate, "2026-11-02");
    // Europe/London: BST ends 2026-10-25.
    const lon = evaluateSchedule({ now: new Date("2026-10-24T18:05:00Z"), timeZone: "Europe/London", sendTime: "19:00", tripStart: "2026-10-20", tripEnd: "2026-10-30" });
    assert.equal(lon.state, "due"); // 18:05Z is 19:05 BST
  });
  await check("no backlog after an outage: only tonight's target is ever considered", () => {
    // The job was down for two days; the first run on the 16th looks only at the 17th.
    const d = sched("2026-10-16T23:10:00Z");
    assert.equal(d.targetDate, "2026-10-17");
    assert.equal(d.state, "due");
    assert.equal(sched("2026-10-17T03:00:00Z").state, "stale"); // 23:00 Aruba on the 16th, 4 h late
  });
  await check("choosable times are half-hours from 4:00 PM to 10:00 PM; the sample falls back to the first day", () => {
    assert.equal(SEND_TIMES[0], "16:00");
    assert.equal(SEND_TIMES.at(-1), "22:00");
    assert.equal(sampleTarget(new Date("2026-10-01T12:00:00Z"), TZ, "2026-10-14", "2026-10-19")?.date, "2026-10-14");
    assert.equal(sampleTarget(new Date("2026-10-16T12:00:00Z"), TZ, "2026-10-14", "2026-10-19")?.isTomorrow, true);
    assert.equal(sampleTarget(new Date("2026-10-30T12:00:00Z"), TZ, "2026-10-14", "2026-10-19"), null);
  });

  console.log("Setup");
  const createdTrips: string[] = [];
  const { id: T } = await q.createTrip(db, OWNER, tripInput);
  createdTrips.push(T);
  await join(T, EDITOR, "editor");
  await join(T, VIEWER, "viewer");
  for (const [u, e] of [[OWNER, "owner@example.com"], [EDITOR, "editor@example.com"], [VIEWER, "viewer@example.com"]] as const) {
    await sh.upsertProfile(db, { id: u, name: `Name ${u.slice(5, 9)}`, email: e });
  }
  const opt = (user: string, over: Partial<ev.PrefsInput> = {}) => ev.savePrefs(db, OWNER, T, user, { enabled: true, send_time: "19:00", in_app: true, email: false, ...over });
  const inbox = async (user: string) => (await n.listNotifications(db, { id: user, verifiedEmail: null }, { limit: 50 })).items.filter((i) => i.type === "evening_preview");
  const ledger = async (user: string) => (await db.execute(sql`select * from evening_preview_deliveries where trip_id = ${T} and user_id = ${user} order by target_date, channel`)).rows;
  const wipe = async () => {
    await db.execute(sql`delete from evening_preview_deliveries where trip_id = ${T}`);
    await db.execute(sql`delete from notifications where trip_id = ${T} and type = 'evening_preview'`);
  };
  const sender = (log: { to: string; key: string }[], outcome: () => "sent" | "failed" = () => "sent"): PreviewSender => async ({ to, idempotencyKey }) => {
    log.push({ to, key: idempotencyKey });
    return outcome();
  };

  console.log("Opt-in and opt-out");
  await check("nothing is sent until someone opts in (the default is off)", async () => {
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05") });
    assert.equal(r.considered, 0);
    assert.equal((await inbox(EDITOR)).length + (await inbox(VIEWER)).length, 0);
    assert.deepEqual(await ev.getPrefs(db, T, EDITOR), ev.DEFAULT_PREFS);
    assert.equal(ev.DEFAULT_PREFS.enabled, false);
    assert.equal(ev.DEFAULT_PREFS.send_time, "19:00");
    await opt(EDITOR, { enabled: false });
    assert.equal((await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05") })).due, 0);
  });
  await check("the database refuses a night-time ping and a preference with no way to receive it", async () => {
    assert.equal(await ev.savePrefs(db, OWNER, T, EDITOR, { enabled: true, send_time: "03:00", in_app: true, email: false }), false);
    assert.equal(await ev.savePrefs(db, OWNER, T, EDITOR, { enabled: true, send_time: "19:00", in_app: false, email: false }), false);
    await assert.rejects(db.execute(sql`insert into evening_preview_prefs (trip_id, owner_id, user_id, send_time) values (${T}, ${OWNER}, ${STRANGER}, '03:00')`));
    await assert.rejects(db.execute(sql`insert into evening_preview_prefs (trip_id, owner_id, user_id, in_app, email) values (${T}, ${OWNER}, ${STRANGER}, false, false)`));
  });

  console.log("Delivery");
  await db.execute(sql`delete from evening_preview_deliveries where trip_id = ${T}`);
  await q.createItineraryItem(db, OWNER, T, visit("Snorkel tour", "2026-10-14", "09:00"), {});
  await q.createItineraryItem(db, OWNER, T, visit("Lunch at the condo", "2026-10-14", null, { category: "food" }), {});
  await q.createItineraryItem(db, OWNER, T, visit("Rest at the condo", "2026-10-14", null, { is_protected_rest: true } as Partial<ItineraryItemInput>), {});
  await q.createItineraryItem(db, OWNER, T, visit("Sunset walk", "2026-10-14", "17:30"), {});
  await check("the evening before day one delivers a preview of the saved plan to opted-in members only", async () => {
    await opt(EDITOR);
    await opt(VIEWER);
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-13", "19:05") });
    assert.equal(r.inAppCreated, 2);
    const [e] = await inbox(EDITOR);
    assert.equal(e.title, "Tomorrow in Aruba");
    assert.match(e.body, /Wed, Oct 14: Snorkel tour \(9:00 AM\), Sunset walk \(5:30 PM\) and Lunch at the condo and 1 more\./);
    assert.match(e.body, /First start 9:00 AM\./);
    assert.match(e.body, /As of 7:05 PM AST\./);
    assert.equal(e.href, `/trips/${T}/itinerary?day=2026-10-14`);
    assert.equal((await inbox(VIEWER)).length, 1);
    assert.equal((await inbox(OWNER)).length, 0, "not opted in");
    assert.equal((await inbox(STRANGER)).length, 0);
  });
  await check("a repeated or concurrent run does not duplicate", async () => {
    const before = (await inbox(EDITOR)).length;
    const runs = await Promise.all(Array.from({ length: 6 }, () => ev.runEveningPreviews(db, { now: at("2026-10-13", "19:20") })));
    assert.equal(runs.reduce((a, r) => a + r.inAppCreated, 0), 0);
    assert.equal((await inbox(EDITOR)).length, before);
    await wipe();
    const racing = await Promise.all(Array.from({ length: 6 }, () => ev.runEveningPreviews(db, { now: at("2026-10-13", "19:05") })));
    assert.equal(racing.reduce((a, r) => a + r.inAppCreated, 0), 2, "exactly one per recipient across six simultaneous workers");
    assert.equal((await inbox(EDITOR)).length, 1);
    assert.equal((await ledger(EDITOR)).length, 1);
    assert.equal(racing.reduce((a, r) => a + r.errors, 0), 0);
  });
  await check("a sent preview is a snapshot: later edits are not resent", async () => {
    await q.createItineraryItem(db, OWNER, T, visit("Late addition", "2026-10-14", "20:00"), {});
    await ev.runEveningPreviews(db, { now: at("2026-10-13", "19:40") });
    const items = await inbox(EDITOR);
    assert.equal(items.length, 1);
    assert.ok(!items[0].body.includes("Late addition"));
  });
  await check("the preferred time is respected, per person", async () => {
    await wipe();
    await opt(EDITOR, { send_time: "20:00" });
    const early = await ev.runEveningPreviews(db, { now: at("2026-10-13", "19:05") });
    assert.equal(early.inAppCreated, 1, "the viewer's 7:00 PM; the editor waits for 8:00 PM");
    const later = await ev.runEveningPreviews(db, { now: at("2026-10-13", "20:05") });
    assert.equal(later.inAppCreated, 1);
    await opt(EDITOR);
  });
  await check("outside the trip, nothing is sent: not long before, not after the last day", async () => {
    await wipe();
    for (const [d] of [["2026-10-11"], ["2026-10-12"], ["2026-10-19"], ["2026-10-20"], ["2026-11-30"]]) {
      const r = await ev.runEveningPreviews(db, { now: at(d, "19:05") });
      assert.equal(r.inAppCreated, 0, d);
    }
    assert.equal((await db.execute(sql`select 1 from evening_preview_deliveries where trip_id = ${T}`)).rows.length, 0);
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-18", "19:05") });
    assert.equal(r.inAppCreated, 2, "the evening before the last day");
  });
  await check("stale windows are skipped, never sent late; an outage leaves no backlog", async () => {
    await wipe();
    const late = await ev.runEveningPreviews(db, { now: at("2026-10-14", "23:00") });
    assert.equal(late.inAppCreated, 0);
    assert.ok(late.skippedStale >= 2);
    const rows = await ledger(EDITOR);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "skipped");
    assert.equal(rows[0].reason, "stale");
    // Down for days, then back: only the night's own target is considered.
    const back = await ev.runEveningPreviews(db, { now: at("2026-10-17", "19:10") });
    assert.equal(back.inAppCreated, 2);
    const dates = (await ledger(EDITOR)).map((r) => String(r.target_date).slice(0, 10)).sort();
    assert.deepEqual(dates, ["2026-10-15", "2026-10-18"]);
    assert.equal((await inbox(EDITOR)).length, 1, "one preview — for the 18th — and nothing for the missed dates");
  });
  await check("a skipped (stale) night is not sent by a later run either", async () => {
    await wipe();
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "23:30") });
    assert.equal((await ev.runEveningPreviews(db, { now: at("2026-10-14", "23:31") })).inAppCreated, 0);
  });

  console.log("Membership and preferences are re-checked");
  await check("a removed member gets nothing, and their opt-in goes with their access", async () => {
    await wipe();
    assert.deepEqual(await sh.removeMember(db, OWNER, T, VIEWER), { ok: true });
    assert.deepEqual(await ev.getPrefs(db, T, VIEWER), ev.DEFAULT_PREFS);
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05") });
    assert.equal(r.inAppCreated, 1);
    assert.equal((await inbox(VIEWER)).length, 0);
    await join(T, VIEWER, "viewer");
  });
  await check("even if the preference row survives (access lost out-of-band), nobody is notified", async () => {
    await wipe();
    await opt(VIEWER);
    await db.execute(sql`delete from trip_members where trip_id = ${T} and user_id = ${VIEWER}`);
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05") });
    assert.equal(r.skippedNotMember, 1);
    assert.equal((await inbox(VIEWER)).length, 0);
    assert.equal((await ledger(VIEWER)).length, 0);
    await db.execute(sql`delete from evening_preview_prefs where trip_id = ${T} and user_id = ${VIEWER}`);
    await join(T, VIEWER, "viewer");
  });
  await check("opting out stops it", async () => {
    await wipe();
    await opt(EDITOR, { enabled: false });
    await opt(VIEWER, { enabled: false });
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05") });
    assert.equal(r.inAppCreated, 0);
    await opt(EDITOR);
    await opt(VIEWER);
  });

  console.log("Content");
  await check("an empty day says so and fills nothing in", async () => {
    const before = (await q.listItinerary(db, OWNER, T))!.length;
    const p = await ev.buildPreview(db, T, EDITOR, "2026-10-17", at("2026-10-16", "19:05"));
    assert.ok(p);
    assert.equal(p.empty, true);
    assert.match(p.body, /^Tomorrow is open\. Keep it flexible or choose something from Explore\./);
    assert.equal((await q.listItinerary(db, OWNER, T))!.length, before);
    assert.deepEqual(p.highlights, []);
    assert.equal(p.firstStart, null);
  });
  await check("the preview is deterministic and carries nothing private", async () => {
    await q.createReservation(db, OWNER, T, booking);
    const a = await ev.buildPreview(db, T, EDITOR, "2026-10-16", at("2026-10-15", "19:05"));
    const b = await ev.buildPreview(db, T, EDITOR, "2026-10-16", at("2026-10-15", "19:05"));
    assert.deepEqual(a, b);
    assert.match(a!.body, /Catamaran \(10:00 AM\)/);
    const mail = buildPreviewEmail(a!, T, "https://atlas.example");
    for (const text of [a!.body, a!.title, mail.text, mail.html, a!.lines.join("\n")]) {
      assert.ok(!/SECRET-REF-9|Private Lane|door code|example\.com\/booking|\/invite\//.test(text), text);
    }
    assert.ok(mail.text.includes(`https://atlas.example/trips/${T}/itinerary?day=2026-10-16`));
    assert.ok(mail.text.includes(`/trips/${T}?evening=1`), "an easy way to turn it off");
    assert.match(mail.text, /Planned as of 7:05 PM AST/);
  });
  await check("skipped and cancelled plans are left out; at most three highlights", async () => {
    const [skipped] = (await q.listItinerary(db, OWNER, T))!.filter((i) => i.title === "Sunset walk");
    await q.reviewItineraryItem(db, OWNER, T, skipped.id, { status: "skipped" });
    const p = await ev.buildPreview(db, T, EDITOR, "2026-10-14", at("2026-10-13", "19:05"));
    assert.ok(!p!.body.includes("Sunset walk"));
    assert.ok(p!.highlights.length <= 3);
    await q.reviewItineraryItem(db, OWNER, T, skipped.id, { status: "planned" });
  });
  await check("the notification opens the current plan, and carries no free-form URL", () => {
    assert.equal(resolveDestination("evening_preview", { tripId: T, resourceId: null, metadata: { date: "2026-10-14" }, isMember: true }), `/trips/${T}/itinerary?day=2026-10-14`);
    assert.equal(resolveDestination("evening_preview", { tripId: T, resourceId: null, metadata: { date: "//evil.example" }, isMember: true }), `/trips/${T}/itinerary`);
    assert.equal(resolveDestination("evening_preview", { tripId: T, resourceId: null, metadata: { poll: "not-a-uuid" }, isMember: true }), `/trips/${T}/itinerary`);
  });

  console.log("Which poll is mentioned");
  const mkPoll = async (user: string, over: Partial<pollDb.PollInput> = {}) => {
    const r = await sh.runTripWrite(db, user, T, "contribute", "NO" as const, (d, c) =>
      pollDb.createPoll(d, c, T, { question: "Lucca or AZIA for dinner?", description: null, options: [{ label: "Lucca", place_id: null }, { label: "AZIA", place_id: null }], any_option: true, closes: null, parent: { type: "day", day: "2026-10-15" }, participant_ids: null, replaces_poll_id: null, ...over }, "Olive"),
    );
    assert.ok(r !== "NO" && r.ok, JSON.stringify(r));
    return r.id;
  };
  const vote = (user: string, poll: string, any = true) =>
    sh.runTripWrite(db, user, T, "participate", "NO" as const, async (d, c) => {
      const opts = (await pollDb.listPolls(d, c, T)).find((p) => p.id === poll)!.options;
      return pollDb.castVote(d, c, T, poll, any ? { any: true } : { option_id: opts[0].id });
    });
  const preview = (user: string, date: string, nowIso = at("2026-10-14", "19:05")) => ev.buildPreview(db, T, user, date, nowIso);
  await check("an unanswered open poll attached to tomorrow is mentioned — without a hint of who is ahead", async () => {
    const p = await mkPoll(OWNER);
    const content = await preview(EDITOR, "2026-10-15");
    assert.equal(content!.poll?.id, p);
    assert.equal(content!.poll?.reason, "tomorrow");
    assert.match(content!.body, /One thing to decide: “Lucca or AZIA for dinner\?”\./);
    assert.equal(content!.href, `/trips/${T}/itinerary?day=2026-10-15`, "tomorrow's page shows the poll beside the plan");
    assert.ok(!/Lucca\)|leading|winning/i.test(content!.body));
    await vote(VIEWER, p, false);
    assert.equal((await preview(EDITOR, "2026-10-15"))!.poll?.id, p, "someone else's vote doesn't hide it");
    assert.equal((await preview(OWNER, "2026-10-15"))!.poll?.id, p, "the asker hasn't answered either");
    assert.ok(!(await preview(EDITOR, "2026-10-15"))!.body.includes("1 vote"));
    // Answered by the recipient → not resurfaced.
    await vote(EDITOR, p);
    assert.equal((await preview(EDITOR, "2026-10-15"))!.poll, null);
    assert.ok(!(await preview(EDITOR, "2026-10-15"))!.body.includes("One thing"));
    // …on a later evening too: still not repeated.
    assert.equal((await preview(EDITOR, "2026-10-15", at("2026-10-14", "20:00")))!.poll, null);
  });
  await check("closed, canceled, expired, decided and not-asked polls never appear", async () => {
    const closed = await mkPoll(OWNER, { question: "Closed one?" });
    await sh.runTripWrite(db, OWNER, T, "participate", "NO" as const, (d, c) => pollDb.closePoll(d, c, T, closed));
    const canceled = await mkPoll(OWNER, { question: "Canceled one?" });
    await sh.runTripWrite(db, OWNER, T, "participate", "NO" as const, (d, c) => pollDb.cancelPoll(d, c, T, canceled));
    const expired = await mkPoll(OWNER, { question: "Expired one?", closes: { date: "2026-12-30", time: "17:00" } });
    await db.execute(sql`update polls set closes_at = now() - interval '1 minute' where id = ${expired}`);
    const decided = await mkPoll(OWNER, { question: "Decided one?" });
    await sh.runTripWrite(db, OWNER, T, "participate", "NO" as const, async (d, c) => {
      const opts = (await pollDb.listPolls(d, c, T)).find((p) => p.id === decided)!.options;
      return pollDb.chooseResult(d, c, T, decided, opts[0].id, "Olive");
    });
    const notAsked = await mkPoll(OWNER, { question: "Not for you?", participant_ids: [VIEWER] });
    const irrelevant = await mkPoll(OWNER, { question: "Trip-level?", parent: { type: "trip" } });
    void notAsked; void irrelevant;
    const content = await preview(EDITOR, "2026-10-15");
    assert.equal(content!.poll, null, JSON.stringify(content!.poll));
  });
  await check("otherwise an unanswered poll closing soon, before what it's about", async () => {
    const [snorkel] = (await q.listItinerary(db, OWNER, T))!.filter((i) => i.title === "Snorkel tour");
    // Deadline 2026-10-14 21:00 Aruba, about the Snorkel tour on the 14th at 9:00 AM — AFTER the activity: not eligible.
    const late = await mkPoll(OWNER, { question: "Too late?", parent: { type: "activity", item_id: snorkel.id }, closes: { date: "2026-12-30", time: "10:00" } });
    await db.execute(sql`update polls set closes_at = '2026-10-14T21:00:00-04:00' where id = ${late}`);
    assert.equal((await preview(EDITOR, "2026-10-15", at("2026-10-14", "19:05")))!.poll, null);
    // A day-parent poll for the 17th closing tomorrow afternoon: eligible, and it leads to the polls page.
    const soon = await mkPoll(OWNER, { question: "Spa day?", parent: { type: "day", day: "2026-10-17" }, closes: { date: "2026-12-30", time: "10:00" } });
    await db.execute(sql`update polls set closes_at = '2026-10-15T15:00:00-04:00' where id = ${soon}`);
    const p = await preview(EDITOR, "2026-10-15", at("2026-10-14", "19:05"));
    assert.equal(p!.poll?.id, soon);
    assert.equal(p!.poll?.reason, "closing_soon");
    assert.equal(p!.href, `/trips/${T}/polls?poll=${soon}`);
    // Too far away to nag about.
    await db.execute(sql`update polls set closes_at = '2026-10-18T15:00:00-04:00' where id = ${soon}`);
    assert.equal((await preview(EDITOR, "2026-10-15", at("2026-10-14", "19:05")))!.poll, null);
  });
  await check("selection order is deterministic: tomorrow's poll beats a closing-soon one; earliest deadline first", () => {
    const base = { status: "open", expired: false, result: null, can: { vote: true }, me: { response: null }, created_at: "2026-10-01T00:00:00Z", parent: { type: "trip", day: null, item: null, place: null, missing: false } };
    const mk = (idn: string, over: object) => ({ id: idn, question: idn, closes_at: null, ...base, ...over }) as never;
    const picks = selectPoll(
      [mk("soon", { closes_at: "2026-10-14T23:00:00Z", parent: { ...base.parent, day: "2026-10-17" } }), mk("tom-late", { closes_at: "2026-10-20T00:00:00Z", parent: { ...base.parent, day: "2026-10-15" } }), mk("tom-early", { closes_at: "2026-10-16T00:00:00Z", parent: { ...base.parent, day: "2026-10-15" } })],
      { targetDate: "2026-10-15", nowMs: Date.parse("2026-10-14T12:00:00Z"), relevantStart: () => Date.parse("2026-10-17T04:00:00Z") },
    );
    assert.equal(picks?.poll.id, "tom-early");
    assert.equal(picks?.reason, "tomorrow");
  });

  console.log("Email");
  const dayItems = async () => (await q.listItinerary(db, OWNER, T))!.length;
  await check("email unavailable: the inbox preview still arrives and the report says so", async () => {
    await wipe();
    await opt(EDITOR, { email: true });
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: null });
    assert.equal(r.inAppCreated, 2);
    assert.equal(r.emailUnavailable, 1);
    assert.equal((await ledger(EDITOR)).filter((x) => x.channel === "email").length, 0);
    assert.equal(createPreviewSender({ config: null }), null, "no provider configured → no sender");
  });
  await check("a successful email is sent once, with an idempotency key, even with concurrent workers", async () => {
    await wipe();
    const log: { to: string; key: string }[] = [];
    const runs = await Promise.all(Array.from({ length: 6 }, () => ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: sender(log) })));
    assert.equal(log.length, 1);
    assert.equal(log[0].to, "editor@example.com");
    assert.equal(log[0].key, `evening-preview:${T}:${EDITOR}:2026-10-15`);
    assert.equal(runs.reduce((a, r) => a + r.emailSent, 0), 1);
    const row = (await ledger(EDITOR)).find((x) => x.channel === "email")!;
    assert.equal(row.status, "sent");
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:30"), email: sender(log) });
    assert.equal(log.length, 1, "a rerun does not email again");
  });
  await check("a failing provider is retried a bounded number of times, then given up on", async () => {
    await wipe();
    const log: { to: string; key: string }[] = [];
    const failing = sender(log, () => "failed");
    for (let i = 0; i < 6; i++) await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: failing });
    assert.equal(log.length, 3, "MAX_EMAIL_ATTEMPTS");
    assert.ok(new Set(log.map((l) => l.key)).size === 1, "every attempt carries the same key");
    const row = (await ledger(EDITOR)).find((x) => x.channel === "email")!;
    assert.equal(row.status, "skipped");
    assert.equal(row.reason, "provider_failed");
    assert.equal((await inbox(EDITOR)).length, 1, "the inbox preview is unaffected");
  });
  await check("a failure followed by success delivers once", async () => {
    await wipe();
    const log: { to: string; key: string }[] = [];
    let n1 = 0;
    const flaky = sender(log, () => (++n1 === 1 ? "failed" : "sent"));
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: flaky });
    assert.equal((await ledger(EDITOR)).find((x) => x.channel === "email")!.status, "failed");
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:20"), email: flaky });
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:35"), email: flaky });
    assert.equal(log.length, 2);
    assert.equal((await ledger(EDITOR)).find((x) => x.channel === "email")!.status, "sent");
  });
  await check("a crashed worker's claim is retried only after its lease expires", async () => {
    await wipe();
    const log: { to: string; key: string }[] = [];
    await db.execute(sql`insert into evening_preview_deliveries (trip_id, owner_id, user_id, target_date, channel, status, attempts, locked_until) values (${T}, ${OWNER}, ${EDITOR}, '2026-10-15', 'email', 'sending', 1, now() + interval '4 minutes')`);
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: sender(log) });
    assert.equal(log.length, 0, "another worker still holds it");
    await db.execute(sql`update evening_preview_deliveries set locked_until = now() - interval '1 minute' where user_id = ${EDITOR} and channel = 'email'`);
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:10"), email: sender(log) });
    assert.equal(log.length, 1);
    assert.equal((await ledger(EDITOR)).find((x) => x.channel === "email")!.attempts, 2);
  });
  await check("email respects a withdrawn opt-in and a missing address; stale email is never retried late", async () => {
    await wipe();
    const log: { to: string; key: string }[] = [];
    await db.execute(sql`update user_profiles set email = null where user_id = ${EDITOR}`);
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: sender(log) });
    assert.equal(log.length, 0);
    assert.equal((await ledger(EDITOR)).find((x) => x.channel === "email")!.reason, "no_address");
    await db.execute(sql`update user_profiles set email = 'editor@example.com' where user_id = ${EDITOR}`);
    await wipe();
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), email: sender(log, () => "failed") });
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "23:30"), email: sender(log) }); // far too late
    assert.equal(log.length, 1);
    assert.equal((await ledger(EDITOR)).find((x) => x.channel === "email")!.reason, "stale");
    await opt(EDITOR);
  });

  console.log("Dry run, scheduler status and safety");
  await check("a dry run composes the output but writes and sends nothing", async () => {
    await wipe();
    const log: { to: string; key: string }[] = [];
    await opt(EDITOR, { email: true });
    const items = await dayItems();
    const r = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), dryRun: true, email: sender(log) });
    assert.equal(r.dryRun, true);
    assert.ok(r.items.length >= 1);
    assert.match(r.items[0].body, /Thu, Oct 15|Tomorrow/);
    assert.equal(log.length, 0);
    assert.equal((await ledger(EDITOR)).length, 0);
    assert.equal((await inbox(EDITOR)).length, 0);
    assert.equal(await dayItems(), items);
    const narrow = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), dryRun: true, only: { tripId: T, userId: VIEWER } });
    assert.deepEqual(narrow.items.map((i) => i.userId), [VIEWER]);
    await opt(EDITOR);
  });
  await check("the scheduler is only reported active after a real run", async () => {
    await db.execute(sql`delete from scheduler_heartbeats where job = ${ev.JOB_NAME}`);
    assert.equal((await ev.schedulerStatus(db)).active, false);
    await ev.runEveningPreviews(db, { now: at("2026-10-12", "10:00"), dryRun: true });
    assert.equal((await ev.schedulerStatus(db)).active, false, "a dry run doesn't count");
    await ev.runEveningPreviews(db, { now: at("2026-10-12", "10:00") });
    assert.equal((await ev.schedulerStatus(db)).active, true);
    assert.equal((await ev.schedulerStatus(db, new Date(Date.now() + 3 * 3600_000))).active, false, "stale heartbeat");
  });
  await check("a person's preference is theirs: one member's row never affects another's", async () => {
    await opt(VIEWER, { send_time: "21:00" });
    assert.equal((await ev.getPrefs(db, T, EDITOR)).send_time, "19:00");
    assert.equal((await ev.getPrefs(db, T, VIEWER)).send_time, "21:00");
    assert.deepEqual(await ev.getPrefs(db, T, STRANGER), ev.DEFAULT_PREFS);
  });
  await check("deleting the trip removes preferences and the ledger", async () => {
    const { id: t2 } = await q.createTrip(db, OWNER, tripInput);
    createdTrips.push(t2);
    await ev.savePrefs(db, OWNER, t2, OWNER, { enabled: true, send_time: "19:00", in_app: true, email: false });
    await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05"), only: { tripId: t2 } });
    assert.equal(await q.deleteTrip(db, OWNER, t2), true);
    assert.equal((await db.execute(sql`select 1 from evening_preview_prefs where trip_id = ${t2} union all select 1 from evening_preview_deliveries where trip_id = ${t2}`)).rows.length, 0);
  });
  console.log("Account Settings gate");
  await check("with evening previews off in Settings nothing is claimed or recorded; switching back on within the window still delivers", async () => {
    await wipe();
    await opt(EDITOR);
    await st.saveSection(db, EDITOR, "notifications", { evening_preview: false });
    const off = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:05") });
    assert.equal(off.skippedSettingsOff, 1);
    assert.equal(off.due, 0);
    assert.equal((await inbox(EDITOR)).length, 0);
    assert.equal((await ledger(EDITOR)).length, 0, "no ledger row, so nothing is marked as sent or skipped");
    await st.saveSection(db, EDITOR, "notifications", { evening_preview: true });
    const on = await ev.runEveningPreviews(db, { now: at("2026-10-14", "19:20") });
    assert.equal(on.skippedSettingsOff, 0);
    assert.equal((await inbox(EDITOR)).length, 1);
    await db.execute(sql`delete from user_settings where user_id = ${EDITOR}`);
    await wipe();
  });
  void composePreview;

  // cleanup
  await db.delete(trips).where(sql`${trips.id} in (${sql.join(createdTrips.map((x) => sql`${x}`), sql`, `)})`);
  const users = [OWNER, EDITOR, VIEWER, STRANGER];
  await db.execute(sql`delete from notifications where recipient_id in (${sql.join(users.map((u) => sql`${u}`), sql`, `)})`);
  await db.execute(sql`delete from user_settings where user_id in (${sql.join(users.map((u) => sql`${u}`), sql`, `)})`);
  await db.execute(sql`delete from user_profiles where user_id in (${sql.join(users.map((u) => sql`${u}`), sql`, `)})`);
  await db.execute(sql`delete from scheduler_heartbeats where job = ${ev.JOB_NAME}`);
  console.log(`\n${passed} checks passed; test records removed.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
