/**
 * Pure checks for the curated Aruba Explore collection — the dataset, the
 * import plan (idempotency, claiming the traveler's own places, duplicate
 * flags), filters / search / ordering, maps links, price arithmetic, the
 * itinerary prefill and the outing conflict checks. No database needed:
 *
 *   npm run test:recommendations
 *   TZ=Pacific/Kiritimati npm run test:recommendations   (and Pacific/Pago_Pago)
 */
import assert from "node:assert/strict";
import { ARUBA_2026_EXPLORE } from "../src/lib/collections/aruba-2026-explore";
import {
  collectionMatchesTrip,
  importMessage,
  planCollectionImport,
  priorityFor,
  recommendationFor,
  stableJson,
  type ExistingPlace,
} from "../src/lib/collections/collection";
import { filterPlaces, mapsLink, parseExploreFilters, sortPlaces } from "../src/lib/explore";
import { addMinutesToTime, checkOuting, type OutingProposal } from "../src/lib/outing-check";
import {
  formatCents,
  isNearStay,
  isShortOuting,
  itineraryCategoryFor,
  itineraryNoteFor,
  priceEstimate,
  recommendationOf,
  suggestedMinutes,
  withServiceCharge,
} from "../src/lib/recommendations";
import type { ItineraryEntry, PlaceWithVisits, Reservation } from "../src/lib/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const C = ARUBA_2026_EXPLORE;
const ZONE = "America/Aruba";

/** The places a first import would create, as Explore reads them back. */
const imported: PlaceWithVisits[] = C.items.map((item) => ({
  id: item.sourceKey,
  trip_id: "t",
  owner_id: "o",
  name: item.name,
  kind: item.kind,
  category: item.category,
  priority: priorityFor(item.recommendation.tier),
  address: null,
  maps_url: null,
  website_url: item.website,
  planning_notes: null,
  is_favorite: false,
  source_key: item.sourceKey,
  recommendation: recommendationFor(C, item),
  created_at: "",
  updated_at: "",
  visit_count: 0,
  planned_count: 0,
  completed_count: 0,
  visited: false,
  rating_avg: null,
  rated_count: 0,
  next_planned_date: null,
  last_completed_date: null,
}));
const byKey = (key: string) => imported.find((p) => p.source_key === key)!;
const names = (q: Record<string, string>) => sortPlaces(filterPlaces(imported, parseExploreFilters(q))).map((p) => p.name);

console.log(`Process TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

console.log("Dataset");
check("exactly 7 outings, 7 restaurants and 3 spas, with unique stable keys", () => {
  const types = C.items.map((i) => i.recommendation.type);
  assert.equal(types.filter((t) => t === "attraction" || t === "beach").length, 7);
  assert.equal(types.filter((t) => t === "restaurant").length, 7);
  assert.equal(types.filter((t) => t === "spa").length, 3);
  assert.equal(C.items.length, 17);
  const keys = C.items.map((i) => i.sourceKey);
  assert.equal(new Set(keys).size, 17);
  for (const k of ["aruba-butterfly-farm", "aruba-lindas-dutch-pancakes", "aruba-hyatt-zoia-spa"]) assert.ok(keys.includes(k), k);
  assert.ok(keys.every((k) => /^aruba-[a-z0-9-]+$/.test(k) && k.length <= 120));
});
check("content is stamped with the 2026-10-06 review date as editorial, never as verified", () => {
  for (const item of C.items) {
    const rec = recommendationFor(C, item);
    assert.equal(rec.reviewedOn, "2026-10-06");
    assert.equal(rec.verification, "editorial");
    assert.ok(rec.sources.length > 0 && rec.sources.every((u) => u.startsWith("https://")), item.name);
    assert.ok(!item.website || item.website.startsWith("https://"));
    assert.ok(item.name.length <= 160);
  }
});
check("nothing invented: no coordinates, place IDs, ratings or addresses; the unit number never appears", () => {
  const all = JSON.stringify(C.items);
  assert.ok(!/\b4P\b/.test(all), "unit / building designation must not appear");
  assert.ok(!/place_id|lat(itude)?"|lng|rating/i.test(all));
  for (const item of C.items) assert.ok(!("address" in item));
});
check("restaurants have vegetarian options (not labelled exclusively vegetarian); spas are adult solo time", () => {
  for (const item of C.items) {
    const rec = item.recommendation;
    if (rec.type === "restaurant") {
      assert.ok(rec.tags.some((t) => /vegetarian|vegan/i.test(t)), item.name);
      assert.ok(!/^vegetarian restaurant$/i.test(rec.cuisine ?? ""));
      assert.equal(rec.visitMinutes, null, "meal length is the traveler's call");
    }
    if (rec.type === "spa") {
      assert.ok(rec.soloParent && rec.turns, item.name);
      assert.ok(!rec.tags.some((t) => /baby|family|kid/i.test(t)), "never tagged baby-friendly");
      assert.equal(rec.visitMinutes, null, "treatment time is not the time away");
      assert.equal(rec.treatmentMinutes, 60);
      assert.equal(rec.totalAwayMinutes, 120);
    } else {
      assert.ok(!rec.soloParent && !rec.turns);
    }
  }
});
check("only an Aruba trip matches the collection", () => {
  assert.ok(collectionMatchesTrip(C, { destination: "Aruba", title: "Family trip" }));
  assert.ok(collectionMatchesTrip(C, { destination: "Oranjestad", title: "Aruba 2026" }));
  assert.ok(!collectionMatchesTrip(C, { destination: "Curaçao", title: "Island break" }));
});

console.log("Import plan");
const asExisting = (p: PlaceWithVisits): ExistingPlace => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  source_key: p.source_key,
  recommendation: p.recommendation,
});
check("first import adds all 17; importing again adds nothing", () => {
  const first = planCollectionImport(C, []);
  assert.equal(first.filter((o) => o.kind === "add").length, 17);
  const again = planCollectionImport(C, imported.map(asExisting));
  assert.deepEqual(again.map((o) => o.kind), Array(17).fill("existing"));
});
check("jsonb key order doesn't look like a change; a dataset edit refreshes only that recommendation", () => {
  const reordered = imported.map((p) => {
    const rec = p.recommendation as unknown as Record<string, unknown>;
    return asExisting({ ...p, recommendation: Object.fromEntries(Object.entries(rec).reverse()) as never });
  });
  assert.deepEqual(planCollectionImport(C, reordered).map((o) => o.kind), Array(17).fill("existing"));
  const edited = imported.map((p, i) =>
    asExisting(i === 0 ? { ...p, recommendation: { ...p.recommendation!, summary: "older text" } } : p),
  );
  const ops = planCollectionImport(C, edited);
  assert.equal(ops[0].kind, "refresh");
  assert.equal(ops.filter((o) => o.kind === "existing").length, 16);
  assert.equal(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }), stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
});
check("claims the traveler's own place on an unambiguous exact match (name or alias, same kind)", () => {
  const own: ExistingPlace[] = [
    { id: "u1", name: "eagle beach", kind: "place", source_key: null, recommendation: null },
    { id: "u2", name: "The Butterfly Farm", kind: "place", source_key: null, recommendation: null },
    { id: "u3", name: "Linda's Pancakes", kind: "food", source_key: null, recommendation: null },
  ];
  const ops = planCollectionImport(C, own);
  const op = (key: string) => ops.find((o) => o.item.sourceKey === key)!;
  assert.deepEqual(op("aruba-eagle-beach"), { kind: "link", item: op("aruba-eagle-beach").item, placeId: "u1", placeName: "eagle beach" });
  assert.equal(op("aruba-butterfly-farm").kind, "link");
  assert.equal(op("aruba-lindas-dutch-pancakes").kind, "link", "via its alias");
  assert.equal(ops.filter((o) => o.kind === "add").length, 14);
});
check("ambiguous matches are skipped and flagged; similar names are added and flagged; other kinds aren't claimed", () => {
  const own: ExistingPlace[] = [
    { id: "u1", name: "Baby Beach", kind: "place", source_key: null, recommendation: null },
    { id: "u2", name: "Baby  beach!", kind: "place", source_key: null, recommendation: null },
    { id: "u3", name: "Lucca", kind: "food", source_key: null, recommendation: null },
    { id: "u4", name: "Palm Beach", kind: "food", source_key: null, recommendation: null },
  ];
  const ops = planCollectionImport(C, own);
  const op = (key: string) => ops.find((o) => o.item.sourceKey === key)!;
  assert.deepEqual(op("aruba-baby-beach"), { kind: "skip", item: op("aruba-baby-beach").item, matches: ["Baby Beach", "Baby  beach!"] });
  const lucca = op("aruba-lucca-trattoria");
  assert.ok(lucca.kind === "add" && lucca.possibleDuplicates.includes("Lucca"));
  const palm = op("aruba-palm-beach");
  assert.ok(palm.kind === "add" && palm.possibleDuplicates.includes("Palm Beach"), "same name, different kind: flagged, not claimed");
});
check("one of the traveler's places is never claimed by two items", () => {
  const custom = {
    ...C,
    items: [
      { ...C.items[0], sourceKey: "x-1", name: "Shared", aliases: [] },
      { ...C.items[1], sourceKey: "x-2", name: "Other", aliases: ["Shared"] },
    ],
  };
  const ops = planCollectionImport(custom, [{ id: "u", name: "Shared", kind: "place", source_key: null, recommendation: null }]);
  assert.deepEqual(ops.map((o) => o.kind), ["skip", "skip"]);
});
check("summary message: '17 recommendations added', or an accurate breakdown", () => {
  const base = { total: 17, added: 17, existing: 0, refreshed: 0, linked: [], skipped: [], possibleDuplicates: [] };
  assert.equal(importMessage(base), "17 recommendations added");
  assert.equal(importMessage({ ...base, added: 0, existing: 17 }), "Already added — nothing changed.");
  assert.equal(
    importMessage({ ...base, added: 14, existing: 0, linked: [{ name: "a", placeName: "a" }, { name: "b", placeName: "b" }], skipped: [{ name: "c", matches: [] }] }),
    "14 added · 2 matched to places you saved · 1 skipped",
  );
});

console.log("Filters, search and order");
check("categories: 7 beaches & outings, 7 food, 3 spas", () => {
  assert.equal(names({ kind: "place" }).length, 7);
  assert.equal(names({ kind: "food" }).length, 7);
  // Top pick, then recommended, then optional — tier before drive time.
  assert.deepEqual(names({ kind: "spa" }), ["ZoiA Spa — Hyatt Regency Aruba", "Spa del Sol — Manchebo", "The Ritz-Carlton Spa"]);
});
check("near stay = max drive ≤ 15 min; short outing = max visit ≤ 60 min (meals and spas never count)", () => {
  assert.ok(isNearStay(recommendationOf(byKey("aruba-eagle-beach"))), "15 is near");
  assert.ok(!isNearStay(recommendationOf(byKey("aruba-arashi-beach"))), "20 is not");
  assert.equal(names({ only: "near" }).length, 12);
  assert.deepEqual(names({ only: "short" }).sort(), ["Butterfly Farm", "Donkey Sanctuary Aruba", "Philip’s Animal Garden"]);
  assert.ok(!isShortOuting(recommendationOf(byKey("aruba-hyatt-zoia-spa"))));
  assert.equal(names({ only: "veg" }).length, 7);
  assert.equal(names({ only: "solo" }).length, 3);
  assert.deepEqual(names({ only: "short,near" }).sort(), ["Butterfly Farm", "Philip’s Animal Garden"]);
});
check("favorites filter reads the place's own heart", () => {
  const withFav = imported.map((p) => (p.source_key === "aruba-azia" ? { ...p, is_favorite: true } : p));
  assert.deepEqual(filterPlaces(withFav, parseExploreFilters({ only: "favorites" })).map((p) => p.name), ["AZIA"]);
});
check("search matches name, area, cuisine and tags (accent- and case-insensitive)", () => {
  assert.deepEqual(names({ q: "italian" }), ["Lucca Trattoria"]);
  assert.deepEqual(names({ q: "NOORD" }).sort(), ["Arashi Beach", "Eduardo’s Hideaway", "Linda’s Dutch Pancakes", "Philip’s Animal Garden"]);
  assert.equal(names({ q: "massage" }).length, 3);
  assert.deepEqual(names({ q: "philips" }), ["Philip’s Animal Garden"]);
});
check("default order: priority, then estimated drive, then name", () => {
  assert.deepEqual(names({}).slice(0, 6), [
    "Linda’s Dutch Pancakes", // must do, 5
    "Butterfly Farm", // must do, 10 …
    "Lucca Trattoria",
    "Palm Beach",
    "ZoiA Spa — Hyatt Regency Aruba", // top pick, 10
    "Eagle Beach", // must do, 15
  ]);
  const all = names({});
  assert.equal(all.at(-1), "Donkey Sanctuary Aruba", "optional, 35 min");
  // The traveler's own priority wins over the curated tier.
  const demoted = sortPlaces(imported.map((p) => (p.source_key === "aruba-lindas-dutch-pancakes" ? { ...p, priority: "maybe" as const } : p)));
  assert.notEqual(demoted[0].name, "Linda’s Dutch Pancakes");
});

console.log("Maps, prices and itinerary prefill");
check("maps: a Google Maps search for name + Aruba — no place IDs, coordinates or the stay's address", () => {
  const link = mapsLink(byKey("aruba-lindas-dutch-pancakes"));
  assert.equal(link.exact, false);
  assert.equal(link.url, "https://www.google.com/maps/search/?api=1&query=Linda's%20Dutch%20Pancakes%20Aruba");
  for (const p of imported) {
    const url = mapsLink(p).url;
    assert.ok(url.startsWith("https://www.google.com/maps/search/?api=1&query=") && /Aruba$/.test(decodeURIComponent(url)));
    assert.ok(!/4P|Palm%20Aruba%20Condos|query_place_id/.test(url));
  }
  // A saved exact link still wins.
  assert.equal(mapsLink({ ...byKey("aruba-azia"), maps_url: "https://maps.app.goo.gl/x" }).exact, true);
});
check("ZoiA price: integer-cent arithmetic from the published $195 + 15%", () => {
  assert.equal(withServiceCharge(19500, 15), 22425);
  assert.equal(withServiceCharge(19500, 25), 24375);
  assert.equal(formatCents(44850), "$448.50");
  const est = priceEstimate(recommendationOf(byKey("aruba-hyatt-zoia-spa"))!.price!);
  assert.deepEqual(est, { base: "$195.00", perPerson: "$224.25", forTwo: "$448.50", percent: 15, sundayPercent: 25 });
  assert.equal(recommendationOf(byKey("aruba-manchebo-spa-del-sol"))!.price, null);
  assert.equal(recommendationOf(byKey("aruba-ritz-carlton-spa"))!.priceNote, "Unknown — request a current quote.");
});
check("itinerary prefill: category, suggested length, editable note marked 'not booked' with a source", () => {
  const baby = recommendationOf(byKey("aruba-baby-beach"))!;
  assert.equal(itineraryCategoryFor(byKey("aruba-baby-beach"), baby), "activity");
  assert.equal(itineraryCategoryFor(byKey("aruba-butterfly-farm"), recommendationOf(byKey("aruba-butterfly-farm"))), "sightseeing");
  assert.equal(itineraryCategoryFor(byKey("aruba-azia"), recommendationOf(byKey("aruba-azia"))), "food");
  assert.equal(suggestedMinutes(baby), 120);
  assert.equal(suggestedMinutes(recommendationOf(byKey("aruba-hyatt-zoia-spa"))), 120, "spa: total time away");
  assert.equal(suggestedMinutes(recommendationOf(byKey("aruba-azia"))), null);
  const note = itineraryNoteFor(baby, null);
  assert.ok(note.startsWith("Suggestion from Explore — not booked."));
  assert.ok(note.includes("90–120 min of round-trip driving"));
  assert.ok(note.includes("Source: https://www.aruba.com/"));
  assert.ok(note.length <= 5000);
  assert.equal(addMinutesToTime("12:30", 120), "14:30");
  assert.equal(addMinutesToTime("23:30", 60), null);
});

console.log("Outing checks (America/Aruba)");
let seq = 0;
const entry = (over: Partial<ItineraryEntry>): ItineraryEntry => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  trip_id: "t", owner_id: "o", place_id: null, reservation_id: null, title: "Entry", category: "activity",
  local_date: "2026-10-15", local_start_time: null, local_end_date: null, local_end_time: null, timezone: ZONE,
  sort_order: seq, status: "planned", planning_notes: null, rating: null, reflection: null, is_favorite: false,
  completed_at: null, is_optional: false, is_protected_rest: false, source_key: null, source_fingerprint: null,
  created_at: "", updated_at: "", place: null, reservation: null, ...over,
});
const flight = (over: Partial<Reservation>): Reservation => ({
  id: `f-${++seq}`, trip_id: "t", owner_id: "o", kind: "flight", status: "confirmed", title: "Flight", provider: null,
  confirmation_code: null, start_date: null, start_time: null, start_time_zone: null, end_date: null, end_time: null,
  end_time_zone: null, origin: null, destination: null, location: null, booking_url: null, notes: null, details: {},
  created_at: "", updated_at: "", ...over,
});
const rest = (date: string) =>
  entry({ title: "Lunch, baby nap & parents’ rest", category: "rest", local_date: date, local_start_time: "12:00:00", local_end_time: "15:00:00", is_protected_rest: true });
const outbound = flight({ start_date: "2026-10-14", start_time: "08:20", start_time_zone: "America/New_York", end_date: "2026-10-14", end_time: "15:20", end_time_zone: ZONE });
const home = flight({ start_date: "2026-10-19", start_time: "15:10", start_time_zone: ZONE, end_date: "2026-10-19", end_time: "19:30", end_time_zone: "America/New_York" });
const ctx = (items: ItineraryEntry[]) => ({ tripStart: "2026-10-14", tripEnd: "2026-10-19", timeZone: ZONE, items, reservations: [outbound, home] });
const codes = (p: Partial<OutingProposal>, items: ItineraryEntry[] = []) =>
  checkOuting({ date: "2026-10-15", start: null, end: null, drive: null, soloParent: false, ...p }, ctx(items)).map((n) => n.code);
const babyDrive = recommendationOf(byKey("aruba-baby-beach"))!.driveMinutes;

check("Baby Beach whose drive back runs into the rest block is a warning to adjust or keep", () => {
  const notices = checkOuting(
    { date: "2026-10-15", start: "09:30", end: "11:30", drive: babyDrive, soloParent: false },
    ctx([rest("2026-10-15")]),
  );
  const restNotice = notices.find((n) => n.code === "rest_overlap")!;
  assert.ok(restNotice.confirm, "must be kept explicitly");
  assert.ok(restNotice.detail!.includes("back about 12:30 PM"));
  assert.ok(restNotice.detail!.includes("won’t be moved"));
  assert.ok(codes({ start: "09:30", end: "11:30", drive: babyDrive }).includes("long_drive"), "round-trip estimate shown");
});
check("an outing back exactly when the rest starts is fine (boundaries don't clash)", () => {
  assert.deepEqual(codes({ start: "08:00", end: "11:00", drive: babyDrive }, [rest("2026-10-15")]), ["long_drive"]);
  assert.deepEqual(codes({ start: "10:00", end: "12:00" }, [rest("2026-10-15")]), []);
});
check("a solo spa turn during the rest block is informational, not a conflict", () => {
  const notices = checkOuting({ date: "2026-10-15", start: "12:30", end: "14:30", drive: null, soloParent: true }, ctx([rest("2026-10-15")]));
  assert.deepEqual(notices.map((n) => [n.code, n.confirm]), [["rest_solo", false]]);
});
check("two overlapping solo spa turns: both parents would be away", () => {
  const otherSpa = entry({
    title: null, place_id: "p-spa", local_start_time: "13:00:00", local_end_time: "15:00:00",
    place: { id: "p-spa", name: "ZoiA Spa — Hyatt Regency Aruba", kind: "place", category: "spa", priority: "must_do", address: null, maps_url: null, website_url: null },
  });
  const notices = checkOuting({ date: "2026-10-15", start: "12:30", end: "14:30", drive: null, soloParent: true }, ctx([otherSpa]));
  assert.deepEqual(notices.map((n) => [n.code, n.confirm]), [["solo_overlap", true]]);
  assert.ok(notices[0].title.includes("ZoiA Spa"));
  // The same spa time on another afternoon is fine.
  assert.deepEqual(codes({ date: "2026-10-16", start: "12:30", end: "14:30", soloParent: true }, [otherSpa]), []);
});
check("whole-family overlaps with other entries are shown; drive-only clashes are a softer note", () => {
  const eagle = entry({ title: "Eagle Beach", local_start_time: "10:30:00", local_end_time: "11:30:00" });
  assert.deepEqual(codes({ start: "10:00", end: "11:00", drive: { min: 5, max: 10 } }, [eagle]), ["overlap"]);
  assert.deepEqual(codes({ start: "09:00", end: "10:25", drive: { min: 5, max: 10 } }, [eagle]), ["travel_overlap"]);
  const skipped = entry({ ...eagle, id: "skip", status: "skipped" });
  assert.deepEqual(codes({ start: "10:00", end: "11:00" }, [skipped]), [], "skipped entries don't clash");
});
check("arrival day: flagged, and anything before you'd be settled after the 3:20 PM landing", () => {
  const c = codes({ date: "2026-10-14", start: "16:00", end: "17:00", drive: { min: 5, max: 10 } });
  assert.deepEqual(c, ["arrival_day", "arrival_buffer"]);
  assert.deepEqual(codes({ date: "2026-10-14", start: "18:30", end: "19:30", drive: { min: 5, max: 10 } }), ["arrival_day"]);
});
check("departure day: flagged, and anything that eats into the 3:10 PM departure buffer", () => {
  assert.deepEqual(codes({ date: "2026-10-19", start: "09:00", end: "10:00", drive: { min: 2, max: 5 } }), ["departure_day"]);
  assert.deepEqual(codes({ date: "2026-10-19", start: "10:00", end: "11:00", drive: { min: 2, max: 5 } }), ["departure_day", "departure_buffer"]);
  const cancelled = { ...ctx([]), reservations: [{ ...home, status: "cancelled" as const }] };
  assert.ok(
    !checkOuting({ date: "2026-10-19", start: "10:00", end: "11:00", drive: null, soloParent: false }, cancelled).some((n) => n.code === "departure_buffer"),
  );
});
check("no time yet: asks for one when the day has timed plans; middle days have no airport notes", () => {
  assert.deepEqual(codes({}, [rest("2026-10-15")]), ["needs_time"]);
  assert.deepEqual(codes({}), []);
});

console.log(`\n${passed} recommendation checks passed.`);
