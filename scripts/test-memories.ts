/**
 * Pure Memories logic checks — trip phase, derived counts, day grouping,
 * favorites, "Capture a moment" candidates and the Memories schemas.
 * No database needed:
 *
 *   npm run test:memories
 *
 * Run it under different process zones (TZ=Pacific/Kiritimati,
 * TZ=Pacific/Pago_Pago) to prove nothing depends on the machine's zone.
 */
import assert from "node:assert/strict";
import {
  captureCandidates,
  favoriteVisits,
  groupVisitsByDay,
  journalPhase,
  memoryStats,
  visitDate,
} from "../src/lib/memories";
import { captureMomentSchema, tripAlbumSchema, tripSummarySchema } from "../src/lib/validation";
import type { ItineraryEntry, PlaceSummary, Reservation } from "../src/lib/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const booking = (over: Partial<Reservation>): Reservation => ({
  id: "r",
  trip_id: "t",
  owner_id: "o",
  kind: "activity",
  status: "confirmed",
  title: "Booking",
  provider: null,
  confirmation_code: null,
  start_date: "2026-10-14",
  start_time: null,
  start_time_zone: "America/Aruba",
  end_date: null,
  end_time: null,
  end_time_zone: "America/Aruba",
  origin: null,
  destination: null,
  location: null,
  booking_url: null,
  notes: null,
  details: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const place = (id: string, kind: "place" | "food"): PlaceSummary => ({
  id,
  name: `Place ${id}`,
  kind,
  category: kind === "food" ? "restaurant" : "beach",
  priority: "maybe",
  address: null,
  maps_url: null,
  website_url: null,
});

const visit = (over: Partial<ItineraryEntry>): ItineraryEntry => ({
  id: "i",
  trip_id: "t",
  owner_id: "o",
  place_id: null,
  reservation_id: null,
  title: "Activity",
  category: "activity",
  local_date: "2026-10-14",
  local_start_time: null,
  local_end_date: null,
  local_end_time: null,
  timezone: "America/Aruba",
  sort_order: 1,
  status: "completed",
  planning_notes: null,
  rating: null,
  reflection: null,
  is_favorite: false,
  completed_at: "2026-10-14T20:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  place: null,
  reservation: null,
  ...over,
});

const START = "2026-10-14";
const END = "2026-10-19";

console.log(`Process TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

check("phase: before / during (first and last day) / after", () => {
  assert.equal(journalPhase(START, END, "2026-10-13"), "before");
  assert.equal(journalPhase(START, END, START), "during");
  assert.equal(journalPhase(START, END, END), "during");
  assert.equal(journalPhase(START, END, "2026-10-20"), "after");
});

check("counts: activities vs distinct places vs distinct food places", () => {
  const visits = [
    visit({ id: "1", place_id: "beach", place: place("beach", "place") }),
    visit({ id: "2", place_id: "beach", place: place("beach", "place") }), // repeat visit
    visit({ id: "3", place_id: "cafe", place: place("cafe", "food") }),
    visit({ id: "4", place_id: "cafe", place: place("cafe", "food") }), // repeat meal
    visit({ id: "5", place_id: "grill", place: place("grill", "food") }),
    visit({ id: "6" }), // standalone activity: not a place
    visit({ id: "7", reservation_id: "r", reservation: booking({}), local_date: null, timezone: null }),
    visit({ id: "8", status: "planned", place_id: "museum", place: place("museum", "place") }), // not done
    visit({ id: "9", status: "skipped", place_id: "zoo", place: place("zoo", "place") }), // not done
  ];
  assert.deepEqual(memoryStats(visits), { completed: 7, places: 3, food: 2 });
  assert.deepEqual(memoryStats([]), { completed: 0, places: 0, food: 0 });
});

check("grouping: chronological days, repeat visits kept separate, outside / undated last", () => {
  const visits = [
    visit({ id: "a", local_date: "2026-10-16", place_id: "p", place: place("p", "place") }),
    visit({ id: "b", local_date: "2026-10-14" }),
    visit({ id: "c", local_date: "2026-10-16", place_id: "p", place: place("p", "place") }),
    visit({ id: "d", local_date: "2026-10-22" }), // trip was shortened
    visit({ id: "e", reservation_id: "r", reservation: booking({ start_date: null }), local_date: null, timezone: null }),
    visit({ id: "f", local_date: "2026-10-15", status: "planned" }), // not a memory
  ];
  const days = groupVisitsByDay(visits, START, END);
  assert.deepEqual(
    days.map((d) => [d.date, d.dayNumber, d.visits.map((v) => v.id)]),
    [
      ["2026-10-14", 1, ["b"]],
      ["2026-10-16", 3, ["a", "c"]],
      ["2026-10-22", null, ["d"]],
      [null, null, ["e"]],
    ],
  );
  assert.deepEqual(groupVisitsByDay([], START, END), []);
});

check("grouping across a month / year boundary keeps day numbers", () => {
  const days = groupVisitsByDay(
    [visit({ id: "x", local_date: "2027-01-02" }), visit({ id: "y", local_date: "2026-12-31" })],
    "2026-12-30",
    "2027-01-03",
  );
  assert.deepEqual(days.map((d) => [d.date, d.dayNumber]), [["2026-12-31", 2], ["2027-01-02", 4]]);
});

check("a booking-backed visit is dated by its booking (overnight flight: departure day)", () => {
  const flight = booking({
    kind: "flight",
    start_date: "2026-10-18",
    start_time: "23:30:00",
    start_time_zone: "America/Aruba",
    end_date: "2026-10-19",
    end_time: "06:10:00",
    end_time_zone: "America/New_York",
  });
  const v = visit({ id: "fl", reservation_id: "r", reservation: flight, local_date: null, timezone: null, category: "transport" });
  assert.equal(visitDate(v), "2026-10-18");
  assert.equal(groupVisitsByDay([v], START, END)[0].dayNumber, 5);
});

check("favorites are the same completed rows, not copies", () => {
  const fav = visit({ id: "f1", is_favorite: true });
  const plannedFav = visit({ id: "f2", is_favorite: true, status: "planned" });
  const out = favoriteVisits([fav, plannedFav, visit({ id: "n" })]);
  assert.equal(out.length, 1);
  assert.equal(out[0], fav);
});

check("capture candidates: trip days up to today, not done, not cancelled, no end milestones, newest first", () => {
  const items = [
    visit({ id: "planned-d1", status: "planned", local_date: "2026-10-14", title: "Snorkel" }),
    visit({ id: "done-d1", status: "completed", local_date: "2026-10-14", title: "Done already" }),
    visit({ id: "skipped-d2", status: "skipped", local_date: "2026-10-15", title: "Skipped boat" }),
    visit({ id: "future", status: "planned", local_date: "2026-10-17", title: "Future" }),
  ];
  const reservations = [
    booking({ id: "stay", kind: "lodging", title: "Hotel", start_date: "2026-10-14", end_date: "2026-10-16" }),
    booking({ id: "dinner", kind: "restaurant", title: "Dinner", start_date: "2026-10-15", start_time: "19:00:00" }),
    booking({ id: "gone", kind: "activity", title: "Cancelled tour", status: "cancelled", start_date: "2026-10-15" }),
  ];
  const out = captureCandidates({ items, reservations, tripStart: START, tripEnd: END, todayInTripZone: "2026-10-16" });
  assert.deepEqual(
    out.map((c) => [c.title, c.date]),
    [
      // Day 3: the stay's check-out is an end milestone — not offered.
      ["Skipped boat", "2026-10-15"],
      ["Dinner", "2026-10-15"],
      ["Snorkel", "2026-10-14"],
      ["Hotel", "2026-10-14"],
    ],
  );
  // Bookings without a row are targeted by booking, rows by item.
  assert.deepEqual(out.find((c) => c.title === "Dinner")?.target, { reservationId: "dinner" });
  assert.deepEqual(out.find((c) => c.title === "Snorkel")?.target, { itemId: "planned-d1" });
  assert.deepEqual(captureCandidates({ items, reservations, tripStart: START, tripEnd: END, todayInTripZone: "2026-10-13" }), []);
});

const blankSummary = { overall_rating: "", summary: "", favorite_moment: "", would_return: "", lessons_for_next_time: "" };

check("summary schema: undecided ≠ no ≠ not answered; rating 1–5 or cleared", () => {
  assert.equal(tripSummarySchema.parse(blankSummary).would_return, null);
  assert.equal(tripSummarySchema.parse({ ...blankSummary, would_return: "no" }).would_return, "no");
  assert.equal(tripSummarySchema.parse({ ...blankSummary, would_return: "undecided" }).would_return, "undecided");
  assert.equal(tripSummarySchema.parse({ ...blankSummary, would_return: "yes" }).would_return, "yes");
  assert.ok(!tripSummarySchema.safeParse({ ...blankSummary, would_return: "maybe" }).success);
  assert.equal(tripSummarySchema.parse(blankSummary).overall_rating, null);
  assert.equal(tripSummarySchema.parse({ ...blankSummary, overall_rating: "4" }).overall_rating, 4);
  for (const bad of ["0", "6", "4.5", "x"]) assert.ok(!tripSummarySchema.safeParse({ ...blankSummary, overall_rating: bad }).success);
  assert.equal(tripSummarySchema.parse({ ...blankSummary, summary: "   " }).summary, null);
  assert.ok(!("photo_album_url" in tripSummarySchema.parse(blankSummary)), "the album is saved separately");
});

check("album schema: https only, no credentials or local hosts; blank = none", () => {
  assert.equal(tripAlbumSchema.parse({ photo_album_url: "" }).photo_album_url, null);
  assert.equal(
    tripAlbumSchema.parse({ photo_album_url: "https://photos.app.goo.gl/AbC123" }).photo_album_url,
    "https://photos.app.goo.gl/AbC123",
  );
  for (const bad of [
    "http://photos.app.goo.gl/x",
    "javascript:alert(1)",
    "https://user:pw@drive.google.com/x",
    "https://localhost/album",
    "not a link",
  ]) {
    assert.ok(!tripAlbumSchema.safeParse({ photo_album_url: bad }).success, bad);
  }
});

check("capture schema: title and day required; rating / reflection optional", () => {
  const base = { title: "Sunset walk", category: "activity", local_date: "2026-10-15", rating: "", reflection: "", is_favorite: "" };
  const ok = captureMomentSchema.parse(base);
  assert.deepEqual(ok, { title: "Sunset walk", category: "activity", local_date: "2026-10-15", rating: null, reflection: null, is_favorite: false });
  assert.ok(!captureMomentSchema.safeParse({ ...base, title: " " }).success);
  assert.ok(!captureMomentSchema.safeParse({ ...base, local_date: "" }).success);
  assert.ok(!captureMomentSchema.safeParse({ ...base, category: "spa" }).success);
  assert.equal(captureMomentSchema.parse({ ...base, is_favorite: "on", rating: "5" }).is_favorite, true);
});

console.log(`\n${passed} checks passed.`);
