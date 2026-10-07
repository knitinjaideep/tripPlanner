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
    traveler_name: text(),
    notes: text(),
    is_packed: boolean().notNull().default(false),
    sort_order: integer().notNull().default(0),
    ...attribution,
    ...timestamps,
  },
  (t) => [
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
