/**
 * Saved itinerary plan checks (the Aruba family plan + the preview diff).
 * No database needed:
 *
 *   npm run test:plan
 *
 * Covers the schedule's shape (days, anchors, rest windows, buffers), and
 * the matching rules: re-running finds nothing to do, hand edits and
 * completed visits become conflicts, earlier versions update, nothing is
 * duplicated. The database half (locking, tokens, owners) is in test:authz.
 */
import assert from "node:assert/strict";
import { ARUBA_2026 } from "../src/lib/plans/aruba-2026";
import {
  fingerprint,
  mergeNotes,
  normalizeTitle,
  planPreview,
  planValues,
  previewToken,
  sourceKey,
  type PlanItem,
  type PlanReservation,
  type PlanRow,
  type PlanTrip,
} from "../src/lib/plans/itinerary-plan";
import { buildAgenda, findOverlapDetails, splitDay } from "../src/lib/schedule";
import type { ItineraryEntry, Reservation } from "../src/lib/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const plan = ARUBA_2026;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const on = (date: string) => plan.items.filter((i) => i.date === date);
const byKey = (key: string) => plan.items.find((i) => i.key === key)!;
const DAYS = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"];

const trip: PlanTrip = {
  id: "t",
  title: "Aruba, Here we come",
  destination: "Aruba",
  start_date: "2026-10-14",
  end_date: "2026-10-19",
  time_zone: "America/Aruba",
  travelers: ["Nitin", "Pavani", "Arjun"],
};

const flightIn: PlanReservation = {
  id: "fin", kind: "flight", status: "confirmed", title: "Newark to Aruba", provider: "United Airlines",
  start_date: "2026-10-14", start_time: "10:34:00", start_time_zone: "America/New_York",
  end_date: "2026-10-14", end_time: "15:20:00", end_time_zone: "America/Aruba",
  origin: "EWR", destination: "AUA", location: null, updated_at: "1",
};
const flightOut: PlanReservation = {
  ...flightIn, id: "fout", title: "Aruba to Newark", start_date: "2026-10-19", start_time: "15:10:00",
  start_time_zone: "America/Aruba", end_date: "2026-10-19", end_time: "20:02:00", end_time_zone: "America/New_York",
  origin: "AUA", destination: "EWR",
};
const stay: PlanReservation = {
  ...flightIn, id: "stay", kind: "lodging", title: "Home in Noord", provider: "Airbnb",
  start_date: "2026-10-14", start_time: "16:00:00", start_time_zone: "America/Aruba",
  end_date: "2026-10-19", end_time: "10:00:00", end_time_zone: "America/Aruba", origin: null, destination: null,
  location: "Noord, Aruba",
};
const bookings = [flightIn, flightOut, stay];

let seq = 0;
const row = (over: Partial<PlanRow>): PlanRow => ({
  id: `row-${++seq}`, place_id: null, reservation_id: null, title: "Something", category: "activity",
  local_date: "2026-10-15", local_start_time: null, local_end_date: null, local_end_time: null,
  timezone: "America/Aruba", planning_notes: null, status: "planned", rating: null, reflection: null,
  is_favorite: false, is_optional: false, is_protected_rest: false, source_key: null, source_fingerprint: null,
  updated_at: "1", ...over,
});

/** The rows an apply of the current plan would leave behind. */
const appliedRows = () =>
  plan.items.map((item) => {
    const values = planValues(plan, item);
    return row({ ...values, source_key: sourceKey(plan, item), source_fingerprint: fingerprint(values) });
  });

const preview = (rows: PlanRow[], over: Partial<Parameters<typeof planPreview>[0]> = {}) =>
  planPreview({ plan, trip, rows, places: [], reservations: bookings, ...over });

console.log("The Aruba schedule");
check("six days map to October 14–19, each with a theme", () => {
  assert.deepEqual(plan.days.map((d) => d.date), DAYS);
  assert.equal(plan.startDate, DAYS[0]);
  assert.equal(plan.endDate, DAYS[5]);
  for (const item of plan.items) assert.ok(DAYS.includes(item.date), item.key);
  assert.equal(plan.timeZone, "America/Aruba");
});
check("flight anchors: arrive 15:20 on Oct 14, depart 15:10 on Oct 19 — from bookings, not plan entries", () => {
  assert.deepEqual(plan.anchors.map((a) => [a.kind, a.date, a.time]), [
    ["arrival", "2026-10-14", "15:20"],
    ["departure", "2026-10-19", "15:10"],
  ]);
  assert.ok(!plan.items.some((i) => /flight (arrives|departs)/i.test(i.title)), "no duplicate flight entries");
});
check("keys are unique and every value fits the database limits", () => {
  assert.equal(new Set(plan.items.map((i) => i.key)).size, plan.items.length);
  for (const i of plan.items) {
    assert.ok(i.title.length <= 160 && sourceKey(plan, i).length <= 120, i.key);
    assert.ok((i.notes ?? "").length <= 5000);
    if (i.start && i.end) assert.ok(minutes(i.end) > minutes(i.start), `${i.key} ends after it starts`);
    if (!i.start) assert.equal(i.end, null, `${i.key}: no end without a start`);
  }
});
check("arrival day: processing from 15:20, then rental pickup with car seat, then check-in", () => {
  const d1 = on("2026-10-14");
  assert.equal(byKey("d1-arrival-processing").start, "15:20");
  assert.match(byKey("d1-rental-pickup").title, /rental car.*car seat/i);
  assert.ok(minutes(byKey("d1-rental-pickup").start!) >= minutes(byKey("d1-arrival-processing").end!));
  assert.ok(d1.every((i) => !i.start || minutes(i.start) >= minutes("15:20")), "nothing before landing");
  assert.ok(!d1.some((i) => /nap/i.test(i.title)), "no fixed nap");
  assert.ok(!d1.some((i) => /sunset/i.test(i.title)), "no required sunset outing");
  assert.ok(byKey("d1-walk").optional && byKey("d1-walk").start === null);
});
check("Baby Beach has about an hour of driving buffer each way", () => {
  const out = byKey("d2-drive-baby-beach");
  const back = byKey("d2-return");
  assert.ok(minutes(out.end!) - minutes(out.start!) >= 60);
  assert.ok(minutes(back.end!) - minutes(back.start!) >= 60);
  assert.equal(back.start, byKey("d2-baby-beach").end);
});
check("days 2–5 protect 12:00–15:00 and nothing else is scheduled inside it", () => {
  for (const date of DAYS.slice(1, 5)) {
    const rest = on(date).filter((i) => i.protectedRest);
    assert.equal(rest.length, 1, date);
    assert.deepEqual([rest[0].start, rest[0].end, rest[0].category], ["12:00", "15:00", "rest"]);
    for (const i of on(date)) {
      if (i.protectedRest || !i.start) continue;
      const end = i.end ? minutes(i.end) : minutes(i.start);
      assert.ok(end <= 720 || minutes(i.start) >= 900, `${i.key} stays out of the rest window`);
    }
  }
  assert.ok(!on("2026-10-14").some((i) => i.protectedRest) && !on("2026-10-19").some((i) => i.protectedRest));
});
check("departure day: rental returned before the 12:10 terminal target; airport steps open-ended", () => {
  const ret = byKey("d6-rental-return");
  const terminal = byKey("d6-terminal");
  assert.equal(terminal.start, "12:10");
  assert.ok(minutes(ret.end!) <= minutes(terminal.start!));
  assert.equal(byKey("d6-formalities").end, null);
  assert.match(byKey("d6-formalities").notes!, /duration varies/i);
  assert.equal(byKey("d6-airport-rest").start, null, "no guaranteed airport nap window");
  // Three hours before the 15:10 departure.
  assert.equal(minutes("15:10") - minutes(terminal.start!), 180);
  assert.ok(!on("2026-10-19").some((i) => /nap/i.test(i.title)), "no departure-day accommodation nap");
});
check("optional activities are flagged; Day 5 animals stays a single undecided choice", () => {
  const optional = plan.items.filter((i) => i.optional).map((i) => i.key);
  assert.deepEqual(optional, ["d1-walk", "d2-pool", "d3-pool", "d4-pool", "d6-quiet"]);
  assert.equal(on("2026-10-18").filter((i) => /donkey|philip/i.test(i.title)).length, 1);
});
check("nothing claims a booking: no restaurants, tickets, rental companies or confirmation numbers", () => {
  const text = plan.items.map((i) => `${i.title} ${i.notes ?? ""}`).join(" ");
  assert.doesNotMatch(text, /confirmation|booked|reserved|hertz|avis|budget|gate \d|terminal [a-z]\b/i);
});

console.log("Preview");
check("empty itinerary: every entry is an addition, no conflicts, checks pass", () => {
  const p = preview([]);
  assert.equal(p.blocked, false);
  assert.equal(p.counts.add, plan.items.length);
  assert.equal(p.counts.conflict, 0);
  assert.ok(p.notices.some((n) => n.level === "ok" && /Arrival flight matches/.test(n.title)));
  assert.ok(p.notices.some((n) => n.level === "ok" && /Departure flight matches/.test(n.title)));
});
check("the saved stay's earlier check-out and the missing rental car are flagged, not changed", () => {
  const p = preview([]);
  assert.ok(p.notices.some((n) => n.level === "warning" && /check-out is 10:00/.test(n.title)));
  assert.ok(p.notices.some((n) => /No rental car booking/.test(n.title)));
  assert.ok(p.notices.some((n) => /Home in Noord/.test(n.title)), "uses the saved stay by name");
});
check("a saved flight time that differs from the confirmed one is a warning", () => {
  const p = preview([], { reservations: [{ ...flightIn, end_time: "14:55:00" }, flightOut, stay] });
  assert.ok(p.notices.some((n) => n.level === "warning" && /saved 14:55, confirmed 15:20/.test(n.title)));
});
check("a New York-labelled AUA time with the same clock is information, not an error", () => {
  const p = preview([], { reservations: [{ ...flightIn, end_time_zone: "America/New_York" }, flightOut, stay] });
  assert.ok(p.notices.some((n) => n.level === "info" && /saved in America\/New_York/.test(n.title)));
});
check("trip dates that differ block the apply (flagged, never changed)", () => {
  const p = preview([], { trip: { ...trip, end_date: "2026-10-20" } });
  assert.equal(p.blocked, true);
  assert.ok(p.notices.some((n) => n.level === "blocker" && /Trip dates differ/.test(n.title)));
});
check("the trip zone differing offers an opt-in switch", () => {
  const p = preview([], { trip: { ...trip, time_zone: "America/New_York" } });
  assert.deepEqual(p.zoneOption, { current: "America/New_York", planned: "America/Aruba", sameClock: true });
  assert.equal(preview([]).zoneOption, null);
});
check("re-running after an apply finds nothing to do (no second copy)", () => {
  const rows = appliedRows();
  const p = preview(rows);
  assert.equal(p.counts.unchanged, plan.items.length);
  assert.equal(p.counts.add + p.counts.update + p.counts.conflict + p.counts.remove, 0);
  assert.equal(previewToken(p, rows, trip, bookings), previewToken(preview(rows), rows, trip, bookings));
});
check("a hand-edited plan entry is a conflict, never silently overwritten", () => {
  const rows = appliedRows();
  const i = rows.findIndex((r) => r.source_key === "aruba-2026:d3-eagle");
  rows[i] = { ...rows[i], local_start_time: "10:45:00" };
  const p = preview(rows);
  const c = p.ops.find((o) => o.kind === "conflict");
  assert.ok(c && c.kind === "conflict" && c.reason === "edited" && c.changes.includes("time"));
  assert.equal(p.counts.conflict, 1);
});
check("the traveler's added notes are kept: no conflict, and merging appends rather than replaces", () => {
  const rows = appliedRows();
  const i = rows.findIndex((r) => r.source_key === "aruba-2026:d2-baby-beach");
  rows[i] = { ...rows[i], planning_notes: `${rows[i].planning_notes}\n\nBring the pop-up tent.` };
  assert.equal(preview(rows).counts.unchanged, plan.items.length, "plan text is still in there");
  assert.equal(mergeNotes("Bring the tent.", "Plan text."), "Bring the tent.\n\nPlan text.");
  assert.equal(mergeNotes("Bring the tent.\n\nPlan text.", "Plan text."), "Bring the tent.\n\nPlan text.");
  assert.equal(mergeNotes("Mine", null), "Mine");
});
check("a completed visit with a reflection is kept as done; a plan change to it is a conflict", () => {
  const rows = appliedRows();
  const i = rows.findIndex((r) => r.source_key === "aruba-2026:d3-butterfly");
  rows[i] = { ...rows[i], status: "completed", rating: 5, reflection: "Arjun loved it" };
  const same = preview(rows).ops.find((o) => "rowId" in o && o.rowId === rows[i].id);
  assert.ok(same?.kind === "unchanged" && same.kept.includes("done") && same.kept.includes("reflection"));
  // Simulate an older plan having written a different time.
  const old = { ...planValues(plan, byKey("d3-butterfly")), local_start_time: "09:30:00" };
  rows[i] = { ...rows[i], ...old, source_fingerprint: fingerprint(old) };
  const changed = preview(rows).ops.find((o) => "rowId" in o && o.rowId === rows[i].id);
  assert.ok(changed?.kind === "conflict" && changed.reason === "reviewed");
});
check("an untouched entry from an earlier plan version is updated in place", () => {
  const rows = appliedRows();
  const i = rows.findIndex((r) => r.source_key === "aruba-2026:d2-return");
  const old = { ...planValues(plan, byKey("d2-return")), local_end_time: "11:30:00", planning_notes: "30 minutes back." };
  rows[i] = { ...rows[i], ...old, source_fingerprint: fingerprint(old) };
  const op = preview(rows).ops.find((o) => "rowId" in o && o.rowId === rows[i].id);
  assert.ok(op?.kind === "update" && op.changes.includes("time") && op.changes.includes("notes"));
});
check("an identical entry added by hand is linked, not duplicated; a different one is a conflict", () => {
  const same = row({ ...planValues(plan, byKey("d4-arashi")) });
  const p1 = preview([same]);
  assert.equal(p1.ops.find((o) => "rowId" in o && o.rowId === same.id)?.kind, "link");
  assert.equal(p1.counts.add, plan.items.length - 1);
  const mine = row({ title: "Arashi Beach", local_date: "2026-10-17", local_start_time: "09:00:00", planning_notes: "Snorkel" });
  const p2 = preview([mine]);
  const c = p2.ops.find((o) => o.kind === "conflict");
  assert.ok(c?.kind === "conflict" && c.reason === "match" && c.item?.key === "d4-arashi");
  assert.equal(p2.counts.add, plan.items.length - 1, "the plan entry isn't added on top of yours");
});
check("unrelated entries are left alone; outdated noon-arrival / nap / sunset entries need a choice", () => {
  const dinner = row({ title: "Dinner at a friend's", local_date: "2026-10-16", local_start_time: "18:00:00" });
  const noon = row({ title: "Arrive & check in", local_date: "2026-10-14", local_start_time: "12:00:00" });
  const nap = row({ title: "Nap at the accommodation", local_date: "2026-10-14", local_start_time: "15:00:00", category: "rest" });
  const sunset = row({ title: "Palm Beach sunset", local_date: "2026-10-14", local_start_time: "17:00:00" });
  const leaveNap = row({ title: "Nap before the airport", local_date: "2026-10-19", local_start_time: "12:00:00" });
  const p = preview([dinner, noon, nap, sunset, leaveNap]);
  assert.ok(!p.ops.some((o) => "rowId" in o && o.rowId === dinner.id), "unrelated entry untouched");
  const retire = p.ops.filter((o) => o.kind === "conflict" && o.reason === "retire").map((o) => (o as { rowId: string }).rowId);
  assert.deepEqual(retire.sort(), [noon.id, nap.id, sunset.id, leaveNap.id].sort());
  assert.equal(p.counts.remove, 0, "never removed without the traveler's choice");
});
check("a plan entry later versions dropped is removed only if nobody touched it", () => {
  const values = { ...planValues(plan, byKey("d1-walk")), title: "Old sunset walk", local_start_time: "17:00:00" };
  const gone = row({ ...values, source_key: "aruba-2026:d1-old-sunset", source_fingerprint: fingerprint(values) });
  assert.equal(preview([gone]).ops.find((o) => "rowId" in o && o.rowId === gone.id)?.kind, "remove");
  const reviewed = { ...gone, id: "rv", status: "completed" as const };
  assert.equal(preview([reviewed]).ops.find((o) => "rowId" in o && o.rowId === "rv")?.kind, "conflict");
});
check("Explore places are linked only on one exact name match; none are created", () => {
  const one = preview([], { places: [{ id: "p1", name: "Baby Beach" }] });
  const add = one.ops.find((o) => o.kind === "add" && o.item.key === "d2-baby-beach");
  assert.ok(add?.kind === "add" && add.placeName === "Baby Beach");
  const two = preview([], { places: [{ id: "p1", name: "Baby Beach" }, { id: "p2", name: "baby beach" }] });
  const ambiguous = two.ops.find((o) => o.kind === "add" && o.item.key === "d2-baby-beach");
  assert.ok(ambiguous?.kind === "add" && ambiguous.placeName === null);
});
check("title normalization ignores case, accents, punctuation and “&”", () => {
  assert.equal(normalizeTitle("Lunch, baby nap & parents’ rest"), normalizeTitle("lunch baby nap and parents rest"));
  assert.equal(normalizeTitle("Philip’s Animal Garden"), normalizeTitle("Philips animal garden"));
});

console.log("Timeline");
const asEntry = (item: PlanItem, id: string): ItineraryEntry => ({
  ...planValues(plan, item), id, trip_id: "t", owner_id: "o", place_id: null, reservation_id: null,
  sort_order: 1, status: "planned", rating: null, reflection: null, is_favorite: false, completed_at: null,
  source_key: sourceKey(plan, item), source_fingerprint: null, created_at: "x", updated_at: "x", place: null, reservation: null,
});
const asBooking = (r: PlanReservation): Reservation => ({
  ...r, trip_id: "t", owner_id: "o", confirmation_code: null, booking_url: null, notes: null, details: {}, created_at: "x",
});
const dayEntries = (date: string, extra: ItineraryEntry[] = []) =>
  splitDay(
    buildAgenda({
      items: [...on(date).map((i) => asEntry(i, i.key)), ...extra],
      reservations: bookings.map(asBooking),
      tripStart: plan.startDate,
      tripEnd: plan.endDate,
    }).days.find((d) => d.date === date)!.entries,
  ).timed;
check("landing at 15:20 (from the booking) and arrival processing from 15:20 aren't flagged as a clash", () => {
  const timed = dayEntries("2026-10-14");
  // A same-day flight is one entry; its arrival time is the booking's end.
  const flight = timed.find((e) => e.key === "r:fin");
  assert.equal(flight?.schedule.endTime, "15:20:00");
  assert.equal(timed.filter((e) => e.reservation?.kind === "flight").length, 1, "no duplicate flight");
  assert.equal(findOverlapDetails(timed).size, 0);
  // Same instant, point vs interval start: a sequence, not a clash.
  const landing = { ...asEntry(byKey("d1-arrival-processing"), "landing"), title: "Landing", local_end_time: null };
  assert.equal(findOverlapDetails(dayEntries("2026-10-14", [landing])).size, 0);
});
check("departure day: 12:10 target and open-ended formalities don't clash; flight at 15:10", () => {
  const timed = dayEntries("2026-10-19");
  assert.ok(timed.some((e) => e.key === "r:fout" && e.time === "15:10:00"));
  assert.equal(findOverlapDetails(timed).size, 0);
});
check("each plan day reads cleanly (no overlaps) and an outing in the rest window is flagged gently", () => {
  for (const date of DAYS) assert.equal(findOverlapDetails(dayEntries(date)).size, 0, date);
  const outing = { ...asEntry(byKey("d3-eagle"), "outing"), source_key: null, title: "Shopping", local_start_time: "13:00:00", local_end_time: "14:00:00" };
  const clash = findOverlapDetails(dayEntries("2026-10-16", [outing])).get("i:outing");
  assert.deepEqual(clash, [{ title: "Lunch, baby nap & parents’ rest", protectedRest: true }]);
});

console.log(`\n${passed} plan checks passed.`);
