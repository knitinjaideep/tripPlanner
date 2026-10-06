/**
 * Pure itinerary logic checks — calendar days, time zones, booking
 * de-duplication, stay / transport milestones, ordering and overlaps.
 * No database needed:
 *
 *   npm run test:itinerary
 *
 * Run it under different process zones (TZ=Pacific/Kiritimati,
 * TZ=Pacific/Pago_Pago) to prove nothing depends on the machine's zone.
 */
import assert from "node:assert/strict";
import { todayInTimeZone } from "../src/lib/dates";
import {
  addDays,
  buildAgenda,
  datesBetween,
  daysBetweenDates,
  defaultItineraryDay,
  findOverlaps,
  previewDay,
  splitDay,
  type AgendaEntry,
} from "../src/lib/schedule";
import { zoneAbbreviation, zonedInstant } from "../src/lib/time-zones";
import type { ItineraryEntry, Reservation } from "../src/lib/types";

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
  confirmation_code: "ABC123",
  start_date: "2026-10-14",
  start_time: null,
  start_time_zone: "Europe/Paris",
  end_date: null,
  end_time: null,
  end_time_zone: "Europe/Paris",
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

const item = (over: Partial<ItineraryEntry>): ItineraryEntry => ({
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
  timezone: "Europe/Paris",
  sort_order: 1,
  status: "planned",
  planning_notes: null,
  rating: null,
  reflection: null,
  is_favorite: false,
  completed_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  place: null,
  reservation: null,
  ...over,
});

const trip = { tripStart: "2026-10-14", tripEnd: "2026-10-18" };
const keysOn = (entries: AgendaEntry[]) => entries.map((e) => e.key);

console.log(`Process TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

console.log("Calendar days");
check("inclusive days across month, year and DST boundaries", () => {
  assert.deepEqual(datesBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(datesBetween("2026-12-30", "2027-01-01"), ["2026-12-30", "2026-12-31", "2027-01-01"]);
  assert.deepEqual(datesBetween("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(datesBetween("2026-03-07", "2026-03-09").length, 3, "US DST start");
  assert.equal(datesBetween("2026-10-25", "2026-10-26").length, 2, "EU DST end");
  assert.deepEqual(datesBetween("2026-10-14", "2026-10-14"), ["2026-10-14"]);
});
check("day arithmetic is pure calendar math", () => {
  assert.equal(daysBetweenDates("2026-10-14", "2026-10-18"), 4);
  assert.equal(daysBetweenDates("2026-10-18", "2026-10-14"), -4);
  assert.equal(daysBetweenDates("2026-03-07", "2026-03-09"), 2);
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});
check("buildAgenda returns every trip day, numbered, even when empty", () => {
  const agenda = buildAgenda({ items: [], reservations: [], ...trip });
  assert.deepEqual(agenda.days.map((d) => [d.date, d.dayNumber, d.entries.length]), [
    ["2026-10-14", 1, 0], ["2026-10-15", 2, 0], ["2026-10-16", 3, 0], ["2026-10-17", 4, 0], ["2026-10-18", 5, 0],
  ]);
});

console.log("Default day");
check("today is taken in the trip's zone, not the viewer's", () => {
  // 02:00 UTC on Oct 15: still Oct 14 in Aruba, already Oct 15 in Tokyo.
  const now = new Date("2026-10-15T02:00:00Z");
  assert.equal(todayInTimeZone("America/Aruba", now), "2026-10-14");
  assert.equal(todayInTimeZone("Asia/Tokyo", now), "2026-10-15");
  // A trip ending Oct 14: on in Aruba, over in Tokyo.
  assert.equal(defaultItineraryDay("2026-10-10", "2026-10-14", todayInTimeZone("America/Aruba", now)), "2026-10-14");
  assert.equal(defaultItineraryDay("2026-10-10", "2026-10-14", todayInTimeZone("Asia/Tokyo", now)), "2026-10-10");
});
check("before / after the trip: itinerary opens on day 1; overview previews day 1 or the last day", () => {
  assert.equal(defaultItineraryDay("2026-10-14", "2026-10-18", "2026-09-01"), "2026-10-14");
  assert.equal(defaultItineraryDay("2026-10-14", "2026-10-18", "2026-11-01"), "2026-10-14");
  assert.equal(previewDay("2026-10-14", "2026-10-18", "2026-09-01"), "2026-10-14");
  assert.equal(previewDay("2026-10-14", "2026-10-18", "2026-10-16"), "2026-10-16");
  assert.equal(previewDay("2026-10-14", "2026-10-18", "2026-11-01"), "2026-10-18");
});

console.log("Time zones");
check("wall-clock times resolve to the right instant for ordering", () => {
  assert.equal(zonedInstant("2026-10-14", "08:20", "America/New_York"), Date.parse("2026-10-14T12:20:00Z"));
  assert.equal(zonedInstant("2026-10-15", "11:30:00", "Europe/Paris"), Date.parse("2026-10-15T09:30:00Z"));
  assert.equal(zonedInstant("2026-12-15", "11:30", "Europe/Paris"), Date.parse("2026-12-15T10:30:00Z"), "winter time");
  assert.equal(zonedInstant("2026-10-14", "08:20", null), Date.parse("2026-10-14T08:20:00Z"));
  assert.equal(zoneAbbreviation("2026-10-14", "08:20", "America/New_York"), "EDT");
  assert.equal(zoneAbbreviation("2026-12-14", "08:20", "America/New_York"), "EST");
});

console.log("Bookings on the itinerary");
check("a booking shows once — through its itinerary row when it has one", () => {
  const dinner = booking({ id: "d", kind: "restaurant", start_time: "19:30:00" });
  const tour = booking({ id: "t", start_time: "09:00:00" });
  const link = item({ id: "link", reservation_id: "d", reservation: dinner, title: null, local_date: null, timezone: null, planning_notes: "Ask for terrace" });
  const agenda = buildAgenda({ items: [link], reservations: [dinner, tour], ...trip });
  const day = agenda.days[0].entries;
  assert.deepEqual(keysOn(day), ["r:t", "r:d"]);
  const d = day.find((e) => e.key === "r:d")!;
  assert.equal(d.item?.id, "link", "the linked row carries notes / completion");
  assert.equal(d.time, "19:30:00", "the booking's own time is used");
  assert.equal(d.reservation?.confirmation_code, "ABC123", "read from the booking, never copied");
});
check("a multi-night stay is a check-in and a check-out, not a block on every day", () => {
  const stay = booking({ id: "s", kind: "lodging", title: "Hotel", start_date: "2026-10-14", start_time: "15:00:00", end_date: "2026-10-17", end_time: "11:00:00" });
  const agenda = buildAgenda({ items: [], reservations: [stay], ...trip });
  assert.deepEqual(agenda.days.map((d) => d.entries.map((e) => `${e.role}@${e.time}`)), [
    ["start@15:00:00"], [], [], ["end@11:00:00"], [],
  ]);
  assert.deepEqual(keysOn(agenda.days[3].entries), ["r:s:end"]);
});
check("an untimed check-out lands in Flexible on its day", () => {
  const stay = booking({ id: "s", kind: "lodging", start_date: "2026-10-14", end_date: "2026-10-16" });
  const { timed, flexible } = splitDay(buildAgenda({ items: [], reservations: [stay], ...trip }).days[2].entries);
  assert.equal(timed.length, 0);
  assert.deepEqual(flexible.map((e) => e.role), ["end"]);
});
check("an overnight flight departs on one day and arrives on the next, each in its own zone", () => {
  const flight = booking({
    id: "f", kind: "flight", title: "JFK → CDG",
    start_date: "2026-10-14", start_time: "22:00:00", start_time_zone: "America/New_York",
    end_date: "2026-10-15", end_time: "11:30:00", end_time_zone: "Europe/Paris",
  });
  const breakfast = item({ id: "b", local_date: "2026-10-15", local_start_time: "10:00:00", timezone: "Europe/Paris" });
  const call = item({ id: "c", local_date: "2026-10-15", local_start_time: "09:00:00", timezone: "America/New_York" });
  const agenda = buildAgenda({ items: [breakfast, call], reservations: [flight], ...trip });
  const dep = agenda.days[0].entries[0];
  assert.deepEqual([dep.role, dep.time, dep.timeZone], ["start", "22:00:00", "America/New_York"]);
  // 10:00 Paris (08:00Z) < 11:30 Paris (09:30Z) < 09:00 New York (13:00Z).
  assert.deepEqual(keysOn(agenda.days[1].entries), ["i:b", "r:f:end", "i:c"]);
  const arr = agenda.days[1].entries[1];
  assert.deepEqual([arr.role, arr.time, arr.timeZone], ["end", "11:30:00", "Europe/Paris"]);
});
check("a same-day flight is one entry with both ends", () => {
  const flight = booking({ id: "f", kind: "flight", start_time: "08:20:00", start_time_zone: "America/New_York", end_date: "2026-10-14", end_time: "13:15:00", end_time_zone: "America/Aruba" });
  const e = buildAgenda({ items: [], reservations: [flight], ...trip }).days[0].entries;
  assert.deepEqual(e.map((x) => x.role), ["single"]);
  assert.equal(e[0].schedule.endTimeZone, "America/Aruba");
});
check("cancelled bookings are hidden by default, counted, and flagged when shown", () => {
  const gone = booking({ id: "x", status: "cancelled" });
  const linked = item({ id: "l", reservation_id: "x", reservation: gone, title: null, local_date: null, timezone: null, reflection: "Rained out" });
  const hidden = buildAgenda({ items: [linked], reservations: [gone], ...trip });
  assert.equal(hidden.days[0].entries.length, 0);
  assert.equal(hidden.hiddenCancelled, 1, "counted once even with a linked row");
  const shown = buildAgenda({ items: [linked], reservations: [gone], ...trip, includeCancelled: true });
  assert.deepEqual(shown.days[0].entries.map((e) => [e.key, e.cancelled, e.item?.reflection]), [["r:x", true, "Rained out"]]);
});
check("a linked visit whose booking lost its date is listed as unscheduled, not dropped", () => {
  const undated = booking({ id: "u", start_date: null });
  const linked = item({ id: "l", reservation_id: "u", reservation: undated, title: null, local_date: null, timezone: null });
  const agenda = buildAgenda({ items: [linked], reservations: [undated], ...trip });
  assert.deepEqual(keysOn(agenda.unscheduled), ["r:u"]);
  assert.equal(agenda.days.flatMap((d) => d.entries).length, 0);
});

console.log("Trip date changes");
check("entries before or after the trip are kept in `outside`, grouped by date", () => {
  const early = item({ id: "e", local_date: "2026-10-12" });
  const late = item({ id: "l", local_date: "2026-10-20", local_start_time: "10:00:00" });
  const lateBooking = booking({ id: "b", start_date: "2026-10-20", start_time: "09:00:00" });
  const agenda = buildAgenda({ items: [early, late], reservations: [lateBooking], ...trip });
  assert.deepEqual(agenda.outside.map((d) => [d.date, d.dayNumber, keysOn(d.entries)]), [
    ["2026-10-12", null, ["i:e"]],
    ["2026-10-20", null, ["r:b", "i:l"]],
  ]);
  assert.equal(agenda.days.flatMap((d) => d.entries).length, 0);
});
check("a booking with one end inside the trip isn't listed as outside (red-eye out, flight home)", () => {
  const out = booking({ id: "o", kind: "flight", start_date: "2026-10-13", start_time: "22:00:00", end_date: "2026-10-14", end_time: "06:00:00" });
  const home = booking({ id: "h", kind: "flight", start_date: "2026-10-18", start_time: "22:40:00", end_date: "2026-10-19", end_time: "03:05:00" });
  const stay = booking({ id: "s", kind: "lodging", start_date: "2026-10-17", end_date: "2026-10-20" });
  const agenda = buildAgenda({ items: [], reservations: [out, home, stay], ...trip });
  assert.deepEqual(keysOn(agenda.days[0].entries), ["r:o:end"]);
  assert.deepEqual(keysOn(agenda.days[3].entries), ["r:s"]);
  assert.deepEqual(keysOn(agenda.days[4].entries), ["r:h"]);
  assert.deepEqual(agenda.outside, [], "the other end is described on the in-trip entry");
});

console.log("Timeline");
check("flexible entries keep their saved order", () => {
  const a = item({ id: "a", sort_order: 3 });
  const b = item({ id: "b", sort_order: 1 });
  const c = item({ id: "c", sort_order: 2, local_start_time: "12:00:00" });
  const { timed, flexible } = splitDay(buildAgenda({ items: [a, b, c], reservations: [], ...trip }).days[0].entries);
  assert.deepEqual(keysOn(timed), ["i:c"]);
  assert.deepEqual(keysOn(flexible), ["i:b", "i:a"]);
});
check("overlaps are flagged gently; touching, stays, skipped and other days are not", () => {
  const tour = item({ id: "tour", title: "Tour", local_start_time: "10:00:00", local_end_time: "12:00:00" });
  const lunch = item({ id: "lunch", title: "Lunch", local_start_time: "11:00:00" });
  const after = item({ id: "after", title: "After", local_start_time: "12:00:00" });
  const skipped = item({ id: "skip", title: "Skipped", local_start_time: "11:30:00", status: "skipped" });
  const stay = booking({ id: "s", kind: "lodging", start_time: "11:00:00", end_date: "2026-10-16" });
  const day = buildAgenda({ items: [tour, lunch, after, skipped], reservations: [stay], ...trip }).days[0].entries;
  const overlaps = findOverlaps(day);
  assert.deepEqual(overlaps.get("i:tour"), ["Lunch"]);
  assert.deepEqual(overlaps.get("i:lunch"), ["Tour"]);
  assert.equal(overlaps.has("i:after"), false, "ends are exclusive");
  assert.equal(overlaps.has("i:skip"), false);
  assert.equal(overlaps.has("r:s"), false);
});
check("overlaps compare real instants across zones", () => {
  const ny = item({ id: "ny", title: "NY call", local_start_time: "09:00:00", local_end_time: "10:00:00", timezone: "America/New_York" });
  const paris = item({ id: "p", title: "Paris dinner", local_start_time: "15:30:00", timezone: "Europe/Paris" });
  const day = buildAgenda({ items: [ny, paris], reservations: [], ...trip }).days[0].entries;
  // 09:00–10:00 EDT is 15:00–16:00 in Paris.
  assert.deepEqual(findOverlaps(day).get("i:p"), ["NY call"]);
});

console.log(`\n${passed} itinerary checks passed.`);
