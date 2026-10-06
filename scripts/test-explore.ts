/**
 * Pure Explore checks — filters from the URL, visit status, duplicate
 * hints, maps links and rating display. No database needed:
 *
 *   npm run test:explore
 */
import assert from "node:assert/strict";
import {
  exploreHref,
  filterPlaces,
  formatRating,
  mapsLink,
  normalizeName,
  parseExploreFilters,
  similarPlaces,
  visitState,
} from "../src/lib/explore";
import type { PlaceWithVisits } from "../src/lib/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const place = (over: Partial<PlaceWithVisits>): PlaceWithVisits => ({
  id: over.name ?? "id", trip_id: "t", owner_id: "o", name: "Place", kind: "place", category: "other", priority: "maybe",
  address: null, maps_url: null, website_url: null, planning_notes: null, is_favorite: false, source_key: null,
  recommendation: null, created_at: "", updated_at: "",
  visit_count: 0, planned_count: 0, completed_count: 0, visited: false, rating_avg: null, rated_count: 0,
  next_planned_date: null, last_completed_date: null, ...over,
});

const places = [
  place({ name: "Eagle Beach", category: "beach", priority: "must_do" }),
  place({ name: "Zeerovers", kind: "food", category: "restaurant", planned_count: 1, visit_count: 1 }),
  place({ name: "Café Rembrandt", kind: "food", category: "cafe", completed_count: 1, planned_count: 1, visit_count: 2, visited: true }),
  place({ name: "Arikok", completed_count: 2, visit_count: 2, visited: true, priority: "must_do" }),
  place({ name: "Rained out", visit_count: 1 }), // only a skipped visit
];
const names = (q: Record<string, string>) => filterPlaces(places, parseExploreFilters(q)).map((p) => p.name);

console.log("Filters");
check("URL filters parse safely; unknown values fall back to all", () => {
  assert.deepEqual(parseExploreFilters({}), { kind: "all", q: "", priority: "all", status: "all", flags: [] });
  assert.deepEqual(parseExploreFilters({ kind: "food", q: "  cafe ", priority: "must_do", status: "visited" }), {
    kind: "food", q: "cafe", priority: "must_do", status: "visited", flags: [],
  });
  assert.deepEqual(parseExploreFilters({ kind: "x", priority: ["must_do"], status: "<script>" }), { kind: "all", q: "", priority: "all", status: "all", flags: [] });
  assert.deepEqual(parseExploreFilters({ only: "veg,bogus,near,veg" }).flags, ["near", "veg"]);
  assert.equal(parseExploreFilters({ q: "a".repeat(500) }).q.length, 80);
});
check("hrefs keep only non-default filters and round-trip", () => {
  assert.equal(exploreHref("t", {}), "/trips/t/explore");
  const href = exploreHref("t", { kind: "food", q: "café & bar", priority: "all", status: "scheduled" }, "p1");
  assert.equal(href, "/trips/t/explore?kind=food&q=caf%C3%A9+%26+bar&status=scheduled&place=p1");
  const back = parseExploreFilters(Object.fromEntries(new URLSearchParams(href.split("?")[1])));
  assert.deepEqual(back, { kind: "food", q: "café & bar", priority: "all", status: "scheduled", flags: [] });
  const flagged = exploreHref("t", { kind: "spa", flags: ["solo", "favorites"] });
  assert.equal(flagged, "/trips/t/explore?kind=spa&only=favorites%2Csolo");
  assert.deepEqual(parseExploreFilters(Object.fromEntries(new URLSearchParams(flagged.split("?")[1]))).flags, ["favorites", "solo"]);
});
check("kind, priority, status and name search combine", () => {
  assert.deepEqual(names({ kind: "food" }), ["Zeerovers", "Café Rembrandt"]);
  assert.deepEqual(names({ priority: "must_do" }), ["Eagle Beach", "Arikok"]);
  assert.deepEqual(names({ q: "CAFE" }), ["Café Rembrandt"]);
  assert.deepEqual(names({ q: "zee", kind: "place" }), []);
});
check("visited / scheduled / unscheduled: a place can be both; skipped-only is unscheduled", () => {
  assert.deepEqual(names({ status: "visited" }), ["Café Rembrandt", "Arikok"]);
  assert.deepEqual(names({ status: "scheduled" }), ["Zeerovers", "Café Rembrandt"]);
  assert.deepEqual(names({ status: "unscheduled" }), ["Eagle Beach", "Rained out"]);
  assert.deepEqual(visitState({ planned_count: 1, completed_count: 1 }), { visited: true, scheduled: true, unscheduled: false });
});

console.log("Duplicates, links, ratings");
check("similar names are hinted (accents, case, 'the', containment), never the place itself", () => {
  assert.equal(normalizeName("  The Café de l'Arte! "), "cafe de larte");
  assert.deepEqual(similarPlaces("zeerovers", places).map((p) => p.name), ["Zeerovers"]);
  assert.deepEqual(similarPlaces("Cafe Rembrandt Aruba", places).map((p) => p.name), ["Café Rembrandt"]);
  assert.deepEqual(similarPlaces("Zeerovers", places, "Zeerovers"), [], "editing doesn't match itself");
  assert.deepEqual(similarPlaces("Ze", places), [], "too short to compare");
  assert.deepEqual(similarPlaces("Natural Pool", places), []);
});
check("maps: exact saved link vs a generated search (name + address)", () => {
  assert.deepEqual(mapsLink({ name: "X", address: null, maps_url: "https://maps.app.goo.gl/abc" }), { url: "https://maps.app.goo.gl/abc", exact: true, query: null });
  const search = mapsLink({ name: "Zeerovers & Co", address: "Savaneta 270", maps_url: null });
  assert.equal(search.exact, false);
  assert.equal(search.url, "https://www.google.com/maps/search/?api=1&query=Zeerovers%20%26%20Co%2C%20Savaneta%20270");
  assert.ok(search.url.startsWith("https://www.google.com/maps/search/"));
});
check("ratings show only when visits were rated; no zero stars", () => {
  assert.equal(formatRating(null), null);
  assert.equal(formatRating(4.5), "4.5");
  assert.equal(formatRating(4), "4");
  assert.equal(formatRating(4.666), "4.7");
});

console.log(`\n${passed} explore checks passed.`);
