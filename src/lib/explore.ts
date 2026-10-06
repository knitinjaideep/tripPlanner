import type { PlaceWithVisits } from "@/lib/types";

/**
 * Explore helpers: URL filters, derived visit status, gentle duplicate
 * hints and maps links. Pure functions, shared by the page and the tests.
 */

export const EXPLORE_KINDS = ["all", "place", "food"] as const;
export const EXPLORE_PRIORITIES = ["all", "must_do", "maybe"] as const;
export const EXPLORE_STATUSES = ["all", "unscheduled", "scheduled", "visited"] as const;

export type ExploreFilters = {
  kind: (typeof EXPLORE_KINDS)[number];
  q: string;
  priority: (typeof EXPLORE_PRIORITIES)[number];
  status: (typeof EXPLORE_STATUSES)[number];
};

type Query = Record<string, string | string[] | undefined>;

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : allowed[0];

/** Filters from the URL; anything unknown falls back to "all". */
export function parseExploreFilters(query: Query): ExploreFilters {
  return {
    kind: pick(query.kind, EXPLORE_KINDS),
    q: typeof query.q === "string" ? query.q.trim().slice(0, 80) : "",
    priority: pick(query.priority, EXPLORE_PRIORITIES),
    status: pick(query.status, EXPLORE_STATUSES),
  };
}

/** Explore URL with only non-default filters (plus an open place, if any). */
export function exploreHref(tripId: string, filters: Partial<ExploreFilters>, place?: string | null) {
  const query = new URLSearchParams();
  if (filters.kind && filters.kind !== "all") query.set("kind", filters.kind);
  if (filters.q) query.set("q", filters.q);
  if (filters.priority && filters.priority !== "all") query.set("priority", filters.priority);
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (place) query.set("place", place);
  const qs = query.toString();
  return `/trips/${tripId}/explore${qs ? `?${qs}` : ""}`;
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

export function filterPlaces<T extends PlaceWithVisits>(places: T[], f: ExploreFilters): T[] {
  const q = normalizeName(f.q);
  return places.filter((p) => {
    if (f.kind !== "all" && p.kind !== f.kind) return false;
    if (f.priority !== "all" && p.priority !== f.priority) return false;
    if (f.status !== "all" && !visitState(p)[f.status]) return false;
    if (q && !normalizeName(p.name).includes(q)) return false;
    return true;
  });
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
 * Maps *search* for its name and address — labelled differently in the UI.
 */
export function mapsLink(place: { name: string; address: string | null; maps_url: string | null }) {
  if (place.maps_url) return { url: place.maps_url, exact: true };
  const query = [place.name, place.address].filter(Boolean).join(", ");
  return { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, exact: false };
}

/** "4.5" — only for places that have rated completed visits. */
export function formatRating(avg: number | null) {
  if (avg === null) return null;
  return (Math.round(avg * 10) / 10).toFixed(1).replace(/\.0$/, "");
}
