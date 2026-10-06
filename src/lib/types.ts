import type {
  DocumentRow,
  ItineraryItemRow,
  PackingCategoryRow,
  PackingItemRow,
  PlaceRow,
  ReservationRow,
  TripMemoryRow,
  TripRow,
} from "@/db/schema";

export const RESERVATION_KINDS = [
  "flight",
  "lodging",
  "car",
  "train",
  "activity",
  "restaurant",
  "other",
] as const;

export type ReservationKind = (typeof RESERVATION_KINDS)[number];

/** A cancelled booking is kept (with its confirmation) but hidden from plans by default. */
export const RESERVATION_STATUSES = ["confirmed", "cancelled"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Row shapes as read from the database (dates are "YYYY-MM-DD" strings). */
export type Trip = TripRow;
export type Reservation = ReservationRow;
export type TripDocument = DocumentRow;

export type TripWithDetails = Trip & {
  reservations: Reservation[];
  documents: TripDocument[];
};

/** Validated, user-editable fields (never includes ids or owner). */
export type TripInput = Pick<
  Trip,
  "title" | "destination" | "start_date" | "end_date" | "time_zone" | "travelers" | "cover_image" | "notes"
>;

export type ReservationInput = Pick<
  Reservation,
  | "kind"
  | "status"
  | "title"
  | "provider"
  | "confirmation_code"
  | "start_date"
  | "start_time"
  | "start_time_zone"
  | "end_date"
  | "end_time"
  | "end_time_zone"
  | "origin"
  | "destination"
  | "location"
  | "booking_url"
  | "notes"
  | "details"
>;

export type DocumentInput = Pick<TripDocument, "reservation_id" | "label" | "url">;

/* ------------------ Explore, Itinerary, Packing, Memories ------------------ */

export type Place = PlaceRow;
export type ItineraryItem = ItineraryItemRow;
export type PackingCategory = PackingCategoryRow;
export type PackingItem = PackingItemRow;
export type TripMemory = TripMemoryRow;

/**
 * An Explore place plus what the itinerary says about it (derived, never
 * stored). Visited = at least one completed visit; scheduled = at least one
 * planned visit; a place can be both. Skipped visits count for neither.
 */
export type PlaceWithVisits = Place & {
  visit_count: number;
  planned_count: number;
  completed_count: number;
  visited: boolean;
  /** Average of completed visits' ratings; null when none are rated. */
  rating_avg: number | null;
  rated_count: number;
  next_planned_date: string | null;
  last_completed_date: string | null;
};

/** Shared place details shown on a visit (the place row is the source of truth). */
export type PlaceSummary = Pick<
  Place,
  "id" | "name" | "kind" | "category" | "priority" | "address" | "maps_url" | "website_url"
>;

/** A visit with its linked place and reservation, if any. */
export type ItineraryEntry = ItineraryItem & {
  place: PlaceSummary | null;
  reservation: Reservation | null;
};

export type PackingCategoryWithItems = PackingCategory & { items: PackingItem[] };

/** Another of the owner's trips, with its list summarized for "Copy from another trip". */
export type PackingSource = {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  categories: { id: string; name: string; items: { label: string; traveler_name: string | null }[] }[];
};

export type PlaceInput = Pick<
  Place,
  "name" | "kind" | "category" | "priority" | "address" | "maps_url" | "website_url" | "planning_notes"
>;

/**
 * Planning fields of a visit. When reservation_id is set the schedule fields
 * are always null — the reservation owns the date and times. A null timezone
 * on a standalone visit means "use the trip's zone".
 */
export type ItineraryItemInput = Pick<
  ItineraryItem,
  | "place_id"
  | "reservation_id"
  | "title"
  | "category"
  | "local_date"
  | "local_start_time"
  | "local_end_date"
  | "local_end_time"
  | "timezone"
  | "planning_notes"
> &
  /** Omitted (e.g. "Add to this day" from Explore) = keep the column as it is / its default. */
  Partial<Pick<ItineraryItem, "is_optional" | "is_protected_rest">>;

/** Completion and reflection fields (completed_at is set by the server). */
export type VisitReviewInput = Pick<ItineraryItem, "status" | "rating" | "reflection" | "is_favorite">;

export type PackingCategoryInput = Pick<PackingCategory, "name">;
export type PackingItemInput = Pick<PackingItem, "category_id" | "label" | "quantity" | "traveler_name" | "notes">;

export type TripMemoryInput = Pick<
  TripMemory,
  "overall_rating" | "summary" | "favorite_moment" | "would_return" | "lessons_for_next_time" | "photo_album_url"
>;

/** Result shape shared by every form Server Action. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set when the session ended, so the form can offer a sign-in link. */
  signedOut?: boolean;
};
