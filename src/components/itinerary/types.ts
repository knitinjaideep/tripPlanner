import type { PlaceWithVisits } from "@/lib/types";

/** A day of the trip, as offered in day pickers. */
export type TripDayOption = { date: string; dayNumber: number; label: string };

/** What the itinerary needs to know about an Explore place. */
export type ExplorePlace = Pick<
  PlaceWithVisits,
  "id" | "name" | "kind" | "category" | "priority" | "address" | "maps_url" | "visit_count" | "planned_count" | "completed_count"
>;

export type ActivityFormMode = "activity" | "place" | "booking";
