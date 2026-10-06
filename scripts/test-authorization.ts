/**
 * Authorization + data-integrity checks for the owner-scoped data layer.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:authz
 *
 * Runs the real queries (src/db/queries.ts — the functions every DAL entry
 * point calls with the verified user ID) against a migrated database, as two
 * different owners. It creates disposable records under random test owner
 * IDs and deletes only those records at the end.
 *
 * It does NOT exercise Google sign-in or session verification; see
 * docs/local-setup.md for the manual browser checks.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inArray, sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as q from "../src/db/queries";
import { trips } from "../src/db/schema";
import { safeNextPath } from "../src/lib/auth/redirects";
import { zoneAbbreviation } from "../src/lib/time-zones";
import { addDays, buildAgenda, datesBetween, standaloneScheduleFromReservation } from "../src/lib/schedule";
import { filterPlaces, parseExploreFilters } from "../src/lib/explore";
import { STARTER_CATEGORIES, normalizeName, progressOf } from "../src/lib/packing";
import { favoriteVisits, groupVisitsByDay, memoryStats } from "../src/lib/memories";
import { entryTitle } from "../src/lib/schedule";
import { todayInTimeZone } from "../src/lib/dates";
import type { ItineraryItemInput, PlaceInput, ReservationInput, TripInput } from "../src/lib/types";
import {
  documentSchema,
  itineraryItemSchema,
  packingItemSchema,
  placeSchema,
  reservationSchema,
  tripMemorySchema,
  tripSchema,
  tripSummarySchema,
} from "../src/lib/validation";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to a migrated, disposable database.");
  process.exit(1);
}

const { db, pool } = createDb(url);
const A = `test-owner-a-${randomUUID()}`;
const B = `test-owner-b-${randomUUID()}`;
let passed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const tripInput = (title: string): TripInput => ({
  title,
  destination: "Aruba",
  start_date: "2026-10-14",
  end_date: "2026-10-19",
  time_zone: "America/Aruba",
  travelers: ["A", "B"],
  cover_image: "beach",
  notes: null,
});

const flight: ReservationInput = {
  kind: "flight",
  status: "confirmed",
  title: "Newark to Aruba",
  provider: "United",
  confirmation_code: "000123",
  start_date: "2026-10-14",
  start_time: "08:20",
  start_time_zone: "America/New_York",
  end_date: "2026-10-14",
  end_time: "13:15",
  end_time_zone: "America/Aruba",
  origin: "EWR",
  destination: "AUA",
  location: null,
  booking_url: null,
  notes: null,
  details: { flight_number: "UA 1521" },
};

async function main() {
  console.log(`Process TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // ---- setup: A owns T1 (with r1, doc1) and T2 (with r2); B owns TB ----
  const t1 = (await q.createTrip(db, A, tripInput("A trip 1"))).id;
  const t2 = (await q.createTrip(db, A, tripInput("A trip 2"))).id;
  const tb = (await q.createTrip(db, B, tripInput("B trip"))).id;
  const r1 = (await q.createReservation(db, A, t1, flight))!.id;
  const r2 = (await q.createReservation(db, A, t2, { ...flight, title: "Other trip flight" }))!.id;
  const doc1 = await q.createDocument(db, A, t1, { reservation_id: r1, label: "Boarding pass", url: "https://drive.google.com/x" });
  assert.ok(doc1.ok);
  const d1 = doc1.id;

  console.log("Isolation between accounts");
  await check("B lists only B's trips", async () => {
    const list = await q.listTrips(db, B);
    assert.deepEqual(list.map((t) => t.id), [tb]);
  });
  await check("B cannot read A's trip, bookings or documents", async () => {
    assert.equal(await q.getTripWithDetails(db, B, t1), null);
  });
  await check("B cannot update or delete A's trip", async () => {
    assert.equal(await q.updateTrip(db, B, t1, tripInput("hijacked")), false);
    assert.equal(await q.deleteTrip(db, B, t1), false);
    assert.equal((await q.getTripWithDetails(db, A, t1))?.title, "A trip 1");
  });
  await check("B cannot add a booking or document to A's trip", async () => {
    assert.equal(await q.createReservation(db, B, t1, flight), null);
    assert.deepEqual(await q.createDocument(db, B, t1, { reservation_id: null, label: "x", url: "https://x.test" }), {
      ok: false,
      reason: "not_found",
    });
  });
  await check("B cannot update or delete A's booking", async () => {
    assert.deepEqual(await q.updateReservation(db, B, t1, r1, { ...flight, title: "hijacked" }), { ok: false, reason: "not_found" });
    assert.equal(await q.deleteReservation(db, B, t1, r1), null);
    // Not even by pairing it with B's own trip ID.
    assert.deepEqual(await q.updateReservation(db, B, tb, r1, { ...flight, title: "hijacked" }), { ok: false, reason: "not_found" });
    assert.equal(await q.deleteReservation(db, B, tb, r1), null);
  });
  await check("B cannot update or delete A's document", async () => {
    const input = { reservation_id: null, label: "hijacked", url: "https://evil.test" };
    assert.deepEqual(await q.updateDocument(db, B, t1, d1, input), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.updateDocument(db, B, tb, d1, input), { ok: false, reason: "not_found" });
    assert.equal(await q.deleteDocument(db, B, t1, d1), false);
    const a = await q.getTripWithDetails(db, A, t1);
    assert.equal(a?.documents[0].label, "Boarding pass");
    assert.equal(a?.reservations[0].title, "Newark to Aruba");
  });

  console.log("Forged and mismatched IDs");
  await check("random trip/booking/document IDs are not found", async () => {
    const fake = randomUUID();
    assert.equal(await q.getTripWithDetails(db, A, fake), null);
    assert.equal(await q.updateTrip(db, A, fake, tripInput("x")), false);
    assert.equal(await q.createReservation(db, A, fake, flight), null);
    assert.deepEqual(await q.updateReservation(db, A, t1, fake, flight), { ok: false, reason: "not_found" });
    assert.equal(await q.deleteDocument(db, A, t1, fake), false);
  });
  await check("a booking can't be edited through the wrong trip (even the owner's)", async () => {
    assert.deepEqual(await q.updateReservation(db, A, t2, r1, flight), { ok: false, reason: "not_found" });
  });

  console.log("Documents stay within their trip");
  await check("A can't attach a T1 document to a T2 booking", async () => {
    const r = await q.createDocument(db, A, t1, { reservation_id: r2, label: "x", url: "https://x.test" });
    assert.deepEqual(r, { ok: false, reason: "reservation_not_in_trip" });
    const u = await q.updateDocument(db, A, t1, d1, { reservation_id: r2, label: "x", url: "https://x.test" });
    assert.deepEqual(u, { ok: false, reason: "reservation_not_in_trip" });
  });
  await check("B can't attach a document in B's trip to A's booking", async () => {
    const r = await q.createDocument(db, B, tb, { reservation_id: r1, label: "x", url: "https://x.test" });
    assert.deepEqual(r, { ok: false, reason: "reservation_not_in_trip" });
  });
  await check("database rejects cross-owner/cross-trip rows even without app checks", async () => {
    await assert.rejects(
      db.execute(sql`insert into reservations (trip_id, owner_id, kind, title) values (${t1}, ${B}, 'other', 'x')`),
    );
    await assert.rejects(
      db.execute(
        sql`insert into documents (trip_id, owner_id, reservation_id, label, url) values (${t1}, ${A}, ${r2}, 'x', 'https://x.test')`,
      ),
    );
  });

  console.log("Stored values round-trip exactly");
  await check("trip dates and wall-clock times don't shift", async () => {
    const t = await q.getTripWithDetails(db, A, t1);
    assert.equal(t?.start_date, "2026-10-14");
    assert.equal(t?.end_date, "2026-10-19");
    assert.equal(t?.time_zone, "America/Aruba");
    const r = t!.reservations[0];
    assert.equal(r.start_date, "2026-10-14");
    assert.equal(r.start_time, "08:20:00");
    assert.equal(r.start_time_zone, "America/New_York");
    assert.equal(r.end_time, "13:15:00");
    assert.equal(r.end_time_zone, "America/Aruba");
  });
  await check("confirmation numbers stay strings (leading zeros kept)", async () => {
    const t = await q.getTripWithDetails(db, A, t1);
    assert.equal(t?.reservations[0].confirmation_code, "000123");
  });
  await check("type-specific details persist", async () => {
    const t = await q.getTripWithDetails(db, A, t1);
    assert.deepEqual(t?.reservations[0].details, { flight_number: "UA 1521" });
  });
  await check("departure and arrival zones label correctly", () => {
    assert.equal(zoneAbbreviation("2026-10-14", "08:20:00", "America/New_York"), "EDT");
    assert.equal(zoneAbbreviation("2026-12-14", "08:20:00", "America/New_York"), "EST");
    assert.equal(zoneAbbreviation("2026-10-14", "13:15:00", "America/Aruba"), "AST");
    assert.equal(zoneAbbreviation("2026-10-14", "09:00:00", "Asia/Kolkata"), "GMT+5:30");
  });

  console.log("Deletion behavior");
  await check("deleting a booking keeps its documents on the trip", async () => {
    assert.deepEqual(await q.deleteReservation(db, A, t1, r1), { keptVisits: 0 });
    const t = await q.getTripWithDetails(db, A, t1);
    assert.equal(t?.reservations.length, 0);
    assert.equal(t?.documents.length, 1);
    assert.equal(t?.documents[0].reservation_id, null);
  });
  await check("deleting a trip removes its bookings and documents", async () => {
    assert.equal(await q.deleteTrip(db, A, t2), true);
    const rows = await db.execute(sql`select count(*)::int as n from reservations where trip_id = ${t2}`);
    assert.equal((rows.rows[0] as { n: number }).n, 0);
  });

  await featureChecks();
  await itineraryTabChecks();
  await exploreTabChecks();
  await packingTabChecks();
  await memoriesTabChecks();
  await workflowChecks();

  console.log("Validation");
  await check("trip schema rejects bad zones and reversed dates", () => {
    const base = { title: "x", destination: "y", start_date: "2026-10-14", end_date: "2026-10-19", time_zone: "America/Aruba", travelers: "", cover_image: "beach", notes: "" };
    assert.ok(tripSchema.safeParse(base).success);
    assert.ok(!tripSchema.safeParse({ ...base, time_zone: "Mars/Olympus" }).success);
    assert.ok(!tripSchema.safeParse({ ...base, end_date: "2026-10-01" }).success);
  });
  await check("reservation schema validates per-kind details and zones", () => {
    const base = {
      kind: "restaurant", status: "confirmed", title: "Dinner", provider: "", confirmation_code: "007", start_date: "2026-10-15",
      start_time: "19:30", start_time_zone: "America/Aruba", end_date: "", end_time: "", end_time_zone: "America/Aruba",
      origin: "", destination: "", location: "", booking_url: "", notes: "", details: { party_size: "4", flight_number: "ignored" },
    };
    const ok = reservationSchema.safeParse(base);
    assert.ok(ok.success);
    assert.deepEqual(ok.data.details, { party_size: 4 });
    assert.equal(ok.data.confirmation_code, "007");
    const bad = reservationSchema.safeParse({ ...base, details: { party_size: "999" } });
    assert.ok(!bad.success);
    assert.ok(bad.error.issues.some((i) => i.path.join(".") === "details.party_size"));
    assert.ok(!reservationSchema.safeParse({ ...base, start_time_zone: "" }).success, "time needs a zone");
    assert.ok(!reservationSchema.safeParse({ ...base, status: "maybe" }).success);
  });
  await check("itinerary schema: booking visits carry no schedule; overnight needs an end date", () => {
    const base = { place_id: "", reservation_id: "", title: "Hike", category: "activity", local_date: "2026-10-15", local_start_time: "22:00", local_end_date: "", local_end_time: "02:00", timezone: "", planning_notes: "" };
    const overnight = itineraryItemSchema.safeParse(base);
    assert.ok(!overnight.success);
    assert.ok(overnight.error.issues.some((i) => i.path[0] === "local_end_date"));
    assert.ok(itineraryItemSchema.safeParse({ ...base, local_end_date: "2026-10-16" }).success);
    const sameDay = itineraryItemSchema.safeParse({ ...base, local_end_time: "23:00", local_end_date: "2026-10-15" });
    assert.ok(sameDay.success);
    assert.equal(sameDay.data.local_end_date, null);
    const booking = itineraryItemSchema.safeParse({ ...base, title: "", reservation_id: randomUUID() });
    assert.ok(booking.success);
    assert.equal(booking.data.local_date, null);
    assert.equal(booking.data.local_start_time, null);
    assert.ok(!itineraryItemSchema.safeParse({ ...base, title: "" }).success, "standalone needs a title");
    assert.ok(!itineraryItemSchema.safeParse({ ...base, local_date: "" }).success, "standalone needs a day");
    assert.ok(!itineraryItemSchema.safeParse({ ...base, place_id: "' or 1=1" }).success);
  });
  await check("place, packing and memory schemas", () => {
    const place = { name: "x", kind: "food", category: "cafe", priority: "maybe", address: "", maps_url: "", website_url: "", planning_notes: "" };
    assert.ok(placeSchema.safeParse(place).success);
    assert.ok(!placeSchema.safeParse({ ...place, category: "museum" }).success);
    assert.ok(!placeSchema.safeParse({ ...place, website_url: "http://x.test" }).success);
    const item = { category_id: randomUUID(), label: "Socks", quantity: "", traveler_name: "", notes: "" };
    assert.equal(packingItemSchema.parse(item).quantity, 1);
    assert.ok(!packingItemSchema.safeParse({ ...item, quantity: "0" }).success);
    const memory = { overall_rating: "", summary: "", favorite_moment: "", would_return: "", lessons_for_next_time: "", photo_album_url: "" };
    assert.equal(tripMemorySchema.parse(memory).would_return, null);
    assert.equal(tripMemorySchema.parse({ ...memory, would_return: "no" }).would_return, "no");
    assert.equal(tripMemorySchema.parse({ ...memory, would_return: "undecided" }).would_return, "undecided");
    assert.ok(!tripMemorySchema.safeParse({ ...memory, would_return: "maybe" }).success);
    assert.ok(!tripMemorySchema.safeParse({ ...memory, overall_rating: "6" }).success);
  });
  await check("document schema only accepts https links and UUID bookings", () => {
    assert.ok(documentSchema.safeParse({ reservation_id: "", label: "x", url: "https://drive.google.com/a" }).success);
    assert.ok(!documentSchema.safeParse({ reservation_id: "", label: "x", url: "http://x.test" }).success);
    assert.ok(!documentSchema.safeParse({ reservation_id: "javascript:alert(1)", label: "x", url: "https://x.test" }).success);
  });
  await check("post-login destinations stay same-origin", () => {
    assert.equal(safeNextPath("/trips/abc?x=1"), "/trips/abc?x=1");
    for (const evil of ["https://evil.com", "//evil.com", "/\\evil.com", "/\r\nSet-Cookie: x=1", "javascript:alert(1)", "/login", "/api/auth/x"]) {
      assert.equal(safeNextPath(evil).startsWith("/trips"), true, evil);
    }
    assert.equal(safeNextPath("/trips?neon_auth_session_verifier=abc"), "/trips");
  });

  console.log("Architecture guards");
  await check("only the DAL imports the database layer; no client code touches it", () => {
    const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const importsDb = /from "@\/db(\/queries)?"/.test(src);
      if (importsDb) assert.ok(file.endsWith("src/lib/dal.ts"), `${file} imports the database layer directly`);
      if (/^["']use client["']/.test(src)) {
        assert.ok(!/@\/lib\/dal|@\/db|from "pg"/.test(src), `${file} is a Client Component importing server data code`);
      }
    }
  });
  await check("every exported DAL function verifies the session itself", () => {
    const src = readFileSync("src/lib/dal.ts", "utf8");
    const blocks = src.split(/\n(?=export )/).filter((b) => /^export (async function|const \w+ = cache\(async)/.test(b));
    assert.ok(blocks.length >= 12, `found ${blocks.length} DAL functions`);
    for (const block of blocks) {
      const name = /^export (?:async function|const) (\w+)/.exec(block)![1];
      if (name === "requireUser") continue;
      assert.match(block, /await require(User|UserId)\(\)/, `${name} must verify the session`);
    }
  });
  await check("no NEXT_PUBLIC_ secrets and no route exposes SQL", () => {
    const files = walk("src");
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.ok(!/NEXT_PUBLIC_(DATABASE|NEON_AUTH)/.test(src), `${file} exposes a server secret`);
    }
    const routes = files.filter((f) => /\/route\.ts$/.test(f));
    assert.deepEqual(routes, ["src/app/api/auth/[...path]/route.ts"]);
  });
}

const placeInput = (name: string): PlaceInput => ({
  name,
  kind: "food",
  category: "restaurant",
  priority: "must_do",
  address: "1 Palm Beach",
  maps_url: "https://maps.google.com/?q=x",
  website_url: null,
  planning_notes: null,
});

const visit = (over: Partial<ItineraryItemInput> = {}): ItineraryItemInput => ({
  place_id: null,
  reservation_id: null,
  title: "Snorkel at Boca Catalina",
  category: "activity",
  local_date: "2026-10-15",
  local_start_time: null,
  local_end_date: null,
  local_end_time: null,
  timezone: null,
  planning_notes: null,
  ...over,
});

async function categoryId(owner: string, tripId: string, name: string) {
  const made = await q.createPackingCategory(db, owner, tripId, { name });
  assert.ok(made.ok, `create category ${name}`);
  return made.id;
}

const count = async (table: string, tripId: string) =>
  ((await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where trip_id = ${tripId}`)).rows[0] as {
    n: number;
  }).n;

/** Explore, Itinerary, Packing and Memories — on fresh disposable trips. */
async function featureChecks() {
  const f1 = (await q.createTrip(db, A, tripInput("A feature trip"))).id;
  const f2 = (await q.createTrip(db, A, tripInput("A other trip"))).id;
  const fb = (await q.createTrip(db, B, tripInput("B feature trip"))).id;
  const p1 = await q.createPlace(db, A, f1, placeInput("Zeerovers"));
  const p2 = await q.createPlace(db, A, f2, placeInput("Other trip place"));
  assert.ok(p1.ok && p2.ok);
  const dinner = (await q.createReservation(db, A, f1, {
    ...flight,
    kind: "restaurant",
    title: "Dinner at Flying Fishbone",
    start_date: "2026-10-16",
    start_time: "19:30",
    start_time_zone: "America/Aruba",
    end_date: null,
    end_time: null,
    end_time_zone: "America/Aruba",
    details: {},
  }))!.id;
  const fl = (await q.createReservation(db, A, f1, flight))!.id;
  const undated = (await q.createReservation(db, A, f1, { ...flight, title: "TBD tour", kind: "activity", start_date: null, start_time: null, end_date: null, end_time: null, details: {} }))!.id;
  const otherTripBooking = (await q.createReservation(db, A, f2, flight))!.id;

  console.log("Explore");
  await check("B cannot read, add, edit or delete A's places", async () => {
    assert.equal(await q.listPlaces(db, B, f1), null);
    assert.deepEqual(await q.createPlace(db, B, f1, placeInput("x")), { ok: false, reason: "not_found" });
    assert.equal(await q.updatePlace(db, B, f1, p1.ok ? p1.id : "", placeInput("hijacked")), false);
    assert.equal(await q.updatePlace(db, B, fb, p1.ok ? p1.id : "", placeInput("hijacked")), false);
    assert.deepEqual(await q.deletePlace(db, B, f1, p1.ok ? p1.id : "", "detach"), { ok: false, reason: "not_found" });
    assert.equal((await q.listPlaces(db, A, f1))?.[0].name, "Zeerovers");
  });
  await check("database rejects a place category that doesn't fit its kind", async () => {
    await assert.rejects(
      db.execute(sql`insert into places (trip_id, owner_id, name, kind, category) values (${f1}, ${A}, 'x', 'food', 'museum')`),
    );
  });

  console.log("Itinerary");
  const placeId = p1.ok ? p1.id : "";
  const placeVisit = await q.createItineraryItem(db, A, f1, visit({ place_id: placeId, title: null, category: "food" }));
  assert.ok(placeVisit.ok);
  await check("a place visit stores no copied details; visited is derived", async () => {
    let list = await q.listPlaces(db, A, f1);
    assert.equal(list?.[0].visit_count, 1);
    assert.equal(list?.[0].visited, false);
    const entry = (await q.listItinerary(db, A, f1))!.find((i) => i.id === placeVisit.id)!;
    assert.equal(entry.title, null);
    assert.equal(entry.place?.address, "1 Palm Beach");
    assert.equal(await q.reviewItineraryItem(db, A, f1, placeVisit.id, { status: "completed", rating: 5, reflection: "Best fish", is_favorite: true }), true);
    list = await q.listPlaces(db, A, f1);
    assert.equal(list?.[0].visited, true);
  });
  await check("untimed visits stay untimed; zone defaults to the trip's; dates don't shift", async () => {
    const entry = (await q.listItinerary(db, A, f1))!.find((i) => i.id === placeVisit.id)!;
    assert.equal(entry.local_date, "2026-10-15");
    assert.equal(entry.local_start_time, null);
    assert.equal(entry.timezone, "America/Aruba");
  });
  await check("visits can't link a place or booking from another trip or owner", async () => {
    assert.deepEqual(await q.createItineraryItem(db, A, f1, visit({ place_id: p2.ok ? p2.id : "" })), { ok: false, reason: "place_not_in_trip" });
    assert.deepEqual(await q.createItineraryItem(db, A, f1, visit({ reservation_id: otherTripBooking, local_date: null, timezone: null })), { ok: false, reason: "reservation_not_in_trip" });
    assert.deepEqual(await q.createItineraryItem(db, B, fb, visit({ place_id: placeId })), { ok: false, reason: "place_not_in_trip" });
    assert.deepEqual(await q.createItineraryItem(db, B, fb, visit({ reservation_id: dinner, local_date: null })), { ok: false, reason: "reservation_not_in_trip" });
    assert.deepEqual(await q.createItineraryItem(db, B, f1, visit()), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.updateItineraryItem(db, A, f1, placeVisit.id, visit({ place_id: p2.ok ? p2.id : "" })), { ok: false, reason: "place_not_in_trip" });
    await assert.rejects(
      db.execute(sql`insert into itinerary_items (trip_id, owner_id, place_id, local_date, timezone) values (${f1}, ${A}, ${p2.ok ? p2.id : ""}, '2026-10-15', 'UTC')`),
    );
    await assert.rejects(
      db.execute(sql`insert into itinerary_items (trip_id, owner_id, reservation_id) values (${fb}, ${B}, ${dinner})`),
    );
  });
  await check("B cannot edit, review, or delete A's visits", async () => {
    assert.deepEqual(await q.updateItineraryItem(db, B, f1, placeVisit.id, visit()), { ok: false, reason: "not_found" });
    assert.equal(await q.reviewItineraryItem(db, B, f1, placeVisit.id, { status: "skipped", rating: 1, reflection: null, is_favorite: false }), false);
    assert.equal(await q.reviewItineraryItem(db, B, fb, placeVisit.id, { status: "skipped", rating: 1, reflection: null, is_favorite: false }), false);
    assert.equal(await q.deleteItineraryItem(db, B, f1, placeVisit.id), false);
    assert.equal(await q.listItinerary(db, B, f1), null);
  });

  const dinnerVisit = await q.ensureReservationVisit(db, A, f1, dinner);
  assert.ok(dinnerVisit.ok);
  await check("a booking backs at most one visit, which takes its schedule from the booking", async () => {
    assert.deepEqual(await q.ensureReservationVisit(db, A, f1, dinner), dinnerVisit);
    assert.deepEqual(await q.createItineraryItem(db, A, f1, visit({ reservation_id: dinner })), { ok: false, reason: "reservation_already_linked" });
    const entry = (await q.listItinerary(db, A, f1))!.find((i) => i.id === dinnerVisit.id)!;
    assert.equal(entry.local_date, null);
    assert.equal(entry.timezone, null);
    assert.equal(entry.reservation?.start_time, "19:30:00");
    await assert.rejects(
      db.execute(sql`update itinerary_items set local_date = '2026-10-16', timezone = 'UTC' where id = ${dinnerVisit.id}`),
      "a booking-backed visit can't hold its own date",
    );
    assert.deepEqual(await q.createItineraryItem(db, A, f1, visit({ reservation_id: undated })), { ok: false, reason: "reservation_unscheduled" });
  });
  await check("a booking's date can't be cleared while a visit uses it", async () => {
    const r = await q.updateReservation(db, A, f1, dinner, { ...flight, kind: "restaurant", title: "Dinner", start_date: null, start_time: null, end_date: null, end_time: null, details: {} });
    assert.deepEqual(r, { ok: false, reason: "linked_visit_needs_date" });
  });
  await check("overnight end needs an explicit end date (database)", async () => {
    const base = sql`insert into itinerary_items (trip_id, owner_id, title, local_date, local_start_time, local_end_time, local_end_date, timezone) values`;
    await assert.rejects(db.execute(sql`${base} (${f1}, ${A}, 'Night bus', '2026-10-15', '22:00', '02:00', null, 'UTC')`));
    await db.execute(sql`${base} (${f1}, ${A}, 'Night bus', '2026-10-15', '22:00', '02:00', '2026-10-16', 'UTC')`);
    await assert.rejects(db.execute(sql`${base} (${f1}, ${A}, 'Bad', '2026-10-15', null, null, '2026-10-14', 'UTC')`));
  });
  await check("completion time follows status; reflections survive un-completing", async () => {
    await assert.rejects(
      db.execute(sql`insert into itinerary_items (trip_id, owner_id, title, local_date, timezone, status) values (${f1}, ${A}, 'x', '2026-10-15', 'UTC', 'completed')`),
    );
    let entry = (await q.listItinerary(db, A, f1, { completedOnly: true }))!;
    assert.deepEqual(entry.map((i) => i.id), [placeVisit.id]);
    const firstCompleted = entry[0].completed_at;
    assert.ok(firstCompleted);
    await q.reviewItineraryItem(db, A, f1, placeVisit.id, { status: "completed", rating: 4, reflection: "Still great", is_favorite: true });
    entry = (await q.listItinerary(db, A, f1, { completedOnly: true }))!;
    assert.equal(entry[0].completed_at, firstCompleted, "re-saving keeps the original completion time");
    await q.reviewItineraryItem(db, A, f1, placeVisit.id, { status: "planned", rating: 4, reflection: "Still great", is_favorite: true });
    const all = (await q.listItinerary(db, A, f1))!.find((i) => i.id === placeVisit.id)!;
    assert.equal(all.completed_at, null);
    assert.equal(all.reflection, "Still great");
    await q.reviewItineraryItem(db, A, f1, placeVisit.id, { status: "completed", rating: 5, reflection: "Best fish", is_favorite: true });
  });
  await check("removing a visit keeps its place and booking", async () => {
    const temp = await q.ensureReservationVisit(db, A, f1, fl);
    assert.ok(temp.ok);
    assert.equal(await q.deleteItineraryItem(db, A, f1, temp.id), true);
    const trip = await q.getTripWithDetails(db, A, f1);
    assert.ok(trip?.reservations.some((r) => r.id === fl));
  });

  console.log("Deleting linked records");
  await check("a place with visits isn't deleted unless the visits are detached (and kept)", async () => {
    assert.deepEqual(await q.deletePlace(db, A, f1, placeId, "block"), { ok: false, reason: "has_visits", visits: 1 });
    await assert.rejects(db.execute(sql`delete from places where id = ${placeId}`), "database refuses orphaning visits");
    assert.deepEqual(await q.deletePlace(db, A, f1, placeId, "detach"), { ok: true, detachedVisits: 1 });
    const kept = (await q.listItinerary(db, A, f1))!.find((i) => i.id === placeVisit.id)!;
    assert.equal(kept.place_id, null);
    assert.equal(kept.title, "Zeerovers");
    assert.equal(kept.reflection, "Best fish");
    assert.equal(kept.rating, 5);
  });
  await check("deleting a booking keeps a reviewed visit as standalone and drops a bare one", async () => {
    await assert.rejects(db.execute(sql`delete from reservations where id = ${dinner}`), "database refuses orphaning a visit");
    await q.reviewItineraryItem(db, A, f1, dinnerVisit.id, { status: "completed", rating: 4, reflection: "Lovely sunset", is_favorite: false });
    assert.deepEqual(await q.deleteReservation(db, A, f1, dinner), { keptVisits: 1 });
    const kept = (await q.listItinerary(db, A, f1))!.find((i) => i.id === dinnerVisit.id)!;
    assert.equal(kept.reservation_id, null);
    assert.equal(kept.title, "Dinner at Flying Fishbone");
    assert.equal(kept.local_date, "2026-10-16");
    assert.equal(kept.local_start_time, "19:30:00");
    assert.equal(kept.timezone, "America/Aruba");
    assert.equal(kept.reflection, "Lovely sunset");

    const bare = await q.ensureReservationVisit(db, A, f1, fl);
    assert.ok(bare.ok);
    assert.deepEqual(await q.deleteReservation(db, A, f1, fl), { keptVisits: 0 });
    assert.ok(!(await q.listItinerary(db, A, f1))!.some((i) => i.id === bare.id));
  });
  await check("B cannot delete A's booking even through B's own trip", async () => {
    assert.equal(await q.deleteReservation(db, B, fb, undated), null);
    assert.equal(await q.deleteReservation(db, B, f1, undated), null);
  });

  console.log("Packing");
  const clothes = await categoryId(A, f1, "Clothes");
  const beach = await categoryId(A, f1, "Beach");
  const otherCat = await categoryId(A, f2, "Other trip");
  const item = { category_id: clothes, label: "Swimsuit", quantity: 2, traveler_name: "Maya", notes: null };
  const shirt = await q.createPackingItem(db, A, f1, item);
  assert.ok(shirt.ok);
  await check("packing items stay in their trip's categories", async () => {
    assert.deepEqual(await q.createPackingItem(db, A, f1, { ...item, category_id: otherCat }), { ok: false, reason: "category_not_in_trip" });
    assert.deepEqual(await q.createPackingItem(db, B, fb, item), { ok: false, reason: "category_not_in_trip" });
    assert.deepEqual(await q.updatePackingItem(db, A, f1, shirt.id, { ...item, category_id: otherCat }), { ok: false, reason: "category_not_in_trip" });
    await assert.rejects(
      db.execute(sql`insert into packing_items (trip_id, owner_id, category_id, label) values (${f1}, ${A}, ${otherCat}, 'x')`),
    );
  });
  await check("B cannot read, add to, tick, rename or delete A's packing", async () => {
    assert.equal(await q.getPacking(db, B, f1), null);
    assert.deepEqual(await q.createPackingCategory(db, B, f1, { name: "x" }), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.updatePackingCategory(db, B, f1, clothes, { name: "x" }), { ok: false, reason: "not_found" });
    assert.equal(await q.setPackingItemPacked(db, B, f1, shirt.id, true), false);
    assert.equal(await q.setPackingItemPacked(db, B, fb, shirt.id, true), false);
    assert.equal(await q.deletePackingItem(db, B, f1, shirt.id), false);
    assert.deepEqual(await q.deletePackingCategory(db, B, f1, clothes, { items: "delete" }), { ok: false, reason: "not_found" });
    const mine = await q.getPacking(db, A, f1);
    assert.equal(mine?.[0].items[0].is_packed, false);
    assert.equal(mine?.[0].items[0].quantity, 2);
  });
  await check("a category with items is only deleted with an explicit move or delete", async () => {
    assert.deepEqual(await q.deletePackingCategory(db, A, f1, clothes, { items: "none" }), { ok: false, reason: "has_items", items: 1 });
    await assert.rejects(db.execute(sql`delete from packing_categories where id = ${clothes}`));
    assert.deepEqual(await q.deletePackingCategory(db, A, f1, clothes, { items: "move", target_category_id: otherCat }), { ok: false, reason: "target_not_found" });
    assert.deepEqual(await q.deletePackingCategory(db, A, f1, clothes, { items: "move", target_category_id: clothes }), { ok: false, reason: "target_not_found" });
    assert.deepEqual(await q.deletePackingCategory(db, A, f1, clothes, { items: "move", target_category_id: beach }), { ok: true, affectedItems: 1 });
    const after = await q.getPacking(db, A, f1);
    assert.deepEqual(after?.map((c) => [c.name, c.items.map((i) => i.label)]), [["Beach", ["Swimsuit"]]]);
    assert.deepEqual(await q.deletePackingCategory(db, A, f1, beach, { items: "delete" }), { ok: true, affectedItems: 1 });
    assert.equal(await count("packing_items", f1), 0);
  });

  console.log("Memories");
  await check("one summary per trip, owner-only", async () => {
    const memory = { overall_rating: 5, summary: "Sunny", favorite_moment: null, would_return: "yes" as const, lessons_for_next_time: null, photo_album_url: "https://photos.app.goo.gl/x" };
    assert.equal(await q.saveTripMemory(db, A, f1, memory), true);
    assert.equal(await q.saveTripMemory(db, A, f1, { ...memory, summary: "Sunny and calm" }), true);
    assert.equal(await count("trip_memories", f1), 1);
    assert.equal((await q.getTripMemory(db, A, f1))?.summary, "Sunny and calm");
    assert.equal(await q.saveTripMemory(db, B, f1, { ...memory, summary: "hijacked" }), false);
    assert.equal(await q.getTripMemory(db, B, f1), undefined);
    assert.equal(await q.deleteTripMemory(db, B, f1), false);
    assert.equal((await q.getTripMemory(db, A, fb)), undefined);
    assert.equal((await q.getTripMemory(db, A, f2)), null);
  });

  console.log("Trip date changes and deletion");
  await check("shortening a trip keeps visits outside the new dates", async () => {
    await q.updateTrip(db, A, f1, { ...tripInput("A feature trip"), start_date: "2026-10-14", end_date: "2026-10-14" });
    const items = (await q.listItinerary(db, A, f1))!;
    assert.ok(items.some((i) => i.local_date === "2026-10-16"));
    const agenda = buildAgenda({ items, reservations: [], tripStart: "2026-10-14", tripEnd: "2026-10-14" });
    assert.deepEqual(agenda.days.map((d) => [d.date, d.dayNumber]), [["2026-10-14", 1]]);
    assert.deepEqual(agenda.outside.map((d) => [d.date, d.dayNumber]), [["2026-10-15", null], ["2026-10-16", null]]);
  });
  await check("deleting a trip removes all of its places, visits, packing and memories", async () => {
    await q.createPackingItem(db, A, f1, { ...item, category_id: await categoryId(A, f1, "Docs") });
    const p = await q.createPlace(db, A, f1, placeInput("Linked"));
    await q.createItineraryItem(db, A, f1, visit({ place_id: p.ok ? p.id : "" }));
    await q.ensureReservationVisit(db, A, f1, (await q.createReservation(db, A, f1, flight))!.id);
    assert.equal(await q.deleteTrip(db, A, f1), true);
    for (const table of ["places", "itinerary_items", "packing_categories", "packing_items", "trip_memories", "reservations"]) {
      assert.equal(await count(table, f1), 0, table);
    }
    assert.ok(await q.getTripMemory(db, A, f2) === null, "other trips untouched");
  });

  console.log("Schedule helpers");
  await check("calendar arithmetic ignores the process zone", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-03-08", 1), "2026-03-09");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.deepEqual(datesBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  await check("a kept booking's schedule never mixes zones or breaks constraints", () => {
    const trip = { start_date: "2026-10-14", time_zone: "America/Aruba" };
    assert.deepEqual(standaloneScheduleFromReservation(flight, trip), {
      local_date: "2026-10-14", local_start_time: "08:20:00", local_end_date: null, local_end_time: null, timezone: "America/New_York",
    });
    const overnight = { ...flight, end_time_zone: "America/New_York", end_date: "2026-10-15", end_time: "06:00" };
    assert.equal(standaloneScheduleFromReservation(overnight, trip).local_end_date, "2026-10-15");
    const backwards = { ...flight, end_time_zone: "America/New_York", end_time: "07:00" };
    assert.equal(standaloneScheduleFromReservation(backwards, trip).local_end_time, null);
    assert.equal(standaloneScheduleFromReservation({ ...flight, start_date: null }, trip).local_date, "2026-10-14");
  });
  await check("agenda: timed by real instant, then flexible; undated bookings left out of days", () => {
    const mk = (id: string, time: string | null, order: number) => ({
      id, trip_id: "t", owner_id: "o", place_id: null, reservation_id: null, title: id, category: "activity" as const,
      local_date: "2026-10-14", local_start_time: time, local_end_date: null, local_end_time: null, timezone: "UTC",
      sort_order: order, status: "planned" as const, planning_notes: null, rating: null, reflection: null,
      is_favorite: false, completed_at: null, created_at: "2026-01-01", updated_at: "2026-01-01", place: null, reservation: null,
    });
    const agenda = buildAgenda({
      items: [mk("late", "18:00:00", 1), mk("anytime", null, 3), mk("early", "08:00:00", 2)],
      reservations: [{ ...flight, id: "r", trip_id: "t", owner_id: "o", start_time: "12:00:00", created_at: "x", updated_at: "x" }, { ...flight, id: "u", trip_id: "t", owner_id: "o", start_date: null, created_at: "x", updated_at: "x" }],
      tripStart: "2026-10-14",
      tripEnd: "2026-10-15",
    });
    // 08:00 UTC, then 12:00 New York (16:00 UTC), then 18:00 UTC; untimed last.
    assert.deepEqual(agenda.days[0].entries.map((e) => e.key), ["i:early", "r:r", "i:late", "i:anytime"]);
    assert.equal(agenda.days[1].entries.length, 0);
    assert.equal(agenda.unscheduled.length, 0);
  });
}

/** Itinerary tab: duplicate, move, reorder, schedule-from-Explore, save-to-Explore, cancelled bookings. */
async function itineraryTabChecks() {
  console.log("Itinerary tab");
  const it = (await q.createTrip(db, A, tripInput("A itinerary trip"))).id;
  const other = (await q.createTrip(db, A, tripInput("A second trip"))).id;
  const bt = (await q.createTrip(db, B, tripInput("B itinerary trip"))).id;
  const listed = async (id: string) => (await q.listItinerary(db, A, it))!.find((i) => i.id === id)!;
  const museum = await q.createPlace(db, A, it, placeInput("Museum"));
  assert.ok(museum.ok);
  const tour = (await q.createReservation(db, A, it, {
    ...flight, kind: "activity", title: "Island tour", start_date: "2026-10-16", start_time: null, end_date: null, end_time: null, details: {},
  }))!.id;
  const otherBooking = (await q.createReservation(db, A, other, flight))!.id;

  await check("duplicating copies the plan and resets completion, rating, reflection and favorite", async () => {
    const src = await q.createItineraryItem(db, A, it, visit({ local_start_time: "09:00", local_end_time: "11:00", planning_notes: "Bring cash" }));
    assert.ok(src.ok);
    await q.reviewItineraryItem(db, A, it, src.id, { status: "completed", rating: 5, reflection: "Lovely", is_favorite: true });
    const copy = await q.duplicateItineraryItem(db, A, it, src.id);
    assert.ok(copy.ok);
    const c = await listed(copy.id);
    assert.deepEqual(
      [c.title, c.local_date, c.local_start_time, c.local_end_time, c.timezone, c.planning_notes],
      ["Snorkel at Boca Catalina", "2026-10-15", "09:00:00", "11:00:00", "America/Aruba", "Bring cash"],
    );
    assert.deepEqual([c.status, c.rating, c.reflection, c.is_favorite, c.completed_at], ["planned", null, null, false, null]);
    assert.equal((await listed(src.id)).reflection, "Lovely", "the original keeps its reflection");
  });
  await check("a booking's entry can't be duplicated or moved; B can't duplicate or move A's", async () => {
    const link = await q.ensureReservationVisit(db, A, it, tour);
    assert.ok(link.ok);
    assert.deepEqual(await q.duplicateItineraryItem(db, A, it, link.id), { ok: false, reason: "reservation_backed" });
    assert.deepEqual(await q.moveItineraryItem(db, A, it, link.id, "2026-10-15"), { ok: false, reason: "reservation_backed" });
    const mine = await q.createItineraryItem(db, A, it, visit());
    assert.ok(mine.ok);
    assert.deepEqual(await q.duplicateItineraryItem(db, B, it, mine.id), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.duplicateItineraryItem(db, B, bt, mine.id), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.moveItineraryItem(db, B, bt, mine.id, "2026-10-15"), { ok: false, reason: "not_found" });
    assert.equal(await q.deleteItineraryItem(db, A, it, link.id), true);
  });
  await check("moving keeps times and duration, stays inside the trip, and goes last", async () => {
    const night = await q.createItineraryItem(db, A, it, visit({ title: "Night dive", local_start_time: "21:00", local_end_date: "2026-10-16", local_end_time: "01:00" }));
    assert.ok(night.ok);
    assert.deepEqual(await q.moveItineraryItem(db, A, it, night.id, "2026-10-20"), { ok: false, reason: "outside_trip" });
    assert.deepEqual(await q.moveItineraryItem(db, A, it, night.id, "2026-10-18"), { ok: true, id: night.id });
    const moved = await listed(night.id);
    assert.deepEqual([moved.local_date, moved.local_start_time, moved.local_end_date, moved.local_end_time], ["2026-10-18", "21:00:00", "2026-10-19", "01:00:00"]);
    const max = Math.max(...(await q.listItinerary(db, A, it))!.map((i) => i.sort_order));
    assert.equal(moved.sort_order, max);
  });
  await check("flexible order persists, and an untimed booking gets one link row to hold its place", async () => {
    const a = await q.createItineraryItem(db, A, it, visit({ title: "A", local_date: "2026-10-16" }));
    const b = await q.createItineraryItem(db, A, it, visit({ title: "B", local_date: "2026-10-16" }));
    assert.ok(a.ok && b.ok);
    const keys = [
      { type: "item" as const, id: b.id },
      { type: "reservation" as const, id: tour },
      { type: "item" as const, id: a.id },
    ];
    assert.deepEqual(await q.reorderItinerary(db, A, it, keys), { ok: true });
    assert.deepEqual(await q.reorderItinerary(db, A, it, keys), { ok: true }, "repeating is harmless");
    const trip = (await q.getTripWithDetails(db, A, it))!;
    const items = (await q.listItinerary(db, A, it))!;
    assert.equal(items.filter((i) => i.reservation_id === tour).length, 1, "one entry per booking");
    const day = buildAgenda({ items, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date })
      .days.find((d) => d.date === "2026-10-16")!;
    assert.deepEqual(day.entries.map((e) => e.key), [`i:${b.id}`, `r:${tour}`, `i:${a.id}`]);
  });
  await check("reordering rejects other trips' and other owners' entries, changing nothing", async () => {
    const a = await q.createItineraryItem(db, A, it, visit({ title: "C" }));
    assert.ok(a.ok);
    const before = (await listed(a.id)).sort_order;
    assert.deepEqual(await q.reorderItinerary(db, A, it, [{ type: "item", id: a.id }, { type: "reservation", id: otherBooking }]), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.reorderItinerary(db, B, bt, [{ type: "item", id: a.id }]), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.reorderItinerary(db, B, it, [{ type: "item", id: a.id }]), { ok: false, reason: "not_found" });
    assert.equal((await listed(a.id)).sort_order, before);
    assert.equal((await q.listItinerary(db, A, other))!.length, 0, "no link row created on the other trip");
  });
  await check("scheduling a place twice needs a deliberate repeat; concurrent clicks make one visit", async () => {
    const placeVisit = (date: string) => visit({ place_id: museum.ok ? museum.id : "", title: null, local_date: date });
    const results = await Promise.all([
      q.createItineraryItem(db, A, it, placeVisit("2026-10-17"), { unlessPlaceScheduled: true }),
      q.createItineraryItem(db, A, it, placeVisit("2026-10-17"), { unlessPlaceScheduled: true }),
      q.createItineraryItem(db, A, it, placeVisit("2026-10-17"), { unlessPlaceScheduled: true }),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.every((r) => r.ok || r.reason === "place_already_scheduled"));
    const again = await q.createItineraryItem(db, A, it, placeVisit("2026-10-18"));
    assert.ok(again.ok, "a deliberate second visit is allowed");
    assert.equal((await q.listPlaces(db, A, it))!.find((p) => p.name === "Museum")?.visit_count, 2);
    assert.deepEqual(await q.createItineraryItem(db, B, bt, placeVisit("2026-10-17")), { ok: false, reason: "place_not_in_trip" });
  });
  await check("save to Explore links an existing place by name instead of duplicating it", async () => {
    const first = await q.createItineraryItem(db, A, it, visit({ title: "Arikok Park", category: "sightseeing" }), { saveToExplore: true });
    assert.ok(first.ok && first.explorePlace === "created");
    const second = await q.createItineraryItem(db, A, it, visit({ title: "arikok park", category: "sightseeing" }), { saveToExplore: true });
    assert.ok(second.ok && second.explorePlace === "existing");
    const places = (await q.listPlaces(db, A, it))!.filter((p) => p.name.toLowerCase() === "arikok park");
    assert.equal(places.length, 1);
    assert.equal(places[0].visit_count, 2);
    assert.equal((await listed(first.id)).title, null, "the place's name is the source of truth");
    const stay = await q.createItineraryItem(db, A, it, visit({ title: "Hotel", category: "lodging" }), { saveToExplore: true });
    assert.ok(stay.ok && !stay.explorePlace, "stays aren't Explore places");
    assert.deepEqual(await q.updateItineraryItem(db, A, it, randomUUID(), visit({ title: "Ghost" }), { saveToExplore: true }), { ok: false, reason: "not_found" });
    assert.equal((await q.listPlaces(db, A, it))!.some((p) => p.name === "Ghost"), false, "no place for a missing item");
  });
  await check("status-only reviews keep rating, reflection and favorite", async () => {
    const v = await q.createItineraryItem(db, A, it, visit({ title: "Sunset" }));
    assert.ok(v.ok);
    await q.reviewItineraryItem(db, A, it, v.id, { status: "completed" });
    await q.reviewItineraryItem(db, A, it, v.id, { rating: 4, reflection: "Pink sky", is_favorite: true });
    await q.reviewItineraryItem(db, A, it, v.id, { status: "skipped" });
    let row = await listed(v.id);
    assert.deepEqual([row.status, row.completed_at, row.rating, row.reflection, row.is_favorite], ["skipped", null, 4, "Pink sky", true]);
    await q.reviewItineraryItem(db, A, it, v.id, { status: "completed" });
    row = await listed(v.id);
    assert.ok(row.completed_at);
    assert.ok((await q.listItinerary(db, A, it, { completedOnly: true }))!.some((i) => i.id === v.id));
    await q.reviewItineraryItem(db, A, it, v.id, { status: "planned" });
    assert.ok(!(await q.listItinerary(db, A, it, { completedOnly: true }))!.some((i) => i.id === v.id), "not in the Memories feed");
  });
  await check("cancelled bookings persist and are hidden from the agenda unless asked for", async () => {
    const r = (await q.createReservation(db, A, it, { ...flight, status: "cancelled", title: "Cancelled flight" }))!.id;
    const trip = (await q.getTripWithDetails(db, A, it))!;
    assert.equal(trip.reservations.find((x) => x.id === r)?.status, "cancelled");
    const items = (await q.listItinerary(db, A, it))!;
    const args = { items, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date };
    const keys = (a: ReturnType<typeof buildAgenda>) => a.days.flatMap((d) => d.entries.map((e) => e.key));
    assert.ok(!keys(buildAgenda(args)).includes(`r:${r}`));
    assert.equal(buildAgenda(args).hiddenCancelled, 1);
    assert.ok(keys(buildAgenda({ ...args, includeCancelled: true })).includes(`r:${r}`));
    await assert.rejects(db.execute(sql`update reservations set status = 'maybe' where id = ${r}`));
  });
  await check("after shortening the trip, entries stay; editing keeps their date; moving brings them back", async () => {
    const late = await q.createItineraryItem(db, A, it, visit({ title: "Last-day brunch", local_date: "2026-10-19", local_start_time: "10:00" }));
    assert.ok(late.ok);
    await q.updateTrip(db, A, it, { ...tripInput("A itinerary trip"), end_date: "2026-10-17" });
    let trip = (await q.getTripWithDetails(db, A, it))!;
    let agenda = buildAgenda({ items: (await q.listItinerary(db, A, it))!, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date });
    assert.ok(agenda.outside.some((d) => d.date === "2026-10-19" && d.entries.some((e) => e.key === `i:${late.id}`)));
    const edited = await q.updateItineraryItem(db, A, it, late.id, visit({ title: "Brunch", local_date: "2026-10-19", local_start_time: "10:30" }));
    assert.ok(edited.ok, "editing an outside entry doesn't force a new date");
    assert.equal((await listed(late.id)).local_date, "2026-10-19");
    assert.deepEqual(await q.moveItineraryItem(db, A, it, late.id, "2026-10-18"), { ok: false, reason: "outside_trip" });
    assert.ok((await q.moveItineraryItem(db, A, it, late.id, "2026-10-17")).ok);
    trip = (await q.getTripWithDetails(db, A, it))!;
    agenda = buildAgenda({ items: (await q.listItinerary(db, A, it))!, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date });
    assert.ok(agenda.days.at(-1)!.entries.some((e) => e.key === `i:${late.id}`));
    assert.equal((await listed(late.id)).local_start_time, "10:30:00");
  });
}

/** Explore tab: CRUD, idempotent creates, derived visit state, record-a-visit, shared place details. */
async function exploreTabChecks() {
  console.log("Explore tab");
  const ex = (await q.createTrip(db, A, tripInput("A explore trip"))).id;
  const exOther = (await q.createTrip(db, A, tripInput("A explore other"))).id;
  const exB = (await q.createTrip(db, B, tripInput("B explore trip"))).id;
  const rawPlace = (over: Record<string, string> = {}) => ({
    name: "Eagle Beach", kind: "place", category: "", priority: "", address: "", maps_url: "", website_url: "", planning_notes: "", ...over,
  });
  const parsedPlace = (over: Record<string, string> = {}) => placeSchema.parse(rawPlace(over));
  const placeRow = async (id: string, owner = A, trip = ex) => (await q.listPlaces(db, owner, trip))?.find((p) => p.id === id);
  const visitOf = (placeId: string, over: Partial<ItineraryItemInput> = {}) => visit({ place_id: placeId, title: null, category: "sightseeing", ...over });

  await check("a place needs only a name and kind; category and priority default; CRUD persists", async () => {
    const input = parsedPlace();
    assert.deepEqual([input.category, input.priority], ["other", "maybe"]);
    const made = await q.createPlace(db, A, ex, input);
    assert.ok(made.ok);
    assert.equal((await placeRow(made.id))?.name, "Eagle Beach");
    assert.equal(await q.updatePlace(db, A, ex, made.id, parsedPlace({ name: "Eagle Beach North", priority: "must_do", planning_notes: "Sunset spot" })), true);
    const row = await placeRow(made.id);
    assert.deepEqual([row?.name, row?.priority, row?.planning_notes], ["Eagle Beach North", "must_do", "Sunset spot"]);
    assert.deepEqual(await q.deletePlace(db, A, ex, made.id, "block"), { ok: true, detachedVisits: 0 });
    assert.equal(await placeRow(made.id), undefined);
  });
  await check("place links must be safe https URLs", () => {
    for (const bad of ["http://maps.google.com", "javascript:alert(1)", "https://user:pw@maps.google.com", "https://localhost/x", "https://10.0.0.1/"]) {
      assert.ok(!placeSchema.safeParse(rawPlace({ maps_url: bad })).success, bad);
    }
    assert.ok(placeSchema.safeParse(rawPlace({ maps_url: "https://maps.app.goo.gl/abc123", website_url: "https://example.com/menu" })).success);
  });
  await check("a repeated create (same request id) returns the same place; another owner can't reuse it", async () => {
    const requestId = randomUUID();
    const first = await q.createPlace(db, A, ex, parsedPlace({ name: "Baby Beach" }), requestId);
    const again = await q.createPlace(db, A, ex, parsedPlace({ name: "Baby Beach" }), requestId);
    assert.ok(first.ok && again.ok && first.id === again.id && first.id === requestId);
    assert.equal((await q.listPlaces(db, A, ex))!.filter((p) => p.name === "Baby Beach").length, 1);
    assert.deepEqual(await q.createPlace(db, B, exB, parsedPlace({ name: "Baby Beach" }), requestId), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.createPlace(db, A, exOther, parsedPlace({ name: "Baby Beach" }), requestId), { ok: false, reason: "not_found" });
    assert.equal((await q.listPlaces(db, B, exB))!.length, 0);
    const twin = await q.createPlace(db, A, ex, parsedPlace({ name: "Baby Beach" }));
    assert.ok(twin.ok, "a deliberate second place with the same name is allowed");
  });
  await check("a repeated itinerary create (same request id) makes one visit", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Hooiberg" }));
    assert.ok(p.ok);
    const requestId = randomUUID();
    const [a, b] = await Promise.all([
      q.createItineraryItem(db, A, ex, visitOf(p.id), { requestId }),
      q.createItineraryItem(db, A, ex, visitOf(p.id), { requestId }),
    ]);
    assert.ok(a.ok && b.ok && a.id === requestId && b.id === requestId);
    assert.equal((await placeRow(p.id))?.visit_count, 1);
    assert.deepEqual(await q.createItineraryItem(db, B, exB, visit(), { requestId }), { ok: false, reason: "not_found" });
  });
  await check("visited / scheduled / unscheduled are derived; a place can be both; ratings average completed visits only", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Natural Pool" }));
    assert.ok(p.ok);
    let row = (await placeRow(p.id))!;
    assert.deepEqual([row.planned_count, row.completed_count, row.rating_avg, row.rated_count], [0, 0, null, 0]);
    const done1 = await q.createItineraryItem(db, A, ex, visitOf(p.id, { local_date: "2026-10-15" }));
    const done2 = await q.createItineraryItem(db, A, ex, visitOf(p.id, { local_date: "2026-10-16" }));
    const skipped = await q.createItineraryItem(db, A, ex, visitOf(p.id, { local_date: "2026-10-16" }));
    const later = await q.createItineraryItem(db, A, ex, visitOf(p.id, { local_date: "2026-10-18" }));
    assert.ok(done1.ok && done2.ok && skipped.ok && later.ok);
    await q.reviewItineraryItem(db, A, ex, done1.id, { status: "completed", rating: 5 });
    await q.reviewItineraryItem(db, A, ex, done2.id, { status: "completed", rating: 4 });
    await q.reviewItineraryItem(db, A, ex, skipped.id, { status: "skipped", rating: 1 });
    row = (await placeRow(p.id))!;
    assert.deepEqual(
      [row.planned_count, row.completed_count, row.visited, row.rating_avg, row.rated_count, row.next_planned_date, row.last_completed_date],
      [1, 2, true, 4.5, 2, "2026-10-18", "2026-10-16"],
    );
    const all = (await q.listPlaces(db, A, ex))!;
    const names = (status: string) => filterPlaces(all, parseExploreFilters({ status })).map((x) => x.name);
    assert.ok(names("visited").includes("Natural Pool") && names("scheduled").includes("Natural Pool"));
    assert.ok(!names("unscheduled").includes("Natural Pool"));
    assert.ok(names("unscheduled").includes("Baby Beach"));
    // A place with only a skipped visit is unscheduled.
    const onlySkipped = await q.createPlace(db, A, ex, parsedPlace({ name: "Rained out" }));
    assert.ok(onlySkipped.ok);
    const s = await q.createItineraryItem(db, A, ex, visitOf(onlySkipped.id));
    assert.ok(s.ok);
    await q.reviewItineraryItem(db, A, ex, s.id, { status: "skipped" });
    assert.ok(filterPlaces((await q.listPlaces(db, A, ex))!, parseExploreFilters({ status: "unscheduled" })).some((x) => x.name === "Rained out"));
  });
  await check("filters combine kind, priority, status and accent-insensitive name search", async () => {
    const cafe = await q.createPlace(db, A, ex, parsedPlace({ name: "Café Rembrandt", kind: "food", category: "cafe", priority: "must_do" }));
    assert.ok(cafe.ok);
    const all = (await q.listPlaces(db, A, ex))!;
    const run = (query: Record<string, string>) => filterPlaces(all, parseExploreFilters(query)).map((x) => x.name);
    assert.deepEqual(run({ kind: "food" }), ["Café Rembrandt"]);
    assert.deepEqual(run({ q: "cafe" }), ["Café Rembrandt"]);
    assert.deepEqual(run({ kind: "place", q: "cafe" }), []);
    assert.deepEqual(run({ priority: "must_do", kind: "food", status: "unscheduled" }), ["Café Rembrandt"]);
    assert.equal(run({ kind: "bogus", status: "bogus" }).length, all.length, "unknown values fall back to all");
  });
  await check("scheduling from Explore shows on the itinerary; completing it there updates Explore", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Alto Vista Chapel" }));
    assert.ok(p.ok);
    const v = await q.createItineraryItem(db, A, ex, visitOf(p.id, { local_date: "2026-10-17", local_start_time: "08:00", planning_notes: "Before the heat" }), { requestId: randomUUID() });
    assert.ok(v.ok);
    const trip = (await q.getTripWithDetails(db, A, ex))!;
    const agenda = buildAgenda({ items: (await q.listItinerary(db, A, ex))!, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date });
    const entry = agenda.days.find((d) => d.date === "2026-10-17")!.entries.find((e) => e.key === `i:${v.id}`)!;
    assert.equal(entry.item?.place?.name, "Alto Vista Chapel");
    assert.equal((await placeRow(p.id))?.planned_count, 1);
    await q.reviewItineraryItem(db, A, ex, v.id, { status: "completed" });
    const row = (await placeRow(p.id))!;
    assert.deepEqual([row.planned_count, row.completed_count, row.visited], [0, 1, true]);
  });
  await check("record a visit never guesses: planned visits must be chosen, then it completes that one", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Zeerovers", kind: "food", category: "restaurant" }));
    assert.ok(p.ok);
    const planned = await q.createItineraryItem(db, A, ex, visitOf(p.id, { category: "food", local_date: "2026-10-16", planning_notes: "Cash only" }));
    assert.ok(planned.ok);
    const input = { date: "2026-10-15", rating: 5, reflection: "Best fried fish", is_favorite: true };
    const auto = await q.recordPlaceVisit(db, A, ex, p.id, input, { type: "auto" });
    assert.ok(!auto.ok && auto.reason === "has_planned_visits");
    assert.deepEqual(auto.visits, [{ id: planned.id, local_date: "2026-10-16" }]);
    assert.equal((await placeRow(p.id))?.visit_count, 1, "nothing was created");
    const done = await q.recordPlaceVisit(db, A, ex, p.id, input, { type: "complete", itemId: planned.id });
    assert.deepEqual(done, { ok: true, id: planned.id, completedExisting: true });
    const item = (await q.listItinerary(db, A, ex))!.find((i) => i.id === planned.id)!;
    assert.deepEqual(
      [item.status, item.local_date, item.planning_notes, item.rating, item.reflection, item.is_favorite, Boolean(item.completed_at)],
      ["completed", "2026-10-16", "Cash only", 5, "Best fried fish", true, true],
    );
    // The completed visit is a memory (Memories reads completed itinerary rows).
    const memories = (await q.listItinerary(db, A, ex, { completedOnly: true }))!;
    assert.ok(memories.some((m) => m.id === planned.id && m.place?.name === "Zeerovers"));
    // Completing it again (stale choice) is refused.
    assert.deepEqual(await q.recordPlaceVisit(db, A, ex, p.id, input, { type: "complete", itemId: planned.id }), { ok: false, reason: "visit_not_planned" });
  });
  await check("record a new completed visit: idempotent, in the itinerary and Memories", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Arikok" }));
    assert.ok(p.ok);
    const requestId = randomUUID();
    const input = { date: "2026-10-15", rating: null, reflection: null, is_favorite: false };
    const first = await q.recordPlaceVisit(db, A, ex, p.id, input, { type: "auto" }, requestId);
    const again = await q.recordPlaceVisit(db, A, ex, p.id, input, { type: "auto" }, requestId);
    assert.ok(first.ok && again.ok && first.id === requestId && again.id === requestId);
    const row = (await placeRow(p.id))!;
    assert.deepEqual([row.completed_count, row.rating_avg, row.rated_count], [1, null, 0], "unrated: no rating shown");
    const item = (await q.listItinerary(db, A, ex))!.find((i) => i.id === first.id)!;
    assert.deepEqual([item.status, item.local_date, item.timezone, item.category], ["completed", "2026-10-15", "America/Aruba", "sightseeing"]);
    const memories = await q.listItinerary(db, A, ex, { completedOnly: true });
    assert.ok(memories!.some((m) => m.id === first.id));
    const extra = await q.recordPlaceVisit(db, A, ex, p.id, { ...input, rating: 3 }, { type: "new" });
    assert.ok(extra.ok && extra.id !== first.id, "a second visit is allowed when asked for");
  });
  await check("record-a-visit and planned-visit choices can't cross trips or owners", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Mine" }));
    const other = await q.createPlace(db, A, exOther, parsedPlace({ name: "Other trip" }));
    assert.ok(p.ok && other.ok);
    const otherVisit = await q.createItineraryItem(db, A, exOther, visitOf(other.id));
    assert.ok(otherVisit.ok);
    const input = { date: "2026-10-15", rating: null, reflection: null, is_favorite: false };
    assert.deepEqual(await q.recordPlaceVisit(db, B, exB, p.id, input, { type: "new" }), { ok: false, reason: "place_not_in_trip" });
    assert.deepEqual(await q.recordPlaceVisit(db, B, ex, p.id, input, { type: "new" }), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.recordPlaceVisit(db, A, ex, other.id, input, { type: "new" }), { ok: false, reason: "place_not_in_trip" });
    assert.deepEqual(await q.recordPlaceVisit(db, A, ex, p.id, input, { type: "complete", itemId: otherVisit.id }), { ok: false, reason: "visit_not_planned" });
    assert.equal((await q.listItinerary(db, A, exOther))!.find((i) => i.id === otherVisit.id)?.status, "planned");
    assert.deepEqual(await q.createItineraryItem(db, A, ex, visitOf(other.id)), { ok: false, reason: "place_not_in_trip" });
    assert.equal(await q.updatePlace(db, B, ex, p.id, parsedPlace({ name: "hijacked" })), false);
    assert.equal(await q.updatePlace(db, A, exOther, p.id, parsedPlace({ name: "wrong trip" })), false);
    assert.equal((await placeRow(p.id))?.name, "Mine");
  });
  await check("editing a place updates every linked visit and memory; visit notes and reflections stay on the visit", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Old name", address: "Old address" }));
    assert.ok(p.ok);
    const v = await q.createItineraryItem(db, A, ex, visitOf(p.id, { planning_notes: "Visit note" }));
    assert.ok(v.ok);
    await q.reviewItineraryItem(db, A, ex, v.id, { status: "completed", reflection: "Loved it" });
    await q.updatePlace(db, A, ex, p.id, parsedPlace({ name: "New name", address: "New address", maps_url: "https://maps.app.goo.gl/new" }));
    const entry = (await q.listItinerary(db, A, ex))!.find((i) => i.id === v.id)!;
    assert.deepEqual([entry.place?.name, entry.place?.address, entry.place?.maps_url], ["New name", "New address", "https://maps.app.goo.gl/new"]);
    assert.deepEqual([entry.title, entry.planning_notes, entry.reflection], [null, "Visit note", "Loved it"]);
    const memory = (await q.listItinerary(db, A, ex, { completedOnly: true }))!.find((i) => i.id === v.id)!;
    assert.equal(memory.place?.name, "New name");
  });
  await check("deleting a visit keeps the place; deleting a place with visits is explained, then keeps them", async () => {
    const p = await q.createPlace(db, A, ex, parsedPlace({ name: "Keep me" }));
    assert.ok(p.ok);
    const a = await q.createItineraryItem(db, A, ex, visitOf(p.id));
    const b = await q.createItineraryItem(db, A, ex, visitOf(p.id));
    assert.ok(a.ok && b.ok);
    await q.reviewItineraryItem(db, A, ex, b.id, { status: "completed", reflection: "Worth it" });
    assert.equal(await q.deleteItineraryItem(db, A, ex, a.id), true);
    assert.equal((await placeRow(p.id))?.visit_count, 1);
    assert.deepEqual(await q.deletePlace(db, A, ex, p.id, "block"), { ok: false, reason: "has_visits", visits: 1 });
    assert.deepEqual(await q.deletePlace(db, A, ex, p.id, "detach"), { ok: true, detachedVisits: 1 });
    const kept = (await q.listItinerary(db, A, ex))!.find((i) => i.id === b.id)!;
    assert.deepEqual([kept.place_id, kept.title, kept.reflection], [null, "Keep me", "Worth it"]);
  });
}

/** Packing tab: item/category operations, order, progress, reset, starter and copy-from-trip. */
async function packingTabChecks() {
  console.log("Packing tab");
  const pk = (await q.createTrip(db, A, tripInput("A packing trip"))).id;
  const src = (await q.createTrip(db, A, tripInput("A packing source"))).id;
  const pkB = (await q.createTrip(db, B, tripInput("B packing trip"))).id;
  const list = async (owner = A, trip = pk) => (await q.getPacking(db, owner, trip))!;
  const raw = (category_id: string, over: Record<string, string> = {}) =>
    packingItemSchema.parse({ category_id, label: "Sunscreen", quantity: "", traveler_name: "", notes: "", ...over });
  const add = async (category_id: string, label: string, over: Record<string, string> = {}, trip = pk, owner = A) => {
    const made = await q.createPackingItem(db, owner, trip, raw(category_id, { label, ...over }));
    assert.ok(made.ok, `add ${label}`);
    return made.id;
  };
  const snapshot = async (trip: string) =>
    (await list(A, trip)).map((c) => [c.name, c.sort_order, c.items.map((i) => [i.id, i.label, i.quantity, i.traveler_name, i.notes, i.is_packed, i.sort_order, i.updated_at])]);

  const beach = await categoryId(A, pk, "Beach");
  const clothes = await categoryId(A, pk, "Clothes");

  await check("items persist with quantity, traveler and notes; edits change them; new ones go last", async () => {
    const hat = await add(beach, "Hat");
    const towel = await add(beach, "Towels", { quantity: "4", traveler_name: "Maya", notes: "Big ones" });
    let rows = (await list())[0].items;
    assert.deepEqual(rows.map((i) => [i.label, i.quantity, i.traveler_name, i.notes, i.is_packed]), [
      ["Hat", 1, null, null, false],
      ["Towels", 4, "Maya", "Big ones", false],
    ]);
    assert.deepEqual(await q.updatePackingItem(db, A, pk, hat, raw(beach, { label: "Sun hat", quantity: "2", traveler_name: "Leo", notes: "Wide brim" })), { ok: true, id: hat });
    rows = (await list())[0].items;
    assert.deepEqual([rows[0].label, rows[0].quantity, rows[0].traveler_name, rows[0].notes], ["Sun hat", 2, "Leo", "Wide brim"]);
    assert.ok(rows[0].sort_order < rows.find((i) => i.id === towel)!.sort_order);
  });

  await check("editing an item into another category moves it there, last, keeping its packed state", async () => {
    const tee = await add(clothes, "T-shirts");
    const hat = (await list())[0].items[0];
    await q.setPackingItemPacked(db, A, pk, hat.id, true);
    assert.ok((await q.updatePackingItem(db, A, pk, hat.id, raw(clothes, { label: hat.label }))).ok);
    const c = (await list())[1];
    assert.deepEqual(c.items.map((i) => i.id), [tee, hat.id]);
    assert.equal(c.items[1].is_packed, true);
    // Moving back with the dedicated move.
    assert.deepEqual(await q.movePackingItem(db, A, pk, hat.id, beach), { ok: true, id: hat.id });
    assert.equal((await list())[0].items.at(-1)!.id, hat.id);
  });

  await check("packed is set, not toggled: repeating the same request keeps the value", async () => {
    const id = (await list())[0].items[0].id;
    assert.equal(await q.setPackingItemPacked(db, A, pk, id, true), true);
    assert.equal(await q.setPackingItemPacked(db, A, pk, id, true), true);
    assert.equal((await list())[0].items[0].is_packed, true);
    // Concurrent opposite writes end at whichever ran last — never a flip of a flip.
    await Promise.all([q.setPackingItemPacked(db, A, pk, id, false), q.setPackingItemPacked(db, A, pk, id, false)]);
    assert.equal((await list())[0].items[0].is_packed, false);
  });

  await check("progress from saved rows: empty, partial and complete", async () => {
    const empty = await categoryId(A, src, "Nothing yet");
    assert.deepEqual(progressOf((await list(A, src)).flatMap((c) => c.items)), { total: 0, packed: 0, remaining: 0, percent: 0 });
    const all = (await list()).flatMap((c) => c.items);
    for (const i of all) await q.setPackingItemPacked(db, A, pk, i.id, false);
    await q.setPackingItemPacked(db, A, pk, all[0].id, true);
    const partial = progressOf((await list()).flatMap((c) => c.items));
    assert.deepEqual(partial, { total: all.length, packed: 1, remaining: all.length - 1, percent: Math.floor(100 / all.length) });
    for (const i of all) await q.setPackingItemPacked(db, A, pk, i.id, true);
    assert.equal(progressOf((await list()).flatMap((c) => c.items)).percent, 100);
    assert.deepEqual(await q.deletePackingCategory(db, A, src, empty, { items: "none" }), { ok: true, affectedItems: 0 });
  });

  await check("mark everything unpacked: whole trip only, nothing deleted, owner-only", async () => {
    const other = await categoryId(A, src, "Kept packed");
    const otherItem = await add(other, "Charger", {}, src);
    await q.setPackingItemPacked(db, A, src, otherItem, true);
    const before = (await list()).flatMap((c) => c.items).length;
    assert.equal(await q.unpackAllPackingItems(db, B, pk), null);
    assert.ok((await list()).flatMap((c) => c.items).every((i) => i.is_packed));
    assert.equal(await q.unpackAllPackingItems(db, A, pk), before);
    const after = (await list()).flatMap((c) => c.items);
    assert.equal(after.length, before);
    assert.ok(after.every((i) => !i.is_packed));
    assert.equal((await list(A, src))[0].items[0].is_packed, true);
    assert.deepEqual(await q.deletePackingCategory(db, A, src, other, { items: "delete" }), { ok: true, affectedItems: 1 });
  });

  await check("a repeated item create (same request id) adds one row; another owner can't reuse it", async () => {
    const requestId = randomUUID();
    const [a, b] = await Promise.all([
      q.createPackingItem(db, A, pk, raw(clothes, { label: "Socks" }), requestId),
      q.createPackingItem(db, A, pk, raw(clothes, { label: "Socks" }), requestId),
    ]);
    assert.deepEqual([a, b], [{ ok: true, id: requestId }, { ok: true, id: requestId }]);
    assert.equal((await list())[1].items.filter((i) => i.label === "Socks").length, 1);
    const bCat = await categoryId(B, pkB, "B things");
    assert.deepEqual(await q.createPackingItem(db, B, pkB, raw(bCat), requestId), { ok: false, reason: "not_found" });
  });

  await check("item order persists; stale, cross-trip and cross-owner orders change nothing", async () => {
    const before = (await list())[0].items.map((i) => i.id);
    const reversed = [...before].reverse();
    assert.deepEqual(await q.reorderPackingItems(db, A, pk, beach, reversed), { ok: true });
    assert.deepEqual((await list())[0].items.map((i) => i.id), reversed);
    // Missing one, an item from another category, a duplicate: all stale.
    assert.deepEqual(await q.reorderPackingItems(db, A, pk, beach, reversed.slice(1)), { ok: false, reason: "stale" });
    const clothesItem = (await list())[1].items[0].id;
    assert.deepEqual(await q.reorderPackingItems(db, A, pk, beach, [...reversed.slice(1), clothesItem]), { ok: false, reason: "stale" });
    assert.deepEqual(await q.reorderPackingItems(db, A, pk, beach, [reversed[0], ...reversed.slice(0, -1)]), { ok: false, reason: "stale" });
    assert.deepEqual(await q.reorderPackingItems(db, B, pk, beach, before), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.reorderPackingItems(db, A, src, beach, before), { ok: false, reason: "not_found" });
    assert.deepEqual((await list())[0].items.map((i) => i.id), reversed);
  });

  await check("categories: add, rename (names unique per trip, case/accents ignored), reorder", async () => {
    assert.deepEqual(await q.createPackingCategory(db, A, pk, { name: "  beach" }), { ok: false, reason: "duplicate_name" });
    assert.deepEqual(await q.createPackingCategory(db, A, pk, { name: "BÉACH" }), { ok: false, reason: "duplicate_name" });
    assert.deepEqual(await q.updatePackingCategory(db, A, pk, clothes, { name: "beach" }), { ok: false, reason: "duplicate_name" });
    assert.deepEqual(await q.updatePackingCategory(db, A, pk, clothes, { name: "clothes" }), { ok: true, id: clothes }); // own name, new case
    assert.deepEqual(await q.updatePackingCategory(db, A, pk, clothes, { name: "Clothes" }), { ok: true, id: clothes });
    const docs = await categoryId(A, pk, "Docs");
    const ids = (await list()).map((c) => c.id);
    assert.deepEqual(ids, [beach, clothes, docs]);
    assert.deepEqual(await q.reorderPackingCategories(db, A, pk, [docs, beach, clothes]), { ok: true });
    assert.deepEqual((await list()).map((c) => c.id), [docs, beach, clothes]);
    assert.deepEqual(await q.reorderPackingCategories(db, A, pk, [docs, beach]), { ok: false, reason: "stale" });
    assert.deepEqual(await q.reorderPackingCategories(db, B, pk, [docs, beach, clothes]), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.deletePackingCategory(db, A, pk, docs, { items: "none" }), { ok: true, affectedItems: 0 });
  });

  await check("moving items and deleting categories never loses items unexpectedly", async () => {
    const otherTripCat = await categoryId(A, src, "Source only");
    const item = (await list())[0].items[0].id;
    assert.deepEqual(await q.movePackingItem(db, A, pk, item, otherTripCat), { ok: false, reason: "category_not_in_trip" });
    assert.deepEqual(await q.movePackingItem(db, B, pk, item, clothes), { ok: false, reason: "not_found" });
    const total = (await list()).flatMap((c) => c.items).length;
    const inBeach = (await list())[0].items.length;
    // No choice → refused, everything kept.
    assert.deepEqual(await q.deletePackingCategory(db, A, pk, beach, { items: "none" }), { ok: false, reason: "has_items", items: inBeach });
    assert.deepEqual(await q.deletePackingCategory(db, A, pk, beach, { items: "move", target_category_id: otherTripCat }), { ok: false, reason: "target_not_found" });
    assert.equal((await list()).flatMap((c) => c.items).length, total);
    assert.deepEqual(await q.deletePackingCategory(db, A, pk, beach, { items: "move", target_category_id: clothes }), { ok: true, affectedItems: inBeach });
    const after = await list();
    assert.deepEqual(after.map((c) => c.name), ["Clothes"]);
    assert.equal(after[0].items.length, total);
    assert.deepEqual(await q.deletePackingCategory(db, A, src, otherTripCat, { items: "none" }), { ok: true, affectedItems: 0 });
  });

  await check("starter: adds only missing items; applying twice adds nothing; owner-only", async () => {
    const fresh = (await q.createTrip(db, A, tripInput("A starter trip"))).id;
    const mine = await categoryId(A, fresh, "beach");
    await add(mine, "sunscreen", {}, fresh);
    assert.deepEqual(await q.applyPackingStarter(db, B, fresh, ["beach"]), { ok: false, reason: "not_found" });
    assert.deepEqual(await q.applyPackingStarter(db, A, fresh, []), { ok: false, reason: "nothing_selected" });
    const beachItems = STARTER_CATEGORIES.find((c) => c.key === "beach")!.items.length;
    const babyItems = STARTER_CATEGORIES.find((c) => c.key === "baby")!.items.length;
    const first = await q.applyPackingStarter(db, A, fresh, ["beach", "baby"]);
    assert.deepEqual(first, { ok: true, addedItems: beachItems - 1 + babyItems, skippedItems: 1, newCategories: 1 });
    const again = await q.applyPackingStarter(db, A, fresh, ["beach", "baby"]);
    assert.deepEqual(again, { ok: true, addedItems: 0, skippedItems: beachItems + babyItems, newCategories: 0 });
    const lists = await list(A, fresh);
    assert.deepEqual(lists.map((c) => c.name), ["beach", "Baby"]); // existing name kept, new one appended
    assert.equal(lists[0].items[0].label, "sunscreen"); // existing item untouched
    assert.equal(lists[0].items.filter((i) => normalizeName(i.label) === "sunscreen").length, 1);
  });

  await check("copy from another trip: unpacked, source unchanged, independent afterwards", async () => {
    const docs = await categoryId(A, src, "Documents");
    const kids = await categoryId(A, src, "Kids");
    await add(docs, "Passports", { quantity: "4", notes: "In the blue folder" }, src);
    const shoes = await add(kids, "Water shoes", { quantity: "2", traveler_name: "Maya" }, src);
    for (const i of (await list(A, src)).flatMap((c) => c.items)) await q.setPackingItemPacked(db, A, src, i.id, true);
    const before = await snapshot(src);

    const dest = (await q.createTrip(db, A, tripInput("A copy target"))).id;
    const copied = await q.copyPackingFromTrip(db, A, dest, src, "all");
    assert.deepEqual(copied, { ok: true, addedItems: 2, skippedItems: 0, newCategories: 2 });
    const out = await list(A, dest);
    assert.deepEqual(out.map((c) => c.name), ["Documents", "Kids"]);
    assert.deepEqual(
      out.flatMap((c) => c.items.map((i) => [i.label, i.quantity, i.traveler_name, i.notes, i.is_packed])),
      [["Passports", 4, null, "In the blue folder", false], ["Water shoes", 2, "Maya", null, false]],
    );
    const sourceIds = new Set((await list(A, src)).flatMap((c) => [c.id, ...c.items.map((i) => i.id)]));
    assert.ok(out.every((c) => !sourceIds.has(c.id) && c.items.every((i) => !sourceIds.has(i.id) && i.trip_id === dest)));
    assert.deepEqual(await snapshot(src), before);

    // Independent: editing, ticking or deleting the copy leaves the source alone, and vice versa.
    const copyShoes = out[1].items[0];
    await q.updatePackingItem(db, A, dest, copyShoes.id, raw(out[1].id, { label: "Sandals", quantity: "1" }));
    await q.setPackingItemPacked(db, A, dest, copyShoes.id, true);
    await q.deletePackingCategory(db, A, dest, out[0].id, { items: "delete" });
    assert.deepEqual(await snapshot(src), before);
    await q.updatePackingItem(db, A, src, shoes, raw(kids, { label: "Flip-flops", traveler_name: "Maya" }));
    assert.equal((await list(A, dest))[0].items[0].label, "Sandals");
  });

  await check("copy into a list that has items adds missing ones only; chosen categories only; repeat adds nothing", async () => {
    const dest = (await q.createTrip(db, A, tripInput("A merge target"))).id;
    const kids = await categoryId(A, dest, "kids");
    await add(kids, "flip-flops", { traveler_name: "maya" }, dest);
    const srcCats = await list(A, src);
    const kidsSrc = srcCats.find((c) => c.name === "Kids")!;
    const merged = await q.copyPackingFromTrip(db, A, dest, src, [kidsSrc.id]);
    assert.deepEqual(merged, { ok: true, addedItems: 0, skippedItems: 1, newCategories: 0 });
    const all = await q.copyPackingFromTrip(db, A, dest, src, "all");
    assert.deepEqual(all, { ok: true, addedItems: 1, skippedItems: 1, newCategories: 1 });
    assert.deepEqual(await q.copyPackingFromTrip(db, A, dest, src, "all"), { ok: true, addedItems: 0, skippedItems: 2, newCategories: 0 });
    const out = await list(A, dest);
    assert.deepEqual(out.map((c) => [c.name, c.items.map((i) => i.label)]), [["kids", ["flip-flops"]], ["Documents", ["Passports"]]]);
  });

  await check("copy is refused from another owner's trip, unknown categories, itself, or into someone else's trip", async () => {
    const dest = (await q.createTrip(db, A, tripInput("A guarded target"))).id;
    const bCat = await categoryId(B, pkB, "B secret");
    await add(bCat, "B's item", {}, pkB, B);
    assert.deepEqual(await q.copyPackingFromTrip(db, A, dest, pkB, "all"), { ok: false, reason: "source_not_found" });
    assert.deepEqual(await q.copyPackingFromTrip(db, A, dest, src, [bCat]), { ok: false, reason: "source_not_found" });
    const srcCat = (await list(A, src))[0].id;
    assert.deepEqual(await q.copyPackingFromTrip(db, A, dest, src, [srcCat, bCat]), { ok: false, reason: "source_not_found" });
    assert.deepEqual(await q.copyPackingFromTrip(db, A, dest, src, [randomUUID()]), { ok: false, reason: "source_not_found" });
    assert.deepEqual(await q.copyPackingFromTrip(db, A, src, src, "all"), { ok: false, reason: "source_not_found" });
    assert.deepEqual(await q.copyPackingFromTrip(db, B, pkB, src, "all"), { ok: false, reason: "source_not_found" });
    assert.deepEqual(await q.copyPackingFromTrip(db, B, dest, src, "all"), { ok: false, reason: "not_found" });
    assert.equal(await count("packing_items", dest), 0);
    assert.equal(await count("packing_categories", dest), 0);
    // Sources list only the owner's other trips.
    const sources = await q.listPackingSources(db, A, dest);
    assert.ok(!sources.some((s) => s.id === dest || s.id === pkB));
    assert.ok(sources.some((s) => s.id === src && s.categories.some((c) => c.items.length > 0)));
    assert.ok((await q.listPackingSources(db, B, pkB)).every((s) => s.id !== src));
  });
}

/** Trip dates relative to today where the trip happens, so "past" and "now" stay true whenever this runs. */
const relativeTrip = (title: string, fromDays: number, toDays: number): TripInput => {
  const today = todayInTimeZone("America/Aruba");
  return { ...tripInput(title), start_date: addDays(today, fromDays), end_date: addDays(today, toDays) };
};

const done = (over: Partial<{ rating: number | null; reflection: string | null; is_favorite: boolean }> = {}) => ({
  rating: null,
  reflection: null,
  is_favorite: false,
  ...over,
});

async function memoriesTabChecks() {
  console.log("Memories tab");
  const past = (await q.createTrip(db, A, relativeTrip("A past trip", -10, -5))).id;
  const pastStart = addDays(todayInTimeZone("America/Aruba"), -10);
  const now = (await q.createTrip(db, A, relativeTrip("A current trip", -1, 3))).id;
  const tripB = (await q.createTrip(db, B, relativeTrip("B trip", -10, -5))).id;
  const memories = async (owner = A, trip = past) => (await q.listItinerary(db, owner, trip, { completedOnly: true }))!;

  await check("summary and album save separately without erasing each other; nothing to save → refused", async () => {
    const summary = tripSummarySchema.parse({ overall_rating: "4", summary: "Windy, wonderful", favorite_moment: "", would_return: "undecided", lessons_for_next_time: "Book the jeep early" });
    assert.equal(await q.saveTripMemory(db, A, past, summary), true);
    assert.equal((await q.getTripMemory(db, A, past))?.photo_album_url, null);
    assert.equal(await q.saveTripMemory(db, A, past, { photo_album_url: "https://photos.app.goo.gl/abc" }), true);
    let m = (await q.getTripMemory(db, A, past))!;
    assert.deepEqual([m.overall_rating, m.summary, m.would_return, m.lessons_for_next_time, m.photo_album_url], [4, "Windy, wonderful", "undecided", "Book the jeep early", "https://photos.app.goo.gl/abc"]);
    // Editing the reflection keeps the album; removing the album keeps the reflection.
    assert.equal(await q.saveTripMemory(db, A, past, { ...summary, overall_rating: null, would_return: "no" }), true);
    assert.equal(await q.saveTripMemory(db, A, past, { photo_album_url: null }), true);
    m = (await q.getTripMemory(db, A, past))!;
    assert.deepEqual([m.overall_rating, m.summary, m.would_return, m.photo_album_url], [null, "Windy, wonderful", "no", null]);
    assert.equal(await q.saveTripMemory(db, A, past, {}), false);
    assert.equal(await count("trip_memories", past), 1);
  });

  await check("concurrent first saves converge on one summary row (atomic upsert on trip_id)", async () => {
    const t = (await q.createTrip(db, A, relativeTrip("A race trip", -10, -5))).id;
    const results = await Promise.all([
      q.saveTripMemory(db, A, t, { summary: "From tab one" }),
      q.saveTripMemory(db, A, t, { photo_album_url: "https://photos.app.goo.gl/race" }),
      q.saveTripMemory(db, A, t, { overall_rating: 5 }),
      q.saveTripMemory(db, A, t, { would_return: "yes" }),
    ]);
    assert.deepEqual(results, [true, true, true, true]);
    assert.equal(await count("trip_memories", t), 1);
    const m = (await q.getTripMemory(db, A, t))!;
    assert.deepEqual([m.summary, m.photo_album_url, m.overall_rating, m.would_return], ["From tab one", "https://photos.app.goo.gl/race", 5, "yes"]);
  });

  await check("database keeps undecided distinct and rejects unknown answers, bad ratings and http albums", async () => {
    await assert.rejects(db.execute(sql`update trip_memories set would_return = 'maybe' where trip_id = ${past}`));
    await assert.rejects(db.execute(sql`update trip_memories set overall_rating = 6 where trip_id = ${past}`));
    await assert.rejects(db.execute(sql`update trip_memories set photo_album_url = 'http://x.test' where trip_id = ${past}`));
    assert.equal((await q.getTripMemory(db, A, past))?.would_return, "no");
  });

  await check("B can't read, save or clear A's trip summary, even through B's own trip id", async () => {
    assert.equal(await q.getTripMemory(db, B, past), undefined);
    assert.equal(await q.saveTripMemory(db, B, past, { summary: "hijacked" }), false);
    assert.equal(await q.saveTripMemory(db, B, past, { photo_album_url: "https://evil.test/x" }), false);
    assert.equal(await q.deleteTripMemory(db, B, past), false);
    assert.equal((await q.getTripMemory(db, A, past))?.summary, "Windy, wonderful");
    assert.equal(await q.getTripMemory(db, B, tripB), null);
  });

  await check("capture a new moment: completed, reviewed, idempotent (repeat + concurrent), in Memories and the itinerary", async () => {
    const requestId = randomUUID();
    const input = visit({ title: "Sunset at California Lighthouse", local_date: addDays(pastStart, 2) });
    const opts = { completed: done({ rating: 5, reflection: "Kids loved it", is_favorite: true }), requestId };
    const [a, b] = await Promise.all([q.createItineraryItem(db, A, past, input, opts), q.createItineraryItem(db, A, past, input, opts)]);
    const again = await q.createItineraryItem(db, A, past, input, opts);
    assert.ok(a.ok && b.ok && again.ok);
    assert.equal(a.id, requestId);
    assert.equal(b.id, requestId);
    assert.equal(again.id, requestId);
    const rows = (await memories()).filter((v) => v.title === "Sunset at California Lighthouse");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].status, rows[0].rating, rows[0].reflection, rows[0].is_favorite], ["completed", 5, "Kids loved it", true]);
    assert.ok(rows[0].completed_at);
    assert.ok((await q.listItinerary(db, A, past))!.some((v) => v.id === requestId), "the same row is on the itinerary");
  });

  await check("capture refuses days outside the trip, days still ahead, bookings, and other owners' trips", async () => {
    const today = todayInTimeZone("America/Aruba");
    assert.deepEqual(await q.createItineraryItem(db, A, past, visit({ local_date: addDays(pastStart, -1) }), { completed: done() }), { ok: false, reason: "outside_trip" });
    assert.deepEqual(await q.createItineraryItem(db, A, now, visit({ local_date: addDays(today, 1) }), { completed: done() }), { ok: false, reason: "in_future" });
    const ok = await q.createItineraryItem(db, A, now, visit({ title: "Today’s swim", local_date: today }), { completed: done() });
    assert.ok(ok.ok, "today is allowed");
    const r = (await q.createReservation(db, A, now, { ...flight, start_date: today, end_date: today }))!.id;
    assert.deepEqual(await q.createItineraryItem(db, A, now, visit({ reservation_id: r, local_date: null }), { completed: done() }), { ok: false, reason: "reservation_backed" });
    assert.deepEqual(await q.createItineraryItem(db, B, past, visit({ local_date: pastStart }), { completed: done() }), { ok: false, reason: "not_found" });
    // A requestId already used by A's row can't be claimed by B (no leak, no write).
    const used = (await memories())[0].id;
    assert.deepEqual(await q.createItineraryItem(db, B, tripB, visit({ local_date: addDays(pastStart, 1) }), { completed: done(), requestId: used }), { ok: false, reason: "not_found" });
    assert.equal(await count("itinerary_items", tripB), 0);
  });

  await check("B can't review, favorite or delete A's visits", async () => {
    const v = (await memories())[0];
    assert.equal(await q.reviewItineraryItem(db, B, past, v.id, { is_favorite: false, reflection: "hijacked" }), false);
    assert.equal(await q.reviewItineraryItem(db, B, tripB, v.id, { rating: 1 }), false);
    assert.equal(await q.deleteItineraryItem(db, B, past, v.id), false);
    const after = (await memories()).find((x) => x.id === v.id)!;
    assert.deepEqual([after.reflection, after.is_favorite, after.rating], [v.reflection, v.is_favorite, v.rating]);
    assert.equal(await q.listItinerary(db, B, past, { completedOnly: true }), null);
  });

  await check("capture + save to Explore links the existing place (no duplicate) and marks it visited", async () => {
    const p = await q.createPlace(db, A, past, { ...placeInput("Baby Beach"), kind: "place", category: "beach" });
    assert.ok(p.ok);
    const made = await q.createItineraryItem(db, A, past, visit({ title: "baby beach", category: "sightseeing", local_date: addDays(pastStart, 3) }), { completed: done({ rating: 4 }), saveToExplore: true });
    assert.ok(made.ok && made.explorePlace === "existing");
    const places = (await q.listPlaces(db, A, past))!.filter((x) => x.name.toLowerCase() === "baby beach");
    assert.equal(places.length, 1);
    assert.deepEqual([places[0].visited, places[0].completed_count, places[0].rating_avg], [true, 1, 4]);
  });

  await check("repeat visits stay separate memories; editing one shows in the itinerary and Explore", async () => {
    const p = await q.createPlace(db, A, past, placeInput("Zeerovers"));
    assert.ok(p.ok);
    const first = await q.recordPlaceVisit(db, A, past, p.id, { date: addDays(pastStart, 1), rating: 5, reflection: null, is_favorite: false }, { type: "new" });
    const second = await q.recordPlaceVisit(db, A, past, p.id, { date: addDays(pastStart, 4), rating: null, reflection: null, is_favorite: false }, { type: "new" });
    assert.ok(first.ok && second.ok);
    const visits = (await memories()).filter((v) => v.place_id === p.id);
    assert.equal(visits.length, 2);
    // Edit from Memories: same row the itinerary and Explore read.
    assert.equal(await q.reviewItineraryItem(db, A, past, second.id, { rating: 3, reflection: "Busier second time", is_favorite: true }), true);
    const itineraryRow = (await q.listItinerary(db, A, past))!.find((v) => v.id === second.id)!;
    assert.deepEqual([itineraryRow.rating, itineraryRow.reflection, itineraryRow.is_favorite], [3, "Busier second time", true]);
    const place = (await q.listPlaces(db, A, past))!.find((x) => x.id === p.id)!;
    assert.deepEqual([place.completed_count, place.rated_count, place.rating_avg], [2, 2, 4]);
    const stats = memoryStats(await memories());
    assert.equal(stats.places, 2, "Baby Beach + Zeerovers, repeat visit counted once");
    assert.equal(stats.food, 1);
    assert.ok(stats.completed >= 4);
    // Clearing a rating from Memories leaves an unrated memory.
    assert.equal(await q.reviewItineraryItem(db, A, past, first.id, { rating: null, reflection: null }), true);
    const unrated = (await memories()).find((v) => v.id === first.id)!;
    assert.deepEqual([unrated.status, unrated.rating, unrated.reflection], ["completed", null, null]);
  });

  await check("deleting a reviewed booking keeps its memory; a cancelled booking's review is kept too", async () => {
    const tour = (await q.createReservation(db, A, past, { ...flight, kind: "activity", title: "Catamaran tour", start_date: addDays(pastStart, 2), start_time: "10:00", end_date: addDays(pastStart, 2), end_time: "13:00", end_time_zone: "America/Aruba", start_time_zone: "America/Aruba", details: {} }))!.id;
    const link = await q.ensureReservationVisit(db, A, past, tour);
    assert.ok(link.ok);
    await q.reviewItineraryItem(db, A, past, link.id, { status: "completed", rating: 5, reflection: "Saw turtles" });
    assert.ok((await memories()).some((v) => v.id === link.id && v.reservation?.title === "Catamaran tour"));
    // Cancelled afterwards: still a memory, still linked.
    await q.updateReservation(db, A, past, tour, { ...flight, kind: "activity", status: "cancelled", title: "Catamaran tour", start_date: addDays(pastStart, 2), start_time: "10:00", end_date: addDays(pastStart, 2), end_time: "13:00", end_time_zone: "America/Aruba", start_time_zone: "America/Aruba", details: {} });
    assert.equal((await memories()).find((v) => v.id === link.id)?.reservation?.status, "cancelled");
    assert.deepEqual(await q.deleteReservation(db, A, past, tour), { keptVisits: 1 });
    const kept = (await memories()).find((v) => v.id === link.id)!;
    assert.deepEqual([kept.reservation_id, kept.title, kept.reflection, kept.rating, kept.local_date, kept.local_start_time], [null, "Catamaran tour", "Saw turtles", 5, addDays(pastStart, 2), "10:00:00"]);
  });

  await check("deleting a place (keeping visits) and shortening the trip never drop memories", async () => {
    const before = (await memories()).length;
    const zeerovers = (await q.listPlaces(db, A, past))!.find((x) => x.name === "Zeerovers")!;
    assert.deepEqual(await q.deletePlace(db, A, past, zeerovers.id, "detach"), { ok: true, detachedVisits: 2 });
    assert.equal((await memories()).filter((v) => v.title === "Zeerovers").length, 2);
    const t = (await q.getTripWithDetails(db, A, past))!;
    await q.updateTrip(db, A, past, { ...relativeTrip("A past trip", -10, -9), cover_image: t.cover_image });
    const after = await memories();
    assert.equal(after.length, before);
    const days = groupVisitsByDay(after, addDays(pastStart, 0), addDays(pastStart, 1));
    assert.ok(days.some((d) => d.dayNumber === null && d.visits.length > 0), "visits now outside the trip are listed, not hidden");
  });
}

/**
 * The end-to-end workflow at the data layer, as two owners. Sign-in, the
 * refresh and sign-out/in steps need a browser; here "refresh" is a fresh
 * read through new queries, which is what a reload performs.
 */
async function workflowChecks() {
  console.log("Full workflow (data layer)");
  const today = todayInTimeZone("America/Aruba");
  const d = (n: number) => addDays(today, n);
  let trip = "";
  let other = "";
  let placeId = "";
  let visitId = "";
  let flightId = "";
  let stayId = "";

  await check("2–4. trip with a cross-zone flight and a stay; both appear on the itinerary", async () => {
    trip = (await q.createTrip(db, A, relativeTrip("Workflow trip", -1, 3))).id;
    flightId = (await q.createReservation(db, A, trip, { ...flight, start_date: d(-1), end_date: d(-1) }))!.id;
    stayId = (await q.createReservation(db, A, trip, { ...flight, kind: "lodging", title: "Bucuti Beach Resort", origin: null, destination: null, start_date: d(-1), start_time: "15:00", start_time_zone: "America/Aruba", end_date: d(3), end_time: "11:00", end_time_zone: "America/Aruba", details: {} }))!.id;
    const t = (await q.getTripWithDetails(db, A, trip))!;
    const agenda = buildAgenda({ items: (await q.listItinerary(db, A, trip))!, reservations: t.reservations, tripStart: t.start_date, tripEnd: t.end_date });
    const day1 = agenda.days[0].entries.map((e) => [e.reservation?.id, e.role, e.time]);
    assert.deepEqual(day1, [[flightId, "single", "08:20:00"], [stayId, "start", "15:00:00"]]);
    assert.deepEqual(agenda.days[4].entries.map((e) => [e.reservation?.id, e.role]), [[stayId, "end"]]);
  });

  await check("5–7. restaurant in Explore, scheduled for a day; renaming it updates the itinerary", async () => {
    const p = await q.createPlace(db, A, trip, placeInput("Zeerovers"));
    assert.ok(p.ok);
    placeId = p.id;
    const v = await q.createItineraryItem(db, A, trip, visit({ place_id: placeId, title: null, category: "food", local_date: d(0), local_start_time: "18:30" }));
    assert.ok(v.ok);
    visitId = v.id;
    assert.equal(await q.updatePlace(db, A, trip, placeId, placeInput("Zeerovers Savaneta")), true);
    const entry = (await q.listItinerary(db, A, trip))!.find((x) => x.id === visitId)!;
    assert.equal(entryTitle(entry), "Zeerovers Savaneta");
    const placeRow = (await q.listPlaces(db, A, trip))!.find((x) => x.id === placeId)!;
    assert.deepEqual([placeRow.planned_count, placeRow.visited], [1, false]);
  });

  await check("8–10. complete with rating + reflection → in Memories and visited in Explore; favorite filter", async () => {
    assert.equal(await q.reviewItineraryItem(db, A, trip, visitId, { status: "completed", rating: 5, reflection: "Fresh catch, sunset" }), true);
    let journal = (await q.listItinerary(db, A, trip, { completedOnly: true }))!;
    assert.deepEqual(journal.map((v) => [v.id, entryTitle(v), v.rating, v.reflection]), [[visitId, "Zeerovers Savaneta", 5, "Fresh catch, sunset"]]);
    const placeRow = (await q.listPlaces(db, A, trip))!.find((x) => x.id === placeId)!;
    assert.deepEqual([placeRow.visited, placeRow.completed_count, placeRow.rating_avg], [true, 1, 5]);
    assert.equal(favoriteVisits(journal).length, 0);
    assert.equal(await q.reviewItineraryItem(db, A, trip, visitId, { is_favorite: true }), true);
    journal = (await q.listItinerary(db, A, trip, { completedOnly: true }))!;
    assert.deepEqual(favoriteVisits(journal).map((v) => v.id), [visitId]);
    assert.deepEqual(memoryStats(journal), { completed: 1, places: 1, food: 1 });
  });

  await check("11–14. packing list, progress, copy to another trip: unpacked and independent", async () => {
    const cat = await categoryId(A, trip, "Beach");
    const ids: string[] = [];
    for (const label of ["Sunscreen", "Snorkel", "Hats"]) {
      const made = await q.createPackingItem(db, A, trip, packingItemSchema.parse({ category_id: cat, label, quantity: "", traveler_name: "", notes: "" }));
      assert.ok(made.ok);
      ids.push(made.id);
    }
    await q.setPackingItemPacked(db, A, trip, ids[0], true);
    await q.setPackingItemPacked(db, A, trip, ids[1], true);
    const p = progressOf((await q.getPacking(db, A, trip))!.flatMap((c) => c.items));
    assert.deepEqual([p.packed, p.total, p.percent, p.remaining], [2, 3, 66, 1]);
    other = (await q.createTrip(db, A, relativeTrip("Workflow next trip", 30, 35))).id;
    assert.deepEqual(await q.copyPackingFromTrip(db, A, other, trip, "all"), { ok: true, addedItems: 3, skippedItems: 0, newCategories: 1 });
    const copied = (await q.getPacking(db, A, other))!.flatMap((c) => c.items);
    assert.ok(copied.every((i) => !i.is_packed && !ids.includes(i.id)));
    await q.setPackingItemPacked(db, A, other, copied[2].id, true);
    const source = progressOf((await q.getPacking(db, A, trip))!.flatMap((c) => c.items));
    assert.equal(source.packed, 2, "ticking the copy leaves the source alone");
  });

  await check("15–16. reflection + album saved; a fresh read returns everything", async () => {
    assert.equal(await q.saveTripMemory(db, A, trip, tripSummarySchema.parse({ overall_rating: "5", summary: "Our best beach week", favorite_moment: "Turtles", would_return: "yes", lessons_for_next_time: "" })), true);
    assert.equal(await q.saveTripMemory(db, A, trip, { photo_album_url: "https://photos.app.goo.gl/family" }), true);
    const m = (await q.getTripMemory(db, A, trip))!;
    assert.deepEqual([m.overall_rating, m.summary, m.favorite_moment, m.would_return, m.lessons_for_next_time, m.photo_album_url], [5, "Our best beach week", "Turtles", "yes", null, "https://photos.app.goo.gl/family"]);
    const journal = (await q.listItinerary(db, A, trip, { completedOnly: true }))!;
    assert.deepEqual(journal.map((v) => [v.id, v.is_favorite, v.rating]), [[visitId, true, 5]]);
  });

  await check("17. a second account can't read or change any of it", async () => {
    assert.equal(await q.getTripWithDetails(db, B, trip), null);
    assert.equal(await q.listItinerary(db, B, trip), null);
    assert.equal(await q.listPlaces(db, B, trip), null);
    assert.equal(await q.getPacking(db, B, trip), null);
    assert.equal(await q.getTripMemory(db, B, trip), undefined);
    assert.equal(await q.reviewItineraryItem(db, B, trip, visitId, { is_favorite: false }), false);
    assert.equal(await q.updatePlace(db, B, trip, placeId, placeInput("hijacked")), false);
    assert.equal(await q.saveTripMemory(db, B, trip, { summary: "hijacked" }), false);
    assert.equal(await q.unpackAllPackingItems(db, B, trip), null);
    assert.deepEqual(await q.copyPackingFromTrip(db, B, trip, other, "all"), { ok: false, reason: "not_found" });
    assert.equal(await q.deleteReservation(db, B, trip, flightId), null);
    assert.equal(await q.deleteTrip(db, B, trip), false);
    const t = (await q.getTripWithDetails(db, A, trip))!;
    assert.deepEqual(t.reservations.map((r) => r.id).sort(), [flightId, stayId].sort());
    assert.equal((await q.getTripMemory(db, A, trip))?.summary, "Our best beach week");
    assert.equal((await q.listItinerary(db, A, trip, { completedOnly: true }))![0].is_favorite, true);
  });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

async function cleanup() {
  // Delete only this run's disposable records (cascade removes children).
  await db.delete(trips).where(inArray(trips.owner_id, [A, B]));
  const left = await db.execute(sql`select count(*)::int as n from trips where owner_id in (${A}, ${B})`);
  assert.equal((left.rows[0] as { n: number }).n, 0);
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${passed} checks passed; test records removed.`);
  })
  .catch(async (error) => {
    console.error("\nFAILED:", error);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => pool.end());
