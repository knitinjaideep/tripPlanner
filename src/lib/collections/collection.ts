import { normalizeName, similarPlaces } from "@/lib/explore";
import type { PlaceCategory, PlaceKind, PlacePriority } from "@/lib/plan-options";
import type { Recommendation, RecommendationTier } from "@/lib/recommendations";

/**
 * A curated Explore collection (e.g. the Aruba recommendations) and the pure
 * plan that decides what an import does. No database access: the query in
 * src/db/queries.ts loads the trip's places under a row lock, runs
 * `planCollectionImport`, then writes exactly those operations.
 *
 * Rules (conservative on purpose):
 * - a place that already carries the item's `source_key` is the same place —
 *   never added twice; only its editorial `recommendation` is refreshed;
 * - the traveler's own place with exactly the same name (normalized, or a
 *   listed alias) and kind is claimed when that match is unique — its name,
 *   category, priority, notes, favorite and visits stay as they are;
 * - two or more such places → skipped and flagged (nothing is guessed);
 * - a merely similar name (e.g. "Lucca" vs "Lucca Trattoria") → added, and
 *   flagged as a possible duplicate for the traveler to review.
 */

export type CollectionItem = {
  /** Stable across versions, e.g. "aruba-butterfly-farm". */
  sourceKey: string;
  name: string;
  /** Other names the traveler may have saved it under. */
  aliases?: string[];
  kind: PlaceKind;
  category: PlaceCategory;
  /** Official website, when the research named one. */
  website: string | null;
  recommendation: Omit<Recommendation, "collection" | "reviewedOn" | "verification">;
};

export type ExploreCollection = {
  id: string;
  /** Button text: "Add <label>". */
  label: string;
  /** Explore page title and subtitle for a trip this collection fits. */
  heading: string;
  subheading: string;
  /** Matched against the trip's destination or title. */
  destination: RegExp;
  reviewedOn: string;
  items: CollectionItem[];
};

/** The stored recommendation for an item (collection id + review date stamped in). */
export function recommendationFor(collection: ExploreCollection, item: CollectionItem): Recommendation {
  return { ...item.recommendation, collection: collection.id, reviewedOn: collection.reviewedOn, verification: "editorial" };
}

/** Explore's two-level priority for a curated tier. */
export function priorityFor(tier: RecommendationTier): PlacePriority {
  return tier === "top_pick" || tier === "must_do" ? "must_do" : "maybe";
}

export function collectionMatchesTrip(collection: Pick<ExploreCollection, "destination">, trip: { destination: string; title: string }) {
  return collection.destination.test(trip.destination) || collection.destination.test(trip.title);
}

/** Key-order-independent JSON (Postgres jsonb reorders keys). */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type ExistingPlace = {
  id: string;
  name: string;
  kind: string;
  source_key: string | null;
  recommendation: unknown;
};

export type ImportOp =
  | { kind: "add"; item: CollectionItem; possibleDuplicates: string[] }
  /** Already imported and identical. */
  | { kind: "existing"; item: CollectionItem; placeId: string }
  /** Already imported; the editorial details changed in the dataset. */
  | { kind: "refresh"; item: CollectionItem; placeId: string }
  /** The traveler's own place with the same name: claimed, nothing of theirs changes. */
  | { kind: "link"; item: CollectionItem; placeId: string; placeName: string }
  | { kind: "skip"; item: CollectionItem; matches: string[] };

export function planCollectionImport(collection: ExploreCollection, existing: ExistingPlace[]): ImportOp[] {
  const bySource = new Map(existing.filter((p) => p.source_key).map((p) => [p.source_key!, p]));
  const own = existing.filter((p) => !p.source_key);
  const claimed = new Set<string>();

  // First pass: exact-name candidates per item, so one of the traveler's
  // places can never be claimed by two items.
  const candidates = new Map<string, ExistingPlace[]>();
  for (const item of collection.items) {
    if (bySource.has(item.sourceKey)) continue;
    const names = new Set([item.name, ...(item.aliases ?? [])].map(normalizeName));
    candidates.set(
      item.sourceKey,
      own.filter((p) => p.kind === item.kind && names.has(normalizeName(p.name))),
    );
  }
  const claimCount = new Map<string, number>();
  for (const list of candidates.values()) for (const p of list) claimCount.set(p.id, (claimCount.get(p.id) ?? 0) + 1);

  return collection.items.map((item): ImportOp => {
    const imported = bySource.get(item.sourceKey);
    if (imported) {
      const same = stableJson(imported.recommendation) === stableJson(recommendationFor(collection, item));
      return same
        ? { kind: "existing", item, placeId: imported.id }
        : { kind: "refresh", item, placeId: imported.id };
    }
    const exact = candidates.get(item.sourceKey) ?? [];
    if (exact.length === 1 && claimCount.get(exact[0].id) === 1 && !claimed.has(exact[0].id)) {
      claimed.add(exact[0].id);
      return { kind: "link", item, placeId: exact[0].id, placeName: exact[0].name };
    }
    if (exact.length > 0) return { kind: "skip", item, matches: exact.map((p) => p.name) };
    const similar = similarPlaces(item.name, own).map((p) => p.name);
    return { kind: "add", item, possibleDuplicates: [...new Set(similar)] };
  });
}

export type ImportSummary = {
  total: number;
  added: number;
  /** Already in Explore (refreshed ones included). */
  existing: number;
  refreshed: number;
  linked: { name: string; placeName: string }[];
  skipped: { name: string; matches: string[] }[];
  possibleDuplicates: { name: string; matches: string[] }[];
};

export function importMessage(s: ImportSummary) {
  const linked = s.linked.length;
  const skipped = s.skipped.length;
  if (s.added === s.total) return `${s.total} recommendations added`;
  if (s.added === 0 && linked === 0 && skipped === 0) {
    return s.refreshed ? "Already added — recommendation details refreshed." : "Already added — nothing changed.";
  }
  const parts = [
    s.added && `${s.added} added`,
    linked && `${linked} matched to places you saved`,
    s.existing && `${s.existing} already in Explore`,
    skipped && `${skipped} skipped`,
  ].filter(Boolean);
  return parts.join(" · ");
}
