/**
 * Notifications — the pure parts, no database: destinations (open-redirect
 * safety), text hygiene, the itinerary change summary (incl. the trip's time
 * zone), Today / Yesterday / Earlier grouping, and the type registry.
 *
 *   npm run test:notification-format        (try TZ=Pacific/Kiritimati and TZ=Pacific/Pago_Pago too)
 */
import assert from "node:assert/strict";
import {
  ENABLED_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_TYPES,
  cleanText,
  dayGroupOf,
  describeItineraryChange,
  draftParts,
  effectiveTimeZone,
  groupByDay,
  isSafeInternalPath,
  resolveDestination,
  timeLabel,
  unreadBadge,
  type ItinerarySnapshot,
} from "../src/lib/notifications";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const TRIP = "0b6e5c1e-3f7a-4c63-9d55-1b2a7e9c4d10";
const ITEM = "5d2b0a52-9c1e-4e7e-8a37-6a1c2f8e9b01";

const dinner = (over: Partial<ItinerarySnapshot> = {}): ItinerarySnapshot => ({
  id: ITEM,
  title: "Dinner",
  date: "2026-10-15",
  start_time: "18:00",
  end_date: null,
  end_time: null,
  time_zone: "America/Aruba",
  place_id: null,
  place_name: null,
  reservation_backed: false,
  ...over,
});
const ARUBA = "America/Aruba";

console.log("Destinations");
check("only in-app trip / invitation / inbox paths are accepted", () => {
  for (const ok of [
    `/trips/${TRIP}`,
    `/trips/${TRIP}/itinerary`,
    `/trips/${TRIP}/itinerary?day=2026-10-15`,
    `/invitations/${ITEM}`,
    "/notifications",
  ]) {
    assert.equal(isSafeInternalPath(ok), true, ok);
  }
});
check("open-redirect and look-alike paths are refused", () => {
  const evil = [
    "https://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/login",
    "/api/auth/sign-out",
    "/trips",
    "/trips/not-a-uuid",
    `/trips/${TRIP}/../../login`,
    `/trips/${TRIP}/itinerary?day=//evil.example`,
    `/trips/${TRIP}/itinerary?day=2026-10-15&next=//evil.example`,
    `/trips/${TRIP}/settings`,
    `/invite/${"a".repeat(43)}`,
    `/notifications?next=//evil.example`,
    ` /trips/${TRIP}`,
    `/trips/${TRIP}\n`,
    "",
    null,
    undefined,
    42,
  ];
  for (const path of evil) assert.equal(isSafeInternalPath(path), false, String(path));
});
check("poll destinations are the trip's polls page, optionally one poll", () => {
  const POLL = "7a1c2f8e-9b01-4e7e-8a37-5d2b0a529c1e";
  assert.equal(isSafeInternalPath(`/trips/${TRIP}/polls`), true);
  assert.equal(isSafeInternalPath(`/trips/${TRIP}/polls?poll=${POLL}`), true);
  for (const bad of [`/trips/${TRIP}/polls?poll=//evil.example`, `/trips/${TRIP}/polls?poll=${POLL}&x=1`, `/trips/${TRIP}/polls/${POLL}`]) {
    assert.equal(isSafeInternalPath(bad), false, bad);
  }
  assert.equal(resolveDestination("poll_vote_needed", { tripId: TRIP, resourceId: POLL, metadata: {}, isMember: true }), `/trips/${TRIP}/polls?poll=${POLL}`);
  assert.equal(resolveDestination("poll_result", { tripId: TRIP, resourceId: POLL, metadata: {}, isMember: true }), `/trips/${TRIP}/polls?poll=${POLL}`);
});
check("a tampered day in metadata cannot steer the destination", () => {
  const ctx = (metadata: Record<string, string>) => ({ tripId: TRIP, resourceId: ITEM, metadata, isMember: true });
  assert.equal(resolveDestination("itinerary_changed", ctx({ date: "2026-10-15" })), `/trips/${TRIP}/itinerary?day=2026-10-15`);
  assert.equal(resolveDestination("itinerary_changed", ctx({ date: "//evil.example" })), `/trips/${TRIP}/itinerary`);
  assert.equal(resolveDestination("itinerary_changed", ctx({ date: "2026-10-15&x=1" })), `/trips/${TRIP}/itinerary`);
});
check("an invitation leads to its page until the person is on the trip, then to the trip", () => {
  assert.equal(resolveDestination("invitation_received", { tripId: TRIP, resourceId: ITEM, metadata: {}, isMember: false }), `/invitations/${ITEM}`);
  assert.equal(resolveDestination("invitation_received", { tripId: TRIP, resourceId: ITEM, metadata: {}, isMember: true }), `/trips/${TRIP}`);
  assert.equal(resolveDestination("invitation_received", { tripId: null, resourceId: null, metadata: {}, isMember: false }), null);
});
check("unknown and not-yet-enabled types have no destination", () => {
  assert.equal(resolveDestination("made_up", { tripId: TRIP, resourceId: ITEM, metadata: {}, isMember: true }), null);
  for (const t of NOTIFICATION_TYPES.filter((t) => !NOTIFICATION_KINDS[t].enabled)) {
    assert.equal(resolveDestination(t, { tripId: TRIP, resourceId: ITEM, metadata: {}, isMember: true }), null, t);
  }
});

console.log("Registry");
check("reminders are live and every type in the registry is enabled", () => {
  for (const t of Object.keys(NOTIFICATION_KINDS) as (keyof typeof NOTIFICATION_KINDS)[]) assert.equal(NOTIFICATION_KINDS[t].enabled, true, t);
  assert.deepEqual([...ENABLED_TYPES].sort(), ["evening_preview", "invitation_accepted", "invitation_received", "itinerary_changed", "poll_result", "poll_vote_needed", "reminder"]);
});
check("drafts carry ids and a day only — nothing descriptive in metadata", () => {
  const parts = draftParts({
    type: "itinerary_changed",
    recipientId: "u",
    actorId: "a",
    tripId: TRIP,
    itemId: ITEM,
    date: "2026-10-15",
    dedupeKey: "k",
    title: "t",
    body: "b",
  });
  assert.deepEqual(parts, { tripId: TRIP, resourceType: "itinerary_item", resourceId: ITEM, metadata: { date: "2026-10-15" } });
  assert.equal(draftParts({ type: "invitation_received", recipientId: "u", actorId: "a", tripId: TRIP, invitationId: ITEM, dedupeKey: "k", title: "t", body: "b" }).resourceType, "invitation");
});

console.log("Text hygiene");
check("URLs, token-like strings and control characters never reach the inbox", () => {
  const token = "Zk3dQ9vXr1Lw8TnB2yHc5uJpA7sEo4MfGqRiVxC0bNd";
  assert.equal(token.length, 43);
  const out = cleanText(`Dinner\n\u0000at https://example.com/invite/${token}?x=1 ${token}  now`, 400);
  assert.ok(!out.includes(token) && !out.includes("https://") && !/[\u0000-\u001f]/.test(out), out);
  assert.equal(out, "Dinner at a link … now");
  assert.equal(cleanText("word ".repeat(100), 120).length, 120);
  assert.equal(cleanText("   ", 10), "");
});

console.log("Itinerary change text");
check("a reschedule reads like a person wrote it, in the trip's zone", () => {
  const t = describeItineraryChange("changed", dinner(), dinner({ start_time: "18:30" }), ARUBA, "Sam");
  assert.ok(t);
  assert.equal(t.title, "Itinerary updated");
  assert.equal(t.body, "Dinner moved from 6:00 PM to 6:30 PM. — Sam");
  assert.equal(t.date, "2026-10-15");
});
check("moving to another day names both days", () => {
  const t = describeItineraryChange("changed", dinner(), dinner({ date: "2026-10-16" }), ARUBA, "Sam");
  assert.equal(t?.body, "Dinner moved from Thu, Oct 15 at 6:00 PM to Fri, Oct 16 at 6:00 PM. — Sam");
  assert.equal(t?.date, "2026-10-16");
});
check("adding or removing a start time, and end-time changes", () => {
  assert.equal(describeItineraryChange("changed", dinner({ start_time: null }), dinner(), ARUBA, "Sam")?.body, "Dinner now starts at 6:00 PM. — Sam");
  assert.equal(describeItineraryChange("changed", dinner(), dinner({ start_time: null }), ARUBA, "Sam")?.body, "Dinner no longer has a set start time. — Sam");
  assert.equal(describeItineraryChange("changed", dinner(), dinner({ end_time: "20:00" }), ARUBA, "Sam")?.body, "Dinner now ends at 8:00 PM. — Sam");
  assert.equal(describeItineraryChange("changed", dinner({ end_time: "20:00" }), dinner(), ARUBA, "Sam")?.body, "Dinner no longer has an end time. — Sam");
});
check("an entry in another zone is shown in the trip's zone", () => {
  // 20:00 → 20:30 in Paris (CEST, UTC+2) is 14:00 → 14:30 in Aruba (UTC-4).
  const t = describeItineraryChange("changed", dinner({ time_zone: "Europe/Paris", start_time: "20:00" }), dinner({ time_zone: "Europe/Paris", start_time: "20:30" }), ARUBA, "Sam");
  assert.equal(t?.body, "Dinner moved from 2:00 PM to 2:30 PM. — Sam");
  // Crossing midnight changes the day too: 02:00 Paris on the 16th is 20:00 Aruba on the 15th.
  const added = describeItineraryChange("added", null, dinner({ time_zone: "Europe/Paris", date: "2026-10-16", start_time: "02:00" }), ARUBA, "Sam");
  assert.equal(added?.body, "Sam added Dinner for Thu, Oct 15 at 8:00 PM.");
  assert.equal(added?.date, "2026-10-15");
});
check("a place change is a location change — names only", () => {
  const a = dinner({ place_id: "p1", place_name: "Zeerovers" });
  const b = dinner({ place_id: "p2", place_name: "Wilhelmina's" });
  assert.equal(describeItineraryChange("changed", a, b, ARUBA, "Sam")?.body, "Dinner location changed from Zeerovers to Wilhelmina's. — Sam");
  assert.equal(describeItineraryChange("changed", dinner(), b, ARUBA, "Sam")?.body, "Dinner now has a location: Wilhelmina's. — Sam");
  assert.equal(describeItineraryChange("changed", a, dinner(), ARUBA, "Sam")?.body, "Dinner location removed (was Zeerovers). — Sam");
  const both = describeItineraryChange("changed", a, { ...b, start_time: "19:00" }, ARUBA, "Sam");
  assert.equal(both?.body, "Dinner moved from 6:00 PM to 7:00 PM. Dinner location changed from Zeerovers to Wilhelmina's. — Sam");
});
check("added and removed", () => {
  assert.equal(describeItineraryChange("added", null, dinner(), ARUBA, "Sam")?.body, "Sam added Dinner for Thu, Oct 15 at 6:00 PM.");
  assert.equal(describeItineraryChange("added", null, dinner({ start_time: null }), ARUBA, "Sam")?.body, "Sam added Dinner for Thu, Oct 15.");
  assert.equal(describeItineraryChange("removed", dinner(), null, ARUBA, "Sam")?.body, "Sam removed Dinner (Thu, Oct 15 at 6:00 PM).");
});
check("edits that aren't schedule or place changes say nothing; bookings are never announced", () => {
  assert.equal(describeItineraryChange("changed", dinner(), dinner({ title: "Family dinner" }), ARUBA, "Sam"), null);
  assert.equal(describeItineraryChange("changed", dinner(), dinner(), ARUBA, "Sam"), null);
  const booked = dinner({ reservation_backed: true });
  assert.equal(describeItineraryChange("changed", booked, { ...booked, start_time: "19:00" }, ARUBA, "Sam"), null);
  assert.equal(describeItineraryChange("added", null, booked, ARUBA, "Sam"), null);
  assert.equal(describeItineraryChange("removed", booked, null, ARUBA, "Sam"), null);
});
check("a hostile title or name is cleaned before it is stored", () => {
  const t = describeItineraryChange("added", null, dinner({ title: "Dinner https://evil.example/x" }), ARUBA, "Sam\nthe‮ Mover");
  assert.ok(t && !t.body.includes("evil.example") && !t.body.includes("\n") && !t.body.includes("‮"), t?.body);
});

console.log("Grouping by day");
check("Today / Yesterday / Earlier follow the viewer's zone", () => {
  const now = new Date("2026-10-07T03:30:00Z"); // 11:30 PM Oct 6 in New York, 12:30 PM Oct 7 in Tokyo
  const at = (iso: string) => new Date(iso).toISOString();
  assert.equal(dayGroupOf(at("2026-10-07T01:00:00Z"), now, "America/New_York"), "Today"); // 9 PM Oct 6
  assert.equal(dayGroupOf(at("2026-10-06T20:00:00Z"), now, "America/New_York"), "Today");
  assert.equal(dayGroupOf(at("2026-10-05T20:00:00Z"), now, "America/New_York"), "Yesterday");
  assert.equal(dayGroupOf(at("2026-10-04T20:00:00Z"), now, "America/New_York"), "Earlier");
  assert.equal(dayGroupOf(at("2026-10-07T01:00:00Z"), now, "Asia/Tokyo"), "Today"); // 10 AM Oct 7
  assert.equal(dayGroupOf(at("2026-10-06T10:00:00Z"), now, "Asia/Tokyo"), "Yesterday");
  assert.equal(dayGroupOf("not a date", now, "UTC"), "Earlier");
});
check("month and year boundaries, extreme zones", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  assert.equal(dayGroupOf("2026-02-28T15:00:00Z", now, "UTC"), "Yesterday");
  assert.equal(dayGroupOf("2025-12-31T23:00:00Z", new Date("2026-01-01T05:00:00Z"), "UTC"), "Yesterday");
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const n = new Date("2026-10-07T12:00:00Z");
    assert.equal(dayGroupOf(n.toISOString(), n, zone), "Today", zone);
    assert.equal(dayGroupOf(new Date(n.getTime() - 24 * 3600_000).toISOString(), n, zone), "Yesterday", zone);
  }
});
check("groups keep order and merge neighbours", () => {
  const now = new Date("2026-10-07T18:00:00Z");
  const items = [
    { id: 1, created_at: "2026-10-07T17:00:00Z" },
    { id: 2, created_at: "2026-10-07T09:00:00Z" },
    { id: 3, created_at: "2026-10-06T09:00:00Z" },
    { id: 4, created_at: "2026-09-01T09:00:00Z" },
  ];
  const groups = groupByDay(items, now, "UTC");
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [["Today", [1, 2]], ["Yesterday", [3]], ["Earlier", [4]]]);
});
check("labels: a clock time for today / yesterday, a date for older", () => {
  const now = new Date("2026-10-07T18:00:00Z");
  assert.equal(timeLabel("2026-10-07T17:05:00Z", now, "UTC"), "5:05 PM");
  assert.equal(timeLabel("2026-09-01T09:00:00Z", now, "UTC"), "Sep 1");
});
check("fallback zone: configured, else the browser's, else UTC", () => {
  assert.equal(effectiveTimeZone("Asia/Tokyo", "America/New_York"), "Asia/Tokyo");
  assert.equal(effectiveTimeZone(null, "America/New_York"), "America/New_York");
  assert.equal(effectiveTimeZone("Not/AZone", "Also/Bad"), "UTC");
  assert.equal(effectiveTimeZone(undefined, undefined), "UTC");
});
check("the badge caps at 99+", () => {
  assert.equal(unreadBadge(3), "3");
  assert.equal(unreadBadge(99), "99");
  assert.equal(unreadBadge(100), "99+");
});

console.log(`\n${passed} checks passed.`);
