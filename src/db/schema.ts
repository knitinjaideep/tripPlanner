import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// Relative import: drizzle-kit loads this file outside Next's path aliases.
import { RESERVATION_KINDS, RESERVATION_STATUSES } from "../lib/types";
import type { Recommendation } from "../lib/recommendations";
import {
  ITINERARY_CATEGORIES,
  ITINERARY_STATUSES,
  PLACE_CATEGORIES,
  PLACE_KINDS,
  PLACE_PRIORITIES,
  WOULD_RETURN,
} from "../lib/plan-options";

/**
 * Application-owned tables. Neon Auth owns its own `neon_auth` schema; it is
 * never referenced, altered or migrated from here.
 *
 * Ownership: `owner_id` is the verified Neon Auth user ID, stored as text
 * (the format is the provider's business). There is deliberately no foreign
 * key into `neon_auth` — Neon does not document that as supported. Instead,
 * child rows carry `owner_id` too and composite foreign keys tie them to a
 * trip with the *same* owner, so the database itself rejects a reservation or
 * document hanging off someone else's trip, or a document pointing at another
 * trip's reservation.
 *
 * Times: reservation moments are local wall-clock values (date + optional
 * time) plus the IANA zone they happen in — exactly what a ticket says.
 * They are never converted through UTC.
 */

const timestamps = {
  created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};

/** Who added / last changed the row (a user ID; set by a trigger from the acting session, never trusted from the browser). */
const attribution = {
  created_by: text(),
  updated_by: text(),
};

export const trips = pgTable(
  "trips",
  {
    id: uuid().primaryKey().defaultRandom(),
    owner_id: text().notNull(),
    title: text().notNull(),
    destination: text().notNull(),
    start_date: date({ mode: "string" }).notNull(),
    end_date: date({ mode: "string" }).notNull(),
    time_zone: text().notNull(),
    travelers: text().array().notNull().default(sql`'{}'::text[]`),
    cover_image: text().notNull().default("beach"),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    unique("trips_id_owner_unique").on(t.id, t.owner_id),
    index("trips_owner_start_idx").on(t.owner_id, t.start_date),
    check("trips_owner_id_present", sql`char_length(${t.owner_id}) between 1 and 255`),
    check("trips_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("trips_destination_length", sql`char_length(${t.destination}) between 1 and 120`),
    check("trips_dates_ordered", sql`${t.end_date} >= ${t.start_date}`),
    check("trips_time_zone_length", sql`char_length(${t.time_zone}) between 1 and 64`),
    check("trips_travelers_count", sql`cardinality(${t.travelers}) <= 20`),
    check("trips_cover_image_length", sql`char_length(${t.cover_image}) <= 40`),
    check("trips_notes_length", sql`char_length(${t.notes}) <= 5000`),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    kind: text({ enum: RESERVATION_KINDS }).notNull(),
    status: text({ enum: RESERVATION_STATUSES }).notNull().default("confirmed"),
    title: text().notNull(),
    provider: text(),
    /** Always a string: codes can have leading zeros and letters. */
    confirmation_code: text(),
    start_date: date({ mode: "string" }),
    start_time: time(),
    start_time_zone: text(),
    end_date: date({ mode: "string" }),
    end_time: time(),
    end_time_zone: text(),
    origin: text(),
    destination: text(),
    location: text(),
    booking_url: text(),
    notes: text(),
    /** Type-specific fields (flight number, room type…), validated per kind. */
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    unique("reservations_id_trip_unique").on(t.id, t.trip_id),
    foreignKey({
      name: "reservations_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("reservations_trip_start_idx").on(t.trip_id, t.start_date, t.start_time),
    index("reservations_owner_idx").on(t.owner_id),
    check(
      "reservations_kind_valid",
      sql`${t.kind} in ('flight', 'lodging', 'car', 'train', 'activity', 'restaurant', 'other')`,
    ),
    check("reservations_status_valid", sql`${t.status} in ('confirmed', 'cancelled')`),
    check("reservations_title_length", sql`char_length(${t.title}) between 1 and 160`),
    check("reservations_provider_length", sql`char_length(${t.provider}) <= 120`),
    check("reservations_confirmation_length", sql`char_length(${t.confirmation_code}) <= 80`),
    check("reservations_start_tz_length", sql`char_length(${t.start_time_zone}) between 1 and 64`),
    check("reservations_end_tz_length", sql`char_length(${t.end_time_zone}) between 1 and 64`),
    check("reservations_start_time_has_date", sql`${t.start_time} is null or ${t.start_date} is not null`),
    check("reservations_end_time_has_date", sql`${t.end_time} is null or ${t.end_date} is not null`),
    check(
      "reservations_dates_ordered",
      sql`${t.end_date} is null or ${t.start_date} is null or ${t.end_date} >= ${t.start_date}`,
    ),
    check("reservations_origin_length", sql`char_length(${t.origin}) <= 120`),
    check("reservations_destination_length", sql`char_length(${t.destination}) <= 120`),
    check("reservations_location_length", sql`char_length(${t.location}) <= 240`),
    check(
      "reservations_booking_url_https",
      sql`${t.booking_url} ~ '^https://' and char_length(${t.booking_url}) <= 2048`,
    ),
    check("reservations_notes_length", sql`char_length(${t.notes}) <= 5000`),
    check("reservations_details_object", sql`jsonb_typeof(${t.details}) = 'object'`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    reservation_id: uuid(),
    label: text().notNull(),
    url: text().notNull(),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "documents_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    // Same-trip guarantee. The migration hand-edits this to
    // ON DELETE SET NULL ("reservation_id") so deleting a reservation keeps
    // its documents on the trip (Drizzle cannot express the column list).
    foreignKey({
      name: "documents_reservation_same_trip_fk",
      columns: [t.reservation_id, t.trip_id],
      foreignColumns: [reservations.id, reservations.trip_id],
    }).onDelete("set null"),
    index("documents_trip_created_idx").on(t.trip_id, t.created_at),
    index("documents_reservation_idx").on(t.reservation_id),
    index("documents_owner_idx").on(t.owner_id),
    check("documents_label_length", sql`char_length(${t.label}) between 1 and 120`),
    check("documents_url_https", sql`${t.url} ~ '^https://' and char_length(${t.url}) <= 2048`),
  ],
);

/* ---------------- Explore, Itinerary, Packing, Memories ---------------- */

/** `col in ('a', 'b')` from a fixed, code-owned list (never user input). */
const inList = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

/**
 * Explore: places and food a traveler is considering. "Visited" is not
 * stored here — it is derived from completed itinerary visits.
 */
export const places = pgTable(
  "places",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    name: text().notNull(),
    kind: text({ enum: PLACE_KINDS }).notNull(),
    category: text().notNull(),
    priority: text({ enum: PLACE_PRIORITIES }).notNull().default("maybe"),
    address: text(),
    maps_url: text(),
    website_url: text(),
    /** The traveler's own notes ("Your notes"). Never written by an import. */
    planning_notes: text(),
    /** The traveler's heart. Personal state, never written by an import. */
    is_favorite: boolean().notNull().default(false),
    /**
     * Set only on places added (or claimed) by a curated collection import,
     * e.g. "aruba-butterfly-farm", so re-running the import finds them
     * instead of adding a second copy. Null for places the traveler adds.
     */
    source_key: text(),
    /**
     * Editorial details from the curated collection (summary, area, drive
     * estimate, notes, sources, review date). Refreshed by a re-import; the
     * traveler's own fields above are never touched by it.
     */
    recommendation: jsonb().$type<Recommendation>(),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    unique("places_id_trip_unique").on(t.id, t.trip_id),
    // One place per curated source per trip (NULLs — the traveler's own places — never collide).
    unique("places_trip_source_unique").on(t.trip_id, t.source_key),
    foreignKey({
      name: "places_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("places_trip_kind_idx").on(t.trip_id, t.kind),
    index("places_owner_idx").on(t.owner_id),
    check("places_name_length", sql`char_length(${t.name}) between 1 and 160`),
    check("places_kind_valid", inList(t.kind, PLACE_KINDS)),
    check(
      "places_category_valid",
      sql`(${t.kind} = 'place' and ${inList(t.category, PLACE_CATEGORIES.place)}) or (${t.kind} = 'food' and ${inList(t.category, PLACE_CATEGORIES.food)})`,
    ),
    check("places_priority_valid", inList(t.priority, PLACE_PRIORITIES)),
    check("places_address_length", sql`char_length(${t.address}) <= 240`),
    check("places_maps_url_https", sql`${t.maps_url} ~ '^https://' and char_length(${t.maps_url}) <= 2048`),
    check("places_website_url_https", sql`${t.website_url} ~ '^https://' and char_length(${t.website_url}) <= 2048`),
    check("places_planning_notes_length", sql`char_length(${t.planning_notes}) <= 5000`),
    check("places_source_key_length", sql`char_length(${t.source_key}) between 1 and 120`),
    check(
      "places_recommendation_object",
      sql`${t.recommendation} is null or (jsonb_typeof(${t.recommendation}) = 'object' and ${t.source_key} is not null)`,
    ),
  ],
);

/**
 * Itinerary: one row per visit or standalone activity. Completed rows are
 * also the per-activity memories (rating, reflection, favorite).
 *
 * Schedule source (enforced by `itinerary_items_schedule_source`):
 * - standalone / place visits store their own local date (+ optional times)
 *   and the IANA zone they happen in;
 * - reservation-backed rows store NO schedule — the reservation's date,
 *   times and zones are authoritative.
 *
 * Deleting a place or reservation that visits point at is refused by the
 * database (NO ACTION); the app first detaches or converts those visits in
 * the same transaction so reflections are never lost. Deleting the trip
 * removes everything (all checks run at end of statement).
 */
export const itineraryItems = pgTable(
  "itinerary_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    place_id: uuid(),
    reservation_id: uuid(),
    /** Required for standalone activities; otherwise an optional override. */
    title: text(),
    category: text({ enum: ITINERARY_CATEGORIES }).notNull().default("activity"),
    local_date: date({ mode: "string" }),
    local_start_time: time(),
    local_end_date: date({ mode: "string" }),
    local_end_time: time(),
    timezone: text(),
    sort_order: integer().notNull().default(0),
    status: text({ enum: ITINERARY_STATUSES }).notNull().default("planned"),
    planning_notes: text(),
    rating: integer(),
    reflection: text(),
    is_favorite: boolean().notNull().default(false),
    completed_at: timestamp({ withTimezone: true, mode: "string" }),
    /** Can be dropped without breaking the day (shown as "Optional"). */
    is_optional: boolean().notNull().default(false),
    /** A rest window to keep free of outings; overlaps get a gentle note. */
    is_protected_rest: boolean().notNull().default(false),
    /**
     * Set only on entries written by a saved plan update (e.g.
     * "aruba-2026:d2-baby-beach"), so re-applying finds them instead of
     * adding a second copy. Null for everything the traveler adds.
     */
    source_key: text(),
    /** Fingerprint of the planning fields as the plan last wrote them — tells later updates whether they were hand-edited. */
    source_fingerprint: text(),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "itinerary_items_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "itinerary_items_place_same_trip_fk",
      columns: [t.place_id, t.trip_id],
      foreignColumns: [places.id, places.trip_id],
    }),
    foreignKey({
      name: "itinerary_items_reservation_same_trip_fk",
      columns: [t.reservation_id, t.trip_id],
      foreignColumns: [reservations.id, reservations.trip_id],
    }),
    // At most one itinerary entry per reservation.
    uniqueIndex("itinerary_items_reservation_unique").on(t.reservation_id).where(sql`${t.reservation_id} is not null`),
    // One entry per plan source per trip (NULLs — hand-added entries — never collide).
    unique("itinerary_items_trip_source_unique").on(t.trip_id, t.source_key),
    // Lets other trip tables (polls) point at a visit of THIS trip with a composite foreign key.
    unique("itinerary_items_id_trip_unique").on(t.id, t.trip_id),
    index("itinerary_items_trip_date_idx").on(t.trip_id, t.local_date, t.sort_order),
    index("itinerary_items_place_idx").on(t.place_id),
    index("itinerary_items_owner_idx").on(t.owner_id),
    check("itinerary_items_title_length", sql`char_length(${t.title}) between 1 and 160`),
    check(
      "itinerary_items_has_subject",
      sql`${t.title} is not null or ${t.place_id} is not null or ${t.reservation_id} is not null`,
    ),
    check("itinerary_items_category_valid", inList(t.category, ITINERARY_CATEGORIES)),
    check(
      "itinerary_items_schedule_source",
      sql`(${t.reservation_id} is null and ${t.local_date} is not null and ${t.timezone} is not null)
        or (${t.reservation_id} is not null and ${t.local_date} is null and ${t.local_start_time} is null
            and ${t.local_end_date} is null and ${t.local_end_time} is null and ${t.timezone} is null)`,
    ),
    check("itinerary_items_timezone_length", sql`char_length(${t.timezone}) between 1 and 64`),
    check("itinerary_items_end_after_start", sql`${t.local_end_date} >= ${t.local_date}`),
    // An end time on the same day must come after the start time; an
    // overnight end needs an explicit later end date.
    check(
      "itinerary_items_end_time_valid",
      sql`${t.local_end_time} is null
        or coalesce(${t.local_end_date}, ${t.local_date}) > ${t.local_date}
        or (${t.local_start_time} is not null and ${t.local_end_time} > ${t.local_start_time})`,
    ),
    check("itinerary_items_status_valid", inList(t.status, ITINERARY_STATUSES)),
    check(
      "itinerary_items_completed_at_matches",
      sql`(${t.status} = 'completed') = (${t.completed_at} is not null)`,
    ),
    check("itinerary_items_rating_range", sql`${t.rating} between 1 and 5`),
    check("itinerary_items_planning_notes_length", sql`char_length(${t.planning_notes}) <= 5000`),
    check("itinerary_items_reflection_length", sql`char_length(${t.reflection}) <= 5000`),
    check("itinerary_items_source_key_length", sql`char_length(${t.source_key}) between 1 and 120`),
    check("itinerary_items_source_fingerprint_length", sql`char_length(${t.source_fingerprint}) <= 64`),
  ],
);

export const packingCategories = pgTable(
  "packing_categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    name: text().notNull(),
    sort_order: integer().notNull().default(0),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    unique("packing_categories_id_trip_unique").on(t.id, t.trip_id),
    foreignKey({
      name: "packing_categories_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("packing_categories_trip_order_idx").on(t.trip_id, t.sort_order),
    index("packing_categories_owner_idx").on(t.owner_id),
    check("packing_categories_name_length", sql`char_length(${t.name}) between 1 and 60`),
  ],
);

/**
 * Deleting a category with items is refused by the database (NO ACTION);
 * the app moves or deletes the items first, in one transaction.
 */
export const packingItems = pgTable(
  "packing_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    category_id: uuid().notNull(),
    label: text().notNull(),
    quantity: integer().notNull().default(1),
    /** Exact supplied wording when `quantity` can't say it (a range, a unit, a supply instruction). Cleared when the number is edited. */
    quantity_text: text(),
    /** Stable key of a built-in list import (e.g. the baby list), so re-importing never duplicates. Null for ordinary items. */
    source_key: text(),
    traveler_name: text(),
    notes: text(),
    is_packed: boolean().notNull().default(false),
    /**
     * Optional personal assignment: a current member of the trip (the owner or a
     * trip_members user). Checked in the data layer — there is no FK into neon_auth.
     * Cleared when that person leaves or is removed.
     */
    assignee_id: text(),
    /** Optional deadline: a date, optionally with a wall-clock time, in `due_time_zone` (the trip's zone when it was set). */
    due_date: date({ mode: "string" }),
    due_time: time(),
    due_time_zone: text(),
    sort_order: integer().notNull().default(0),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    unique("packing_items_id_trip_unique").on(t.id, t.trip_id),
    index("packing_items_assignee_idx").on(t.trip_id, t.assignee_id),
    check("packing_items_assignee_length", sql`char_length(${t.assignee_id}) between 1 and 255`),
    check("packing_items_due_time_has_date", sql`${t.due_time} is null or ${t.due_date} is not null`),
    check("packing_items_due_zone_pair", sql`(${t.due_date} is null) = (${t.due_time_zone} is null)`),
    check("packing_items_due_zone_length", sql`char_length(${t.due_time_zone}) between 1 and 64`),
    foreignKey({
      name: "packing_items_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "packing_items_category_same_trip_fk",
      columns: [t.category_id, t.trip_id],
      foreignColumns: [packingCategories.id, packingCategories.trip_id],
    }),
    index("packing_items_trip_category_idx").on(t.trip_id, t.category_id, t.sort_order),
    index("packing_items_category_idx").on(t.category_id),
    index("packing_items_owner_idx").on(t.owner_id),
    uniqueIndex("packing_items_trip_source_key_unique").on(t.trip_id, t.source_key).where(sql`${t.source_key} is not null`),
    check("packing_items_quantity_text_length", sql`char_length(${t.quantity_text}) between 1 and 80`),
    check("packing_items_source_key_length", sql`char_length(${t.source_key}) between 1 and 120`),
    check("packing_items_label_length", sql`char_length(${t.label}) between 1 and 120`),
    check("packing_items_quantity_range", sql`${t.quantity} between 1 and 999`),
    check("packing_items_traveler_length", sql`char_length(${t.traveler_name}) between 1 and 40`),
    check("packing_items_notes_length", sql`char_length(${t.notes}) <= 1000`),
  ],
);

/** One optional whole-trip reflection. Per-activity memories live on itinerary_items. */
export const tripMemories = pgTable(
  "trip_memories",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    overall_rating: integer(),
    summary: text(),
    favorite_moment: text(),
    would_return: text({ enum: WOULD_RETURN }),
    lessons_for_next_time: text(),
    photo_album_url: text(),
    ...attribution,
    ...timestamps,
  },
  (t) => [
    unique("trip_memories_trip_unique").on(t.trip_id),
    foreignKey({
      name: "trip_memories_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("trip_memories_owner_idx").on(t.owner_id),
    check("trip_memories_rating_range", sql`${t.overall_rating} between 1 and 5`),
    check("trip_memories_would_return_valid", inList(t.would_return, WOULD_RETURN)),
    check("trip_memories_summary_length", sql`char_length(${t.summary}) <= 5000`),
    check("trip_memories_favorite_length", sql`char_length(${t.favorite_moment}) <= 2000`),
    check("trip_memories_lessons_length", sql`char_length(${t.lessons_for_next_time}) <= 5000`),
    check(
      "trip_memories_album_url_https",
      sql`${t.photo_album_url} ~ '^https://' and char_length(${t.photo_album_url}) <= 2048`,
    ),
  ],
);

export type TripRow = typeof trips.$inferSelect;
export type ReservationRow = typeof reservations.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type PlaceRow = typeof places.$inferSelect;
export type ItineraryItemRow = typeof itineraryItems.$inferSelect;
export type PackingCategoryRow = typeof packingCategories.$inferSelect;
export type PackingItemRow = typeof packingItems.$inferSelect;
export type TripMemoryRow = typeof tripMemories.$inferSelect;

/* ------------------------------- sharing ------------------------------- */

export const MEMBER_ROLES = ["editor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Display details of people who appear on shared trips, copied from the
 * verified session when they act (invite, accept, open a shared trip). Neon
 * Auth's own schema is never read from here. Names are shown to co-members;
 * the email is only ever shown to the trip owner.
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    user_id: text().primaryKey(),
    display_name: text().notNull(),
    email: text(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    check("user_profiles_name_length", sql`char_length(${t.display_name}) between 1 and 120`),
    check("user_profiles_email_length", sql`char_length(${t.email}) <= 320`),
  ],
);

/**
 * A person's own Settings, across every trip (appearance, in-app notification
 * types, travel preferences, display preferences, local display name). One
 * row per user, one jsonb column per section: saving a section merges into
 * that column only, so sections never overwrite each other. A missing row,
 * a null section or an unknown value all mean "use the defaults" — the shape
 * is validated on write (src/lib/settings.ts) and read leniently. Private to
 * the user: every query is constrained by `user_id`. No foreign key into the
 * `neon_auth` schema.
 */
export const userSettings = pgTable(
  "user_settings",
  {
    user_id: text().primaryKey(),
    appearance: jsonb().$type<Record<string, unknown>>(),
    /** Bumped by every appearance save; saves name the version they were based on (optimistic concurrency across devices). */
    appearance_version: integer().notNull().default(0),
    notifications: jsonb().$type<Record<string, unknown>>(),
    travel: jsonb().$type<Record<string, unknown>>(),
    display: jsonb().$type<Record<string, unknown>>(),
    /** Atlas-only display name; null = use the name from the Google account. */
    display_name: text(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    check("user_settings_user_length", sql`char_length(${t.user_id}) between 1 and 255`),
    check("user_settings_name_length", sql`${t.display_name} is null or char_length(${t.display_name}) between 1 and 80`),
    check(
      "user_settings_sections_small",
      sql`(${t.appearance} is null or (jsonb_typeof(${t.appearance}) = 'object' and octet_length(${t.appearance}::text) <= 2000))
        and (${t.notifications} is null or (jsonb_typeof(${t.notifications}) = 'object' and octet_length(${t.notifications}::text) <= 2000))
        and (${t.travel} is null or (jsonb_typeof(${t.travel}) = 'object' and octet_length(${t.travel}::text) <= 2000))
        and (${t.display} is null or (jsonb_typeof(${t.display}) = 'object' and octet_length(${t.display}::text) <= 2000))`,
    ),
  ],
);

/**
 * People a trip is shared with. The trip's single owner stays `trips.owner_id`
 * and is never a row here (CHECK + composite FK keep `owner_id` the trip's
 * owner). Removing a member deletes only this row — everything they added
 * stays on the trip (rows carry `created_by` as plain text, no foreign key).
 */
export const tripMembers = pgTable(
  "trip_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    user_id: text().notNull(),
    role: text({ enum: MEMBER_ROLES }).notNull(),
    invited_by: text().notNull(),
    joined_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trip_members_trip_user_unique").on(t.trip_id, t.user_id),
    foreignKey({
      name: "trip_members_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("trip_members_user_idx").on(t.user_id),
    check("trip_members_role_valid", inList(t.role, MEMBER_ROLES)),
    check("trip_members_not_owner", sql`${t.user_id} <> ${t.owner_id}`),
    check("trip_members_user_length", sql`char_length(${t.user_id}) between 1 and 255`),
  ],
);

/**
 * An offer to join a trip. Only the SHA-256 of the token is stored. An
 * email-bound invitation (`email` set) can only be accepted by a session whose
 * verified email matches; a copied link (`email` null) by any signed-in
 * person who explicitly accepts. Single use: the first acceptance wins.
 * Resending or "new link" replaces `token_hash`, which kills the old link.
 */
export const tripInvitations = pgTable(
  "trip_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    invited_by: text().notNull(),
    /** Display snapshot for the invitation page (the inviter's name at the time). */
    inviter_name: text().notNull(),
    /** Normalized (trimmed, lower-cased) intended email; null for a copied link. */
    email: text(),
    role: text({ enum: MEMBER_ROLES }).notNull(),
    token_hash: text().notNull(),
    expires_at: timestamp({ withTimezone: true, mode: "string" }).notNull(),
    accepted_at: timestamp({ withTimezone: true, mode: "string" }),
    accepted_by: text(),
    revoked_at: timestamp({ withTimezone: true, mode: "string" }),
    /** not_sent | sent | failed | not_configured — only "sent" after the provider accepted the message. */
    delivery_status: text().notNull().default("not_sent"),
    last_sent_at: timestamp({ withTimezone: true, mode: "string" }),
    send_count: integer().notNull().default(0),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trip_invitations_token_hash_unique").on(t.token_hash),
    foreignKey({
      name: "trip_invitations_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("trip_invitations_trip_idx").on(t.trip_id, t.created_at),
    check("trip_invitations_role_valid", inList(t.role, MEMBER_ROLES)),
    check("trip_invitations_email_length", sql`char_length(${t.email}) between 3 and 320`),
    check("trip_invitations_delivery_valid", sql`${t.delivery_status} in ('not_sent', 'sent', 'failed', 'not_configured')`),
    check("trip_invitations_one_outcome", sql`not (${t.accepted_at} is not null and ${t.revoked_at} is not null)`),
    check("trip_invitations_accepted_pair", sql`(${t.accepted_at} is null) = (${t.accepted_by} is null)`),
  ],
);

/**
 * Per-member private state on an Explore place: the heart and "Your notes".
 * Only the person it belongs to ever reads or writes it.
 */
export const placeMemberState = pgTable(
  "place_member_state",
  {
    place_id: uuid().notNull(),
    trip_id: uuid().notNull(),
    user_id: text().notNull(),
    is_favorite: boolean().notNull().default(false),
    notes: text(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "place_member_state_pk", columns: [t.place_id, t.user_id] }),
    foreignKey({
      name: "place_member_state_place_same_trip_fk",
      columns: [t.place_id, t.trip_id],
      foreignColumns: [places.id, places.trip_id],
    }).onDelete("cascade"),
    index("place_member_state_trip_user_idx").on(t.trip_id, t.user_id),
    check("place_member_state_notes_length", sql`char_length(${t.notes}) <= 5000`),
  ],
);

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type TripInvitationRow = typeof tripInvitations.$inferSelect;

/* ---------------------------- notifications ---------------------------- */

/**
 * A person's inbox. Each row belongs to exactly one recipient, so read /
 * archived state is personal — never shared across a trip's members. Every
 * query is constrained by `recipient_id` (the verified session user).
 *
 * Rows hold a short title/body, a typed related resource and minimal
 * metadata. They store NO URL: the in-app destination is derived on the
 * server from (type, trip, resource) every time, and whether the recipient
 * may still see the content is re-checked on every read. `trip_owner_id`
 * ties the row to the trip's real owner (composite FK, like every other trip
 * table) so deleting the trip removes its notifications.
 *
 * `dedupe_key` is chosen by the event that creates the notification and is
 * unique per recipient: creating the same event twice is a no-op.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipient_id: text().notNull(),
    trip_id: uuid(),
    trip_owner_id: text(),
    /** Registered in src/lib/notifications.ts; the DB only checks the shape. */
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    /** What it is about, e.g. ("invitation", <id>) or ("itinerary_item", <id>). */
    resource_type: text(),
    resource_id: uuid(),
    /** The person whose action caused it (never the recipient). Null for system events. */
    actor_id: text(),
    dedupe_key: text().notNull(),
    metadata: jsonb().$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    read_at: timestamp({ withTimezone: true, mode: "string" }),
    archived_at: timestamp({ withTimezone: true, mode: "string" }),
  },
  (t) => [
    unique("notifications_recipient_dedupe_unique").on(t.recipient_id, t.dedupe_key),
    foreignKey({
      name: "notifications_trip_same_owner_fk",
      columns: [t.trip_id, t.trip_owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    index("notifications_recipient_created_idx").on(t.recipient_id, t.created_at.desc(), t.id.desc()),
    index("notifications_recipient_unread_idx")
      .on(t.recipient_id)
      .where(sql`${t.read_at} is null and ${t.archived_at} is null`),
    index("notifications_trip_recipient_idx").on(t.trip_id, t.recipient_id),
    check("notifications_type_shape", sql`${t.type} ~ '^[a-z][a-z_]{0,39}$'`),
    check("notifications_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("notifications_body_length", sql`char_length(${t.body}) between 1 and 400`),
    check("notifications_dedupe_length", sql`char_length(${t.dedupe_key}) between 1 and 200`),
    check("notifications_recipient_length", sql`char_length(${t.recipient_id}) between 1 and 255`),
    check("notifications_not_self", sql`${t.actor_id} is null or ${t.actor_id} <> ${t.recipient_id}`),
    check("notifications_trip_pair", sql`(${t.trip_id} is null) = (${t.trip_owner_id} is null)`),
    check(
      "notifications_metadata_small",
      sql`jsonb_typeof(${t.metadata}) = 'object' and octet_length(${t.metadata}::text) <= 1000`,
    ),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;


/* -------------------------------- polls -------------------------------- */

export const POLL_STATUS_VALUES = ["open", "closed", "canceled"] as const;
export const POLL_PARENT_VALUES = ["trip", "day", "activity", "place"] as const;

/**
 * "Ask the group". A small decision attached to the trip, a day, an
 * activity or an Explore place. Every link is composite-keyed to the SAME
 * trip, so the database refuses a cross-trip reference. Votes are separate
 * rows (one per person); the organizer's final choice is its own column and
 * is never derived from the totals. If a linked activity / place is deleted
 * the poll stays (the link becomes null) so decisions are not lost.
 */
export const polls = pgTable(
  "polls",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    created_by: text().notNull(),
    question: text().notNull(),
    description: text(),
    parent_type: text({ enum: POLL_PARENT_VALUES }).notNull().default("trip"),
    parent_day: date({ mode: "string" }),
    parent_item_id: uuid(),
    parent_place_id: uuid(),
    status: text({ enum: POLL_STATUS_VALUES }).notNull().default("open"),
    closes_at: timestamp({ withTimezone: true, mode: "string" }),
    /** Offer the separate "Any works for me" response (an abstention, never a vote for every option). */
    any_option: boolean().notNull().default(true),
    closed_at: timestamp({ withTimezone: true, mode: "string" }),
    closed_by: text(),
    canceled_at: timestamp({ withTimezone: true, mode: "string" }),
    /** The organizer's explicit decision. Separate from the totals; ties and leaders decide nothing. */
    result_option_id: uuid(),
    result_selected_by: text(),
    result_selected_at: timestamp({ withTimezone: true, mode: "string" }),
    /** Totals as they stood when the result was chosen — later departures never rewrite them. */
    result_tally: jsonb().$type<{ counts: Record<string, number>; any: number; voted: number; eligible: number }>(),
    /** The poll this one replaces ("Create a revised poll"). */
    replaces_poll_id: uuid(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "polls_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "polls_item_same_trip_fk",
      columns: [t.parent_item_id, t.trip_id],
      foreignColumns: [itineraryItems.id, itineraryItems.trip_id],
    }).onDelete("set null"),
    foreignKey({
      name: "polls_place_same_trip_fk",
      columns: [t.parent_place_id, t.trip_id],
      foreignColumns: [places.id, places.trip_id],
    }).onDelete("set null"),
    unique("polls_id_trip_unique").on(t.id, t.trip_id),
    index("polls_trip_idx").on(t.trip_id, t.created_at),
    check("polls_status_valid", inList(t.status, POLL_STATUS_VALUES)),
    check("polls_parent_valid", inList(t.parent_type, POLL_PARENT_VALUES)),
    check("polls_question_length", sql`char_length(${t.question}) between 3 and 140`),
    check("polls_description_length", sql`char_length(${t.description}) <= 500`),
    check(
      "polls_parent_columns",
      sql`(${t.parent_day} is null or ${t.parent_type} = 'day')
        and (${t.parent_item_id} is null or ${t.parent_type} = 'activity')
        and (${t.parent_place_id} is null or ${t.parent_type} = 'place')`,
    ),
    check("polls_canceled_pair", sql`(${t.status} = 'canceled') = (${t.canceled_at} is not null)`),
    check("polls_result_not_canceled", sql`${t.result_option_id} is null or ${t.status} = 'closed'`),
    check("polls_result_pair", sql`(${t.result_option_id} is null) = (${t.result_selected_at} is null)`),
  ],
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: uuid().primaryKey().defaultRandom(),
    poll_id: uuid().notNull(),
    trip_id: uuid().notNull(),
    position: integer().notNull(),
    /** What was shown (for an Explore option, the place's name when the poll was made). */
    label: text().notNull(),
    place_id: uuid(),
  },
  (t) => [
    foreignKey({
      name: "poll_options_poll_same_trip_fk",
      columns: [t.poll_id, t.trip_id],
      foreignColumns: [polls.id, polls.trip_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "poll_options_place_same_trip_fk",
      columns: [t.place_id, t.trip_id],
      foreignColumns: [places.id, places.trip_id],
    }).onDelete("set null"),
    unique("poll_options_id_poll_unique").on(t.id, t.poll_id),
    unique("poll_options_position_unique").on(t.poll_id, t.position),
    check("poll_options_position_range", sql`${t.position} between 1 and 3`),
    check("poll_options_label_length", sql`char_length(${t.label}) between 1 and 80`),
  ],
);

/** Who was asked. Explicit rows (default: everyone on the trip at the time); being listed never grants access. */
export const pollParticipants = pgTable(
  "poll_participants",
  {
    poll_id: uuid().notNull(),
    trip_id: uuid().notNull(),
    user_id: text().notNull(),
  },
  (t) => [
    primaryKey({ name: "poll_participants_pk", columns: [t.poll_id, t.user_id] }),
    foreignKey({
      name: "poll_participants_poll_same_trip_fk",
      columns: [t.poll_id, t.trip_id],
      foreignColumns: [polls.id, polls.trip_id],
    }).onDelete("cascade"),
  ],
);

/**
 * One current response per person per poll (the primary key). `option_id`
 * null = "Any works for me". Votes of people who later leave are kept as
 * history but are not counted in the active totals.
 */
export const pollVotes = pgTable(
  "poll_votes",
  {
    poll_id: uuid().notNull(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    user_id: text().notNull(),
    option_id: uuid(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "poll_votes_pk", columns: [t.poll_id, t.user_id] }),
    foreignKey({
      name: "poll_votes_poll_same_trip_fk",
      columns: [t.poll_id, t.trip_id],
      foreignColumns: [polls.id, polls.trip_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "poll_votes_option_same_poll_fk",
      columns: [t.option_id, t.poll_id],
      foreignColumns: [pollOptions.id, pollOptions.poll_id],
    }),
    index("poll_votes_trip_idx").on(t.trip_id),
  ],
);

export type PollRow = typeof polls.$inferSelect;

/* ------------------------- evening preview ------------------------- */

export const PREVIEW_CHANNELS = ["in_app", "email"] as const;
export const PREVIEW_DELIVERY_STATUSES = ["pending", "sending", "sent", "skipped", "failed"] as const;

/**
 * One person's opt-in to the evening preview of tomorrow, per trip. Off until
 * they turn it on. `send_time` is wall-clock in the TRIP's time zone. Rows are
 * private to the person (only they read or change theirs) and are deleted when
 * they leave or are removed from the trip.
 */
export const eveningPreviewPrefs = pgTable(
  "evening_preview_prefs",
  {
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    user_id: text().notNull(),
    enabled: boolean().notNull().default(false),
    send_time: time().notNull().default("19:00:00"),
    in_app: boolean().notNull().default(true),
    email: boolean().notNull().default(false),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "evening_preview_prefs_pk", columns: [t.trip_id, t.user_id] }),
    foreignKey({
      name: "evening_preview_prefs_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    check("evening_preview_prefs_time_range", sql`${t.send_time} between '16:00' and '22:00'`),
    check("evening_preview_prefs_channel", sql`${t.in_app} or ${t.email}`),
  ],
);

/**
 * The delivery ledger: one row per recipient, trip, target date and channel
 * (the unique key). Claiming a row is what makes concurrent workers and
 * retries safe. It stores no preview content — only what happened.
 */
export const eveningPreviewDeliveries = pgTable(
  "evening_preview_deliveries",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    user_id: text().notNull(),
    target_date: date({ mode: "string" }).notNull(),
    channel: text({ enum: PREVIEW_CHANNELS }).notNull(),
    status: text({ enum: PREVIEW_DELIVERY_STATUSES }).notNull().default("pending"),
    reason: text(),
    attempts: integer().notNull().default(0),
    /** A worker holds the claim until this time; after it another worker may retry. */
    locked_until: timestamp({ withTimezone: true, mode: "string" }),
    scheduled_for: timestamp({ withTimezone: true, mode: "string" }),
    sent_at: timestamp({ withTimezone: true, mode: "string" }),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    unique("evening_preview_delivery_key").on(t.trip_id, t.user_id, t.target_date, t.channel),
    foreignKey({
      name: "evening_preview_deliveries_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    check("evening_preview_deliveries_channel", inList(t.channel, PREVIEW_CHANNELS)),
    check("evening_preview_deliveries_status", inList(t.status, PREVIEW_DELIVERY_STATUSES)),
    check("evening_preview_deliveries_reason_length", sql`char_length(${t.reason}) <= 80`),
  ],
);

/** When a scheduled job last ran — so the app can say honestly whether scheduled delivery is active. */
export const schedulerHeartbeats = pgTable("scheduler_heartbeats", {
  job: text().primaryKey(),
  last_started_at: timestamp({ withTimezone: true, mode: "string" }),
  last_finished_at: timestamp({ withTimezone: true, mode: "string" }),
  last_result: jsonb().$type<Record<string, number>>(),
});


/* ------------------------------- reminders ------------------------------- */

export const REMINDER_SUBJECTS = ["booking", "task"] as const;
export const REMINDER_PRESET_VALUES = ["24h", "2h", "at_due", "1d_before", "custom"] as const;
export const REMINDER_STATUS_VALUES = ["pending", "sending", "sent", "failed", "skipped", "canceled"] as const;
export const REMINDER_EMAIL_STATUS_VALUES = ["none", "pending", "sending", "sent", "failed", "skipped"] as const;

/**
 * A person's own reminder settings, across every trip: whether reminders reach
 * them at all, which channels, quiet hours and the default time of day offered
 * for date-only tasks. Private to them — only they read or change their row.
 * No row = the defaults (reminders on, inbox only, no quiet hours).
 */
export const reminderPrefs = pgTable(
  "reminder_prefs",
  {
    user_id: text().primaryKey(),
    enabled: boolean().notNull().default(true),
    in_app: boolean().notNull().default(true),
    email: boolean().notNull().default(false),
    quiet_enabled: boolean().notNull().default(false),
    quiet_start: time().notNull().default("22:00:00"),
    quiet_end: time().notNull().default("07:00:00"),
    /** IANA zone the quiet hours are written in. */
    quiet_zone: text(),
    default_task_time: time().notNull().default("09:00:00"),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    check("reminder_prefs_user_length", sql`char_length(${t.user_id}) between 1 and 255`),
    check("reminder_prefs_channel", sql`${t.in_app} or ${t.email}`),
    check("reminder_prefs_quiet_zone", sql`not ${t.quiet_enabled} or (${t.quiet_zone} is not null and char_length(${t.quiet_zone}) between 1 and 64)`),
    check("reminder_prefs_quiet_span", sql`${t.quiet_start} <> ${t.quiet_end}`),
  ],
);

/**
 * One persisted reminder: one person, one confirmed booking or one task, one
 * rule — and the CURRENT occurrence of it (`occurrence` rises when the record's
 * time changes or the reminder is snoozed, so each occurrence is delivered at
 * most once). This row IS the job: the worker claims it, delivers through the
 * notification service, and records what happened; there is no second queue.
 *
 * `target_at` is the booking start / task due instant this occurrence was
 * scheduled against. Delivery recomputes it from the live record and refuses
 * to deliver when it differs (stale-job protection on top of the transactional
 * rescheduling every record write performs).
 *
 * Deleting the booking or task, or the trip, deletes its reminders (cascade);
 * a trigger first marks any inbox item already sent for them "canceled".
 */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid().primaryKey().defaultRandom(),
    trip_id: uuid().notNull(),
    owner_id: text().notNull(),
    subject_type: text({ enum: REMINDER_SUBJECTS }).notNull(),
    reservation_id: uuid(),
    packing_item_id: uuid(),
    recipient_id: text().notNull(),
    preset: text({ enum: REMINDER_PRESET_VALUES }).notNull(),
    /** Exact-moment subjects: minutes before the start / due moment (0 = at it). */
    lead_minutes: integer(),
    /** Date-only tasks: whole days before the due date, at `local_time`. */
    days_before: integer(),
    local_time: time(),
    occurrence: integer().notNull().default(1),
    status: text({ enum: REMINDER_STATUS_VALUES }).notNull().default("pending"),
    status_reason: text(),
    target_at: timestamp({ withTimezone: true, mode: "string" }),
    natural_fire_at: timestamp({ withTimezone: true, mode: "string" }),
    fire_at: timestamp({ withTimezone: true, mode: "string" }),
    /** Freshness: after this the occurrence is never delivered (no backlog after downtime). */
    expires_at: timestamp({ withTimezone: true, mode: "string" }),
    /** earlier | later | allowed — set when quiet hours changed the time. */
    adjustment: text(),
    adjustment_note: text(),
    /** The recipient chose to receive this one even inside their quiet hours. */
    quiet_override: boolean().notNull().default(false),
    snoozed_until: timestamp({ withTimezone: true, mode: "string" }),
    snooze_count: integer().notNull().default(0),
    attempts: integer().notNull().default(0),
    claim_token: uuid(),
    locked_until: timestamp({ withTimezone: true, mode: "string" }),
    /** The worker's decision for this occurrence was made (in-app done; email may still be pending). */
    decided_at: timestamp({ withTimezone: true, mode: "string" }),
    in_app_sent_at: timestamp({ withTimezone: true, mode: "string" }),
    email_status: text({ enum: REMINDER_EMAIL_STATUS_VALUES }).notNull().default("none"),
    email_attempts: integer().notNull().default(0),
    email_next_at: timestamp({ withTimezone: true, mode: "string" }),
    email_locked_until: timestamp({ withTimezone: true, mode: "string" }),
    email_sent_at: timestamp({ withTimezone: true, mode: "string" }),
    sent_at: timestamp({ withTimezone: true, mode: "string" }),
    created_by: text(),
    created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "reminders_trip_same_owner_fk",
      columns: [t.trip_id, t.owner_id],
      foreignColumns: [trips.id, trips.owner_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reminders_reservation_same_trip_fk",
      columns: [t.reservation_id, t.trip_id],
      foreignColumns: [reservations.id, reservations.trip_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reminders_packing_item_same_trip_fk",
      columns: [t.packing_item_id, t.trip_id],
      foreignColumns: [packingItems.id, packingItems.trip_id],
    }).onDelete("cascade"),
    uniqueIndex("reminders_reservation_recipient_unique").on(t.reservation_id, t.recipient_id).where(sql`${t.reservation_id} is not null`),
    uniqueIndex("reminders_packing_item_recipient_unique").on(t.packing_item_id, t.recipient_id).where(sql`${t.packing_item_id} is not null`),
    index("reminders_due_idx").on(t.fire_at).where(sql`${t.status} in ('pending', 'sending')`),
    index("reminders_email_idx").on(t.email_next_at).where(sql`${t.email_status} in ('pending', 'failed')`),
    index("reminders_recipient_idx").on(t.recipient_id, t.trip_id),
    check("reminders_subject_shape", sql`(${t.subject_type} = 'booking' and ${t.reservation_id} is not null and ${t.packing_item_id} is null) or (${t.subject_type} = 'task' and ${t.packing_item_id} is not null and ${t.reservation_id} is null)`),
    check("reminders_preset_valid", inList(t.preset, REMINDER_PRESET_VALUES)),
    check("reminders_status_valid", inList(t.status, REMINDER_STATUS_VALUES)),
    check("reminders_email_status_valid", inList(t.email_status, REMINDER_EMAIL_STATUS_VALUES)),
    check("reminders_recipient_length", sql`char_length(${t.recipient_id}) between 1 and 255`),
    check("reminders_rule_shape", sql`(${t.lead_minutes} is not null and ${t.days_before} is null and ${t.local_time} is null) or (${t.lead_minutes} is null and ${t.days_before} is not null and ${t.local_time} is not null)`),
    check("reminders_lead_range", sql`${t.lead_minutes} is null or ${t.lead_minutes} between 0 and 43200`),
    check("reminders_days_range", sql`${t.days_before} is null or ${t.days_before} between 0 and 30`),
    check("reminders_booking_lead", sql`${t.subject_type} <> 'booking' or ${t.lead_minutes} >= 1`),
    check("reminders_occurrence_positive", sql`${t.occurrence} >= 1`),
    check("reminders_reason_length", sql`char_length(${t.status_reason}) <= 40`),
    check("reminders_note_length", sql`char_length(${t.adjustment_note}) <= 300`),
  ],
);

export type ReminderRow = typeof reminders.$inferSelect;
export type ReminderPrefsRow = typeof reminderPrefs.$inferSelect;
