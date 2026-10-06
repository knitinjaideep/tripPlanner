import { LABELS } from "@/lib/plan-options";
import {
  hasVegetarianOptions,
  isNearStay,
  isParentSoloTime,
  isShortOuting,
  isSpaPlace,
  recommendationOf,
} from "@/lib/recommendations";
import type { PlaceWithVisits } from "@/lib/types";

/**
 * Explore helpers: URL filters, derived visit status, gentle duplicate
 * hints and maps links. Pure functions, shared by the page and the tests.
 */

/** "place" = places & outings other than spas; "spa" = spas (curated or the traveler's own). */
export const EXPLORE_KINDS = ["all", "place", "food", "spa"] as const;
export const EXPLORE_PRIORITIES = ["all", "must_do", "maybe"] as const;
export const EXPLORE_STATUSES = ["all", "unscheduled", "scheduled", "visited"] as const;
/**
 * Extra filters, combined with AND. Definitions are deterministic:
 * near = estimated max one-way drive ≤ 15 min; short = suggested max visit
 * ≤ 60 min excluding travel (meals and spas have no visit length, so never
 * count); veg = a vegetarian / vegan tag; solo = a parent-solo-time option.
 */
export const EXPLORE_FLAGS = ["favorites", "near", "short", "veg", "solo"] as const;
export type ExploreFlag = (typeof EXPLORE_FLAGS)[number];

export const FLAG_LABELS: Record<ExploreFlag, string> = {
  favorites: "Favorites",
  near: "Near stay",
  short: "Short outings",
  veg: "Vegetarian options",
  solo: "Parent solo time",
};

export type ExploreFilters = {
  kind: (typeof EXPLORE_KINDS)[number];
  q: string;
  priority: (typeof EXPLORE_PRIORITIES)[number];
  status: (typeof EXPLORE_STATUSES)[number];
  flags: ExploreFlag[];
};

type Query = Record<string, string | string[] | undefined>;

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : allowed[0];

/** Known flags from "near,veg", in a fixed order, without repeats. */
function parseFlags(value: unknown): ExploreFlag[] {
  if (typeof value !== "string") return [];
  const given = new Set(value.split(","));
  return EXPLORE_FLAGS.filter((f) => given.has(f));
}

/** Filters from the URL; anything unknown falls back to "all". */
export function parseExploreFilters(query: Query): ExploreFilters {
  return {
    kind: pick(query.kind, EXPLORE_KINDS),
    q: typeof query.q === "string" ? query.q.trim().slice(0, 80) : "",
    priority: pick(query.priority, EXPLORE_PRIORITIES),
    status: pick(query.status, EXPLORE_STATUSES),
    flags: parseFlags(query.only),
  };
}

/** Explore URL with only non-default filters (plus an open place, if any). */
export function exploreHref(tripId: string, filters: Partial<ExploreFilters>, place?: string | null) {
  const query = new URLSearchParams();
  if (filters.kind && filters.kind !== "all") query.set("kind", filters.kind);
  if (filters.q) query.set("q", filters.q);
  if (filters.priority && filters.priority !== "all") query.set("priority", filters.priority);
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  const flags = EXPLORE_FLAGS.filter((f) => filters.flags?.includes(f));
  if (flags.length) query.set("only", flags.join(","));
  if (place) query.set("place", place);
  const qs = query.toString();
  return `/trips/${tripId}/explore${qs ? `?${qs}` : ""}`;
}

/** Turn one extra filter on or off. */
export function toggleFlag(flags: ExploreFlag[], flag: ExploreFlag): ExploreFlag[] {
  return flags.includes(flag) ? flags.filter((f) => f !== flag) : EXPLORE_FLAGS.filter((f) => f === flag || flags.includes(f));
}

type VisitCounts = Pick<PlaceWithVisits, "planned_count" | "completed_count">;

/**
 * Visited = at least one completed visit; scheduled = at least one planned
 * visit (both can be true); unscheduled = neither (skipped visits don't count).
 */
export function visitState(p: VisitCounts) {
  const visited = p.completed_count > 0;
  const scheduled = p.planned_count > 0;
  return { visited, scheduled, unscheduled: !visited && !scheduled };
}

/** Lowercase, accents and punctuation removed: "Café de l'Arte" → "cafe de larte". */
export function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

type Filterable = PlaceWithVisits;

export function matchesKind(p: Filterable, kind: ExploreFilters["kind"]) {
  if (kind === "all") return true;
  if (kind === "spa") return isSpaPlace(p);
  if (kind === "place") return p.kind === "place" && !isSpaPlace(p);
  return p.kind === kind;
}

export function matchesFlag(p: Filterable, flag: ExploreFlag) {
  const rec = recommendationOf(p);
  switch (flag) {
    case "favorites":
      return p.is_favorite;
    case "near":
      return isNearStay(rec);
    case "short":
      return isShortOuting(rec);
    case "veg":
      return hasVegetarianOptions(rec);
    case "solo":
      return isParentSoloTime(rec);
  }
}

/** Search text: name, area, cuisine and tags (plus the category label). */
function searchText(p: Filterable) {
  const rec = recommendationOf(p);
  const category = LABELS.placeCategory[p.category as keyof typeof LABELS.placeCategory] ?? "";
  return [p.name, rec?.area, rec?.cuisine, ...(rec?.tags ?? []), category]
    .filter(Boolean)
    .map((t) => normalizeName(t!))
    .join(" | ");
}

export function filterPlaces<T extends Filterable>(places: T[], f: ExploreFilters): T[] {
  const q = normalizeName(f.q);
  return places.filter((p) => {
    if (!matchesKind(p, f.kind)) return false;
    if (f.priority !== "all" && p.priority !== f.priority) return false;
    if (f.status !== "all" && !visitState(p)[f.status]) return false;
    if (f.flags.some((flag) => !matchesFlag(p, flag))) return false;
    if (q && !searchText(p).includes(q)) return false;
    return true;
  });
}

/**
 * 0 = must do / top pick, 1 = recommended / maybe, 2 = optional. The
 * traveler's own priority wins: a curated "must do" they set to maybe drops.
 */
export function priorityRank(p: Pick<Filterable, "priority" | "recommendation">) {
  if (p.priority === "must_do") return 0;
  return recommendationOf(p)?.tier === "optional" ? 2 : 1;
}

/** Default order: priority, then estimated drive (unknown last), then name as a stable tie-breaker. */
export function sortPlaces<T extends Filterable>(places: T[]): T[] {
  const drive = (p: T) => recommendationOf(p)?.driveMinutes?.max ?? Number.POSITIVE_INFINITY;
  return [...places].sort(
    (a, b) =>
      priorityRank(a) - priorityRank(b) ||
      drive(a) - drive(b) ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Places whose name looks like `name` (same after normalizing, or one
 * containing the other once both are 4+ characters). A hint only — never
 * a reason to refuse saving.
 */
export function similarPlaces<T extends { id: string; name: string }>(name: string, places: T[], excludeId?: string) {
  const n = normalizeName(name);
  if (n.length < 3) return [];
  return places.filter((p) => {
    if (p.id === excludeId) return false;
    const other = normalizeName(p.name);
    if (other === n) return true;
    return n.length >= 4 && other.length >= 4 && (other.includes(n) || n.includes(other));
  });
}

/**
 * The place's own maps link when saved (an exact place), otherwise a Google
 * Maps *search* — for a curated place its name plus the destination
 * (never the stay's address), else its name and address. Labelled
 * differently in the UI. No place IDs or coordinates are ever invented.
 */
export function mapsLink(place: { name: string; address: string | null; maps_url: string | null; recommendation?: unknown }) {
  if (place.maps_url) return { url: place.maps_url, exact: true, query: null };
  const rec = recommendationOf(place);
  const query = rec && !place.address ? rec.mapsQuery : [place.name, place.address].filter(Boolean).join(", ");
  return { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, exact: false, query };
}

/** "4.5" — only for places that have rated completed visits. */
export function formatRating(avg: number | null) {
  if (avg === null) return null;
  return (Math.round(avg * 10) / 10).toFixed(1).replace(/\.0$/, "");
}
