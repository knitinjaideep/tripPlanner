/**
 * Fixed option sets for Explore, Itinerary and Packing. Shared by the
 * Drizzle schema (CHECK constraints), Zod validation and the UI, so the
 * three can't drift apart. No imports: drizzle-kit loads this file directly.
 */

export const PLACE_KINDS = ["place", "food"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Categories are validated per kind ("museum" is not a kind of food). */
export const PLACE_CATEGORIES = {
  place: ["sight", "museum", "nature", "beach", "park", "shopping", "nightlife", "experience", "spa", "other"],
  food: ["restaurant", "cafe", "bar", "bakery", "dessert", "market", "other"],
} as const satisfies Record<PlaceKind, readonly string[]>;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[PlaceKind][number];

export const PLACE_PRIORITIES = ["must_do", "maybe"] as const;
export type PlacePriority = (typeof PLACE_PRIORITIES)[number];

export const ITINERARY_STATUSES = ["planned", "completed", "skipped"] as const;
export type ItineraryStatus = (typeof ITINERARY_STATUSES)[number];

export const ITINERARY_CATEGORIES = [
  "activity",
  "sightseeing",
  "food",
  "transport",
  "lodging",
  "rest",
  "other",
] as const;
export type ItineraryCategory = (typeof ITINERARY_CATEGORIES)[number];

/** "Would you go back?" — "undecided" is an answer; null means not answered yet. */
export const WOULD_RETURN = ["yes", "no", "undecided"] as const;
export type WouldReturn = (typeof WOULD_RETURN)[number];

export const LABELS = {
  placeKind: { place: "Place", food: "Food & drink" },
  placeCategory: {
    sight: "Sight",
    museum: "Museum",
    nature: "Nature",
    beach: "Beach",
    park: "Park",
    shopping: "Shopping",
    nightlife: "Nightlife",
    experience: "Experience",
    spa: "Spa",
    restaurant: "Restaurant",
    cafe: "Café",
    bar: "Bar",
    bakery: "Bakery",
    dessert: "Dessert",
    market: "Market",
    other: "Other",
  },
  placePriority: { must_do: "Must do", maybe: "Maybe" },
  itineraryStatus: { planned: "Planned", completed: "Done", skipped: "Skipped" },
  itineraryCategory: {
    activity: "Activity",
    sightseeing: "Sightseeing",
    food: "Food & drink",
    transport: "Getting around",
    lodging: "Stay",
    rest: "Downtime",
    other: "Other",
  },
  wouldReturn: { yes: "Yes", no: "No", undecided: "Undecided" },
} as const satisfies {
  placeKind: Record<PlaceKind, string>;
  placeCategory: Record<PlaceCategory, string>;
  placePriority: Record<PlacePriority, string>;
  itineraryStatus: Record<ItineraryStatus, string>;
  itineraryCategory: Record<ItineraryCategory, string>;
  wouldReturn: Record<WouldReturn, string>;
};

export function isPlaceCategory(kind: PlaceKind, category: string): category is PlaceCategory {
  return (PLACE_CATEGORIES[kind] as readonly string[]).includes(category);
}

/**
 * Where a standalone activity lands when saved to Explore, or null for
 * categories that aren't places to visit (getting around, stays).
 */
export function exploreKindFor(
  category: ItineraryCategory,
): { kind: PlaceKind; category: PlaceCategory } | null {
  switch (category) {
    case "food":
      return { kind: "food", category: "other" };
    case "sightseeing":
      return { kind: "place", category: "sight" };
    case "activity":
      return { kind: "place", category: "experience" };
    case "rest":
    case "other":
      return { kind: "place", category: "other" };
    default:
      return null;
  }
}
