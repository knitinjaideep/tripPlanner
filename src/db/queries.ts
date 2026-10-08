import "server-only";
import { and, asc, count, eq, getTableColumns, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "./index";
import { safely } from "./notifications";
import { syncSubject, syncTrip } from "./reminders";
import {
  documents,
  itineraryItems,
  packingCategories,
  packingItems,
  placeMemberState,
  places,
  reservations,
  tripMembers,
  tripMemories,
  trips,
} from "./schema";
import { exploreKindFor } from "@/lib/plan-options";
import {
  fingerprint,
  mergeNotes,
  planPreview,
  planValues,
  previewToken,
  sourceKey,
  type ItineraryPlan,
  type PlanChoice,
  type PlanPreview,
} from "@/lib/plans/itinerary-plan";
import {
  collectionMatchesTrip,
  planCollectionImport,
  priorityFor,
  recommendationFor,
  type ExploreCollection,
  type ImportSummary,
} from "@/lib/collections/collection";
import { todayInTimeZone } from "@/lib/dates";
import { planBabyImport, type PlanEntry } from "@/lib/baby-packing";
import { normalizeName, planMerge, starterSource, type MergeSourceCategory, type StarterKey } from "@/lib/packing";
import {
  addDays,
  categoryForReservation,
  daysBetweenDates,
  standaloneScheduleFromReservation,
  visitHasUserContent,
} from "@/lib/schedule";
import type {
  DocumentInput,
  ItineraryEntry,
  ItineraryItemInput,
  PackingCategoryInput,
  PackingCategoryWithItems,
  PackingItemInput,
  PackingSource,
  PlaceInput,
  PlaceWithVisits,
  Reservation,
  ReservationInput,
  Trip,
  TripDocument,
  TripInput,
  TripMemory,
  TripMemoryInput,
  TripWithDetails,
  VisitReviewInput,
} from "@/lib/types";

/**
 * Owner-scoped queries. Every function takes the *verified* owner ID as its
 * first argument and constrains every statement by it, in the same statement
 * as the read or write. Nothing here is callable from the browser: these are
 * only reached through src/lib/dal.ts, which verifies the session first.
 *
 * Child rows also carry owner_id, and composite foreign keys
 * (trip_id, owner_id) → trips(id, owner_id) and
 * (reservation_id, trip_id) → reservations(id, trip_id) make Postgres reject
 * an insert/update that targets another user's trip or another trip's
 * reservation, even if a predicate here were wrong.
 */

export type OwnerId = string;

/** The database or an open transaction. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/* ----------------------------- errors ----------------------------- */

type PgErrorLike = { code?: string; constraint?: string };

/** Drizzle wraps driver errors; find the underlying Postgres error. */
function pgError(error: unknown): PgErrorLike | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as PgErrorLike & { cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    current = e.cause;
  }
  return null;
}

function isForeignKeyViolation(error: unknown, constraint: string) {
  const pg = pgError(error);
  return pg?.code === "23503" && pg.constraint === constraint;
}

function isUniqueViolation(error: unknown, constraint: string) {
  const pg = pgError(error);
  return pg?.code === "23505" && pg.constraint === constraint;
}

/** The owner's trip (schedule defaults only), or null. Optionally row-locked. */
async function ownedTrip(db: Executor, ownerId: OwnerId, tripId: string, lock = false) {
  const query = db
    .select({ id: trips.id, start_date: trips.start_date, end_date: trips.end_date, time_zone: trips.time_zone })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/* ------------------------------ trips ----------------------------- */

export async function listTrips(db: Db, ownerId: OwnerId): Promise<Trip[]> {
  return db
    .select()
    .from(trips)
    .where(eq(trips.owner_id, ownerId))
    .orderBy(asc(trips.start_date), asc(trips.created_at));
}

export async function getTripWithDetails(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
): Promise<TripWithDetails | null> {
  // All three reads are owner-constrained, so they can run in parallel.
  const [tripRows, reservationRows, documentRows] = await Promise.all([
    db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
      .limit(1),
    db
      .select()
      .from(reservations)
      .where(and(eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId)))
      .orderBy(
        sql`${reservations.start_date} asc nulls last`,
        sql`${reservations.start_time} asc nulls last`,
        asc(reservations.created_at),
      ),
    db
      .select()
      .from(documents)
      .where(and(eq(documents.trip_id, tripId), eq(documents.owner_id, ownerId)))
      .orderBy(asc(documents.created_at)),
  ]);

  const trip = tripRows[0];
  if (!trip) return null;
  return { ...trip, reservations: reservationRows as Reservation[], documents: documentRows as TripDocument[] };
}

export async function createTrip(db: Db, ownerId: OwnerId, input: TripInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(trips)
    .values({ ...input, owner_id: ownerId })
    .returning({ id: trips.id });
  return row;
}

/** Returns false when the trip does not exist or is not this owner's. */
export async function updateTrip(db: Db, ownerId: OwnerId, tripId: string, input: TripInput) {
  const rows = await db
    .update(trips)
    .set(input)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
    .returning({ id: trips.id });
  // A booking without a zone of its own follows the trip's zone, so its reminders are re-evaluated.
  if (rows.length === 1) await safely(db, "reminder_sync_trip", (tx) => syncTrip(tx, tripId));
  return rows.length === 1;
}

/** Deletes the trip and (by cascade) its reservations and documents. */
export async function deleteTrip(db: Db, ownerId: OwnerId, tripId: string) {
  const rows = await db
    .delete(trips)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
    .returning({ id: trips.id });
  return rows.length === 1;
}

/* -------------------------- reservations -------------------------- */

/** Returns null when the target trip is not this owner's. */
export async function createReservation(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  input: ReservationInput,
): Promise<{ id: string } | null> {
  try {
    const [row] = await db
      .insert(reservations)
      .values({ ...input, trip_id: tripId, owner_id: ownerId })
      .returning({ id: reservations.id });
    return row;
  } catch (error) {
    // The composite FK only accepts (trip_id, owner_id) pairs that exist in trips.
    if (isForeignKeyViolation(error, "reservations_trip_same_owner_fk")) return null;
    throw error;
  }
}

export type ReservationUpdateResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "linked_visit_needs_date" | "conflict" };

/**
 * A reservation that backs an itinerary visit must keep a date (the visit
 * takes its schedule from it), so clearing the date is refused.
 */
async function updateReservationWrite(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  reservationId: string,
  input: ReservationInput,
  expectedUpdatedAt?: string,
): Promise<ReservationUpdateResult> {
  return db.transaction(async (tx) => {
    if (!input.start_date) {
      const [linked] = await tx
        .select({ id: itineraryItems.id })
        .from(itineraryItems)
        .where(and(eq(itineraryItems.reservation_id, reservationId), eq(itineraryItems.owner_id, ownerId)))
        .limit(1);
      if (linked) return { ok: false, reason: "linked_visit_needs_date" };
    }
    const rows = await tx
      .update(reservations)
      .set(input)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.trip_id, tripId),
          eq(reservations.owner_id, ownerId),
          expectedUpdatedAt ? sql`${reservations.updated_at} = ${expectedUpdatedAt}::timestamptz` : undefined,
        ),
      )
      .returning({ id: reservations.id });
    if (rows.length === 1) return { ok: true };
    if (expectedUpdatedAt) {
      // Distinguish "someone changed it while you were editing" from "it is gone".
      const [still] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId)));
      if (still) return { ok: false, reason: "conflict" };
    }
    return { ok: false, reason: "not_found" };
  });
}

/** Edits a booking. Its reminders follow the change (time, zone or status) in the same transaction when called through the DAL. */
export async function updateReservation(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  reservationId: string,
  input: ReservationInput,
  expectedUpdatedAt?: string,
) {
  const result = await updateReservationWrite(db, ownerId, tripId, reservationId, input, expectedUpdatedAt);
  if (result.ok) await safely(db, "reminder_sync_booking", (tx) => syncSubject(tx, tripId, "booking", reservationId));
  return result;
}

/**
 * Deletes a booking in one transaction. Documents attached to it stay on
 * the trip (FK sets reservation_id to null). A linked itinerary visit that
 * holds anything the traveler wrote (notes, status, rating, reflection,
 * favorite, place, title) is kept as a standalone visit with the booking's
 * title and schedule; a bare link is removed with the booking.
 *
 * Returns null when not found, else how many visits were kept.
 */
export async function deleteReservation(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  reservationId: string,
): Promise<{ keptVisits: number } | null> {
  return db.transaction(async (tx) => {
    const trip = await ownedTrip(tx, ownerId, tripId);
    if (!trip) return null;
    const [booking] = await tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.trip_id, tripId),
          eq(reservations.owner_id, ownerId),
        ),
      )
      .for("update");
    if (!booking) return null;

    const visits = await tx
      .select()
      .from(itineraryItems)
      .where(and(eq(itineraryItems.reservation_id, reservationId), eq(itineraryItems.owner_id, ownerId)));
    let keptVisits = 0;
    for (const visit of visits) {
      if (visitHasUserContent(visit)) {
        keptVisits++;
        await tx
          .update(itineraryItems)
          .set({
            reservation_id: null,
            title: visit.title ?? booking.title.slice(0, 160),
            ...standaloneScheduleFromReservation(booking, trip),
          })
          .where(and(eq(itineraryItems.id, visit.id), eq(itineraryItems.owner_id, ownerId)));
      } else {
        await tx
          .delete(itineraryItems)
          .where(and(eq(itineraryItems.id, visit.id), eq(itineraryItems.owner_id, ownerId)));
      }
    }

    await tx
      .delete(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.owner_id, ownerId)));
    return { keptVisits };
  });
}

/* ---------------------------- documents --------------------------- */

export type DocumentWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "reservation_not_in_trip" };

export async function createDocument(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  input: DocumentInput,
): Promise<DocumentWriteResult> {
  try {
    const [row] = await db
      .insert(documents)
      .values({ ...input, trip_id: tripId, owner_id: ownerId })
      .returning({ id: documents.id });
    return { ok: true, id: row.id };
  } catch (error) {
    if (isForeignKeyViolation(error, "documents_trip_same_owner_fk")) return { ok: false, reason: "not_found" };
    if (isForeignKeyViolation(error, "documents_reservation_same_trip_fk")) {
      return { ok: false, reason: "reservation_not_in_trip" };
    }
    throw error;
  }
}

export async function updateDocument(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  documentId: string,
  input: DocumentInput,
): Promise<DocumentWriteResult> {
  try {
    const rows = await db
      .update(documents)
      .set(input)
      .where(and(eq(documents.id, documentId), eq(documents.trip_id, tripId), eq(documents.owner_id, ownerId)))
      .returning({ id: documents.id });
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not_found" };
  } catch (error) {
    // A proposed reservation_id must belong to this same trip.
    if (isForeignKeyViolation(error, "documents_reservation_same_trip_fk")) {
      return { ok: false, reason: "reservation_not_in_trip" };
    }
    throw error;
  }
}

export async function deleteDocument(db: Db, ownerId: OwnerId, tripId: string, documentId: string) {
  const rows = await db
    .delete(documents)
    .where(and(eq(documents.id, documentId), eq(documents.trip_id, tripId), eq(documents.owner_id, ownerId)))
    .returning({ id: documents.id });
  return rows.length === 1;
}

/* ----------------------------- places ----------------------------- */

/**
 * Explore list with derived visit state, or null when the trip isn't the owner's.
 * `viewerId` is the signed-in member: the heart and "Your notes" are theirs
 * alone (place_member_state), never the trip's shared columns.
 */
export async function listPlaces(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  viewerId: string = ownerId,
): Promise<PlaceWithVisits[] | null> {
  const [trip, rows] = await Promise.all([
    ownedTrip(db, ownerId, tripId),
    db
      .select({
        ...getTableColumns(places),
        is_favorite: sql<boolean>`coalesce((select s.is_favorite from place_member_state s where s.place_id = ${places.id} and s.user_id = ${viewerId}), false)`,
        my_notes: sql<string | null>`(select s.notes from place_member_state s where s.place_id = ${places.id} and s.user_id = ${viewerId})`,
        visit_count: sql<number>`count(${itineraryItems.id})::int`,
        planned_count: sql<number>`(count(*) filter (where ${itineraryItems.status} = 'planned'))::int`,
        completed_count: sql<number>`(count(*) filter (where ${itineraryItems.status} = 'completed'))::int`,
        visited: sql<boolean>`coalesce(bool_or(${itineraryItems.status} = 'completed'), false)`,
        // float8 / text casts: node-postgres returns numbers and "YYYY-MM-DD" strings, never Dates.
        rating_avg: sql<number | null>`(avg(${itineraryItems.rating}) filter (where ${itineraryItems.status} = 'completed'))::float8`,
        rated_count: sql<number>`(count(${itineraryItems.rating}) filter (where ${itineraryItems.status} = 'completed'))::int`,
        next_planned_date: sql<string | null>`(min(${itineraryItems.local_date}) filter (where ${itineraryItems.status} = 'planned'))::text`,
        last_completed_date: sql<string | null>`(max(${itineraryItems.local_date}) filter (where ${itineraryItems.status} = 'completed'))::text`,
      })
      .from(places)
      .leftJoin(
        itineraryItems,
        and(eq(itineraryItems.place_id, places.id), eq(itineraryItems.owner_id, ownerId)),
      )
      .where(and(eq(places.trip_id, tripId), eq(places.owner_id, ownerId)))
      .groupBy(places.id)
      .orderBy(sql`${places.priority} = 'must_do' desc`, asc(places.created_at)),
  ]);
  return trip ? rows : null;
}

export type PlaceWriteResult = { ok: true; id: string } | { ok: false; reason: "not_found" };

/**
 * `requestId` (a UUID the form generates once) becomes the new row's id, so
 * a double-click or retried submit returns the same place instead of
 * creating a second one. A requestId already used elsewhere is "not found".
 */
export async function createPlace(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  input: PlaceInput,
  requestId?: string,
): Promise<PlaceWriteResult> {
  try {
    const [row] = await db
      .insert(places)
      .values({ ...input, ...(requestId ? { id: requestId } : {}), trip_id: tripId, owner_id: ownerId })
      .onConflictDoNothing({ target: places.id })
      .returning({ id: places.id });
    if (row) return { ok: true, id: row.id };
    const [existing] = await db
      .select({ id: places.id })
      .from(places)
      .where(and(eq(places.id, requestId!), eq(places.trip_id, tripId), eq(places.owner_id, ownerId)));
    return existing ? { ok: true, id: existing.id } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (isForeignKeyViolation(error, "places_trip_same_owner_fk")) return { ok: false, reason: "not_found" };
    throw error;
  }
}

/**
 * true = saved, false = not found, "conflict" = it changed since the editor
 * opened it (`expectedUpdatedAt`), so nothing was overwritten.
 */
export async function updatePlace(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  placeId: string,
  input: PlaceInput,
  expectedUpdatedAt?: string,
): Promise<boolean | "conflict"> {
  const rows = await db
    .update(places)
    .set(input)
    .where(
      and(
        eq(places.id, placeId),
        eq(places.trip_id, tripId),
        eq(places.owner_id, ownerId),
        expectedUpdatedAt ? sql`${places.updated_at} = ${expectedUpdatedAt}::timestamptz` : undefined,
      ),
    )
    .returning({ id: places.id });
  if (rows.length === 1) return true;
  if (expectedUpdatedAt && (await placeInTrip(db, ownerId, tripId, placeId))) return "conflict";
  return false;
}

/** The place must be in this trip; false = not found. */
async function placeInTrip(db: Executor, ownerId: OwnerId, tripId: string, placeId: string) {
  const [row] = await db
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.id, placeId), eq(places.trip_id, tripId), eq(places.owner_id, ownerId)));
  return Boolean(row);
}

/**
 * "Your notes": private to `viewerId` (place_member_state) — never the
 * trip's shared notes, never visible to other members. false = not found.
 */
export async function updatePlaceNotes(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  placeId: string,
  notes: string | null,
  viewerId: string = ownerId,
) {
  if (!(await placeInTrip(db, ownerId, tripId, placeId))) return false;
  await db
    .insert(placeMemberState)
    .values({ place_id: placeId, trip_id: tripId, user_id: viewerId, notes })
    .onConflictDoUpdate({
      target: [placeMemberState.place_id, placeMemberState.user_id],
      set: { notes, updated_at: sql`now()` },
    });
  return true;
}

/** The viewer's own heart. Sets the given value (never inverts), so repeated clicks converge. */
export async function setPlaceFavorite(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  placeId: string,
  favorite: boolean,
  viewerId: string = ownerId,
) {
  if (!(await placeInTrip(db, ownerId, tripId, placeId))) return false;
  await db
    .insert(placeMemberState)
    .values({ place_id: placeId, trip_id: tripId, user_id: viewerId, is_favorite: favorite })
    .onConflictDoUpdate({
      target: [placeMemberState.place_id, placeMemberState.user_id],
      set: { is_favorite: favorite, updated_at: sql`now()` },
    });
  return true;
}

export type CollectionImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; reason: "not_found" | "not_matching" };

/**
 * Import a curated collection into one of the owner's trips, in one
 * transaction with the trip row locked (a double click or second tab waits,
 * then finds everything already there). Idempotent by `source_key`, with the
 * unique (trip_id, source_key) constraint as the last line of defence.
 *
 * Writes only: new places, `source_key` + `recommendation` on a claimed
 * place (plus its website when it had none), and refreshed `recommendation`
 * on places imported earlier. Never touches names, categories, priorities,
 * notes, favorites, visits, itinerary entries or bookings.
 */
export async function importExploreCollection(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  collection: ExploreCollection,
): Promise<CollectionImportResult> {
  return db.transaction(async (tx): Promise<CollectionImportResult> => {
    const [trip] = await tx
      .select({ id: trips.id, title: trips.title, destination: trips.destination })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
      .for("update");
    if (!trip) return { ok: false, reason: "not_found" };
    if (!collectionMatchesTrip(collection, trip)) return { ok: false, reason: "not_matching" };

    const existing = await tx
      .select({
        id: places.id,
        name: places.name,
        kind: places.kind,
        source_key: places.source_key,
        recommendation: places.recommendation,
      })
      .from(places)
      .where(and(eq(places.trip_id, tripId), eq(places.owner_id, ownerId)))
      .orderBy(asc(places.created_at));

    const summary: ImportSummary = {
      total: collection.items.length,
      added: 0,
      existing: 0,
      refreshed: 0,
      linked: [],
      skipped: [],
      possibleDuplicates: [],
    };
    const own = (placeId: string) =>
      and(eq(places.id, placeId), eq(places.trip_id, tripId), eq(places.owner_id, ownerId));

    for (const op of planCollectionImport(collection, existing)) {
      const recommendation = recommendationFor(collection, op.item);
      if (op.kind === "existing") {
        summary.existing++;
      } else if (op.kind === "refresh") {
        await tx.update(places).set({ recommendation }).where(own(op.placeId));
        summary.existing++;
        summary.refreshed++;
      } else if (op.kind === "link") {
        const rows = await tx
          .update(places)
          .set({
            source_key: op.item.sourceKey,
            recommendation,
            website_url: sql`coalesce(${places.website_url}, ${op.item.website})`,
          })
          .where(and(own(op.placeId), sql`${places.source_key} is null`))
          .returning({ id: places.id });
        if (rows.length) summary.linked.push({ name: op.item.name, placeName: op.placeName });
      } else if (op.kind === "skip") {
        summary.skipped.push({ name: op.item.name, matches: op.matches });
      } else {
        const inserted = await tx
          .insert(places)
          .values({
            name: op.item.name,
            kind: op.item.kind,
            category: op.item.category,
            priority: priorityFor(op.item.recommendation.tier),
            website_url: op.item.website,
            source_key: op.item.sourceKey,
            recommendation,
            trip_id: tripId,
            owner_id: ownerId,
          })
          .onConflictDoNothing({ target: [places.trip_id, places.source_key] })
          .returning({ id: places.id });
        if (inserted.length) {
          summary.added++;
          if (op.possibleDuplicates.length) {
            summary.possibleDuplicates.push({ name: op.item.name, matches: op.possibleDuplicates });
          }
        } else {
          summary.existing++;
        }
      }
    }
    return { ok: true, summary };
  });
}

export type PlaceDeleteResult =
  | { ok: true; detachedVisits: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "has_visits"; visits: number };

/**
 * Deleting a place that has itinerary visits is refused unless the caller
 * explicitly asks to detach them: each visit keeps its schedule, notes and
 * reflection, and takes the place's name as its own title.
 */
export async function deletePlace(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  placeId: string,
  visits: "block" | "detach",
): Promise<PlaceDeleteResult> {
  return db.transaction(async (tx) => {
    const [place] = await tx
      .select({ id: places.id, name: places.name })
      .from(places)
      .where(and(eq(places.id, placeId), eq(places.trip_id, tripId), eq(places.owner_id, ownerId)))
      .for("update");
    if (!place) return { ok: false, reason: "not_found" };

    const linked = and(eq(itineraryItems.place_id, placeId), eq(itineraryItems.owner_id, ownerId));
    const [{ n }] = await tx.select({ n: count() }).from(itineraryItems).where(linked);
    if (n > 0 && visits === "block") return { ok: false, reason: "has_visits", visits: n };
    if (n > 0) {
      await tx
        .update(itineraryItems)
        .set({ place_id: null, title: sql`coalesce(${itineraryItems.title}, ${place.name})` })
        .where(linked);
    }
    await tx.delete(places).where(and(eq(places.id, placeId), eq(places.owner_id, ownerId)));
    return { ok: true, detachedVisits: n };
  });
}

/* ---------------------------- itinerary --------------------------- */

const placeSummaryColumns = {
  id: places.id,
  name: places.name,
  kind: places.kind,
  category: places.category,
  priority: places.priority,
  address: places.address,
  maps_url: places.maps_url,
  website_url: places.website_url,
};

/** Visits with their place and reservation, or null when the trip isn't the owner's. */
export async function listItinerary(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  { completedOnly = false } = {},
): Promise<ItineraryEntry[] | null> {
  const [trip, rows] = await Promise.all([
    ownedTrip(db, ownerId, tripId),
    db
      .select({ item: itineraryItems, place: placeSummaryColumns, reservation: reservations })
      .from(itineraryItems)
      .leftJoin(places, and(eq(places.id, itineraryItems.place_id), eq(places.owner_id, ownerId)))
      .leftJoin(
        reservations,
        and(eq(reservations.id, itineraryItems.reservation_id), eq(reservations.owner_id, ownerId)),
      )
      .where(
        and(
          eq(itineraryItems.trip_id, tripId),
          eq(itineraryItems.owner_id, ownerId),
          completedOnly ? eq(itineraryItems.status, "completed") : undefined,
        ),
      )
      .orderBy(
        sql`coalesce(${itineraryItems.local_date}, ${reservations.start_date}) asc nulls last`,
        sql`coalesce(${itineraryItems.local_start_time}, ${reservations.start_time}) asc nulls first`,
        asc(itineraryItems.sort_order),
        asc(itineraryItems.created_at),
      ),
  ]);
  if (!trip) return null;
  return rows.map(({ item, place, reservation }) => ({
    ...item,
    place: (place as ItineraryEntry["place"]) ?? null,
    reservation: (reservation as Reservation | null) ?? null,
  }));
}

export type ItineraryWriteResult =
  | { ok: true; id: string; explorePlace?: "created" | "existing" }
  | {
      ok: false;
      reason:
        | "not_found"
        | "place_not_in_trip"
        | "place_already_scheduled"
        | "reservation_not_in_trip"
        | "reservation_unscheduled"
        | "reservation_already_linked"
        | "reservation_backed"
        | "outside_trip"
        | "in_future"
        | "conflict";
    };

export type ItineraryWriteOptions = {
  /**
   * Standalone activities only: also keep it in Explore. Links to an
   * existing place with the same name (case-insensitive) instead of
   * creating a second one; the visit then shows the place's name.
   */
  saveToExplore?: boolean;
  /** Refuse (place_already_scheduled) if the place has a planned or completed visit — guards repeated clicks. */
  unlessPlaceScheduled?: boolean;
  /** Form-generated UUID used as the row id, making a repeated submit return the same entry. */
  requestId?: string;
  /**
   * Create it already done, with its review ("Capture a moment"). Standalone
   * or place visits only, on a trip day that isn't after today in the trip's zone.
   */
  completed?: Pick<VisitReviewInput, "rating" | "reflection" | "is_favorite">;
};

/** Turn a standalone activity into a visit of a (found or new) Explore place. */
async function linkToExplore(
  tx: Tx,
  ownerId: OwnerId,
  tripId: string,
  input: ItineraryItemInput,
): Promise<{ input: ItineraryItemInput; explorePlace?: "created" | "existing" }> {
  const kind = exploreKindFor(input.category);
  if (!kind || !input.title || input.place_id || input.reservation_id) return { input };
  const [existing] = await tx
    .select({ id: places.id })
    .from(places)
    .where(
      and(
        eq(places.trip_id, tripId),
        eq(places.owner_id, ownerId),
        sql`lower(${places.name}) = lower(${input.title})`,
      ),
    )
    .orderBy(asc(places.created_at))
    .limit(1);
  if (existing) return { input: { ...input, place_id: existing.id, title: null }, explorePlace: "existing" };
  const [created] = await tx
    .insert(places)
    .values({ ...kind, name: input.title, priority: "maybe", trip_id: tripId, owner_id: ownerId })
    .returning({ id: places.id });
  return { input: { ...input, place_id: created.id, title: null }, explorePlace: "created" };
}

/**
 * Checks the proposed place / reservation belong to this owner's trip (the
 * composite FKs enforce the same thing; this gives precise errors).
 */
async function checkVisitLinks(
  tx: Tx,
  ownerId: OwnerId,
  tripId: string,
  input: ItineraryItemInput,
  itemId: string | null,
): Promise<Extract<ItineraryWriteResult, { ok: false }> | null> {
  if (input.place_id) {
    const [place] = await tx
      .select({ id: places.id })
      .from(places)
      .where(and(eq(places.id, input.place_id), eq(places.trip_id, tripId), eq(places.owner_id, ownerId)));
    if (!place) return { ok: false, reason: "place_not_in_trip" };
  }
  if (input.reservation_id) {
    const [booking] = await tx
      .select({ id: reservations.id, start_date: reservations.start_date })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, input.reservation_id),
          eq(reservations.trip_id, tripId),
          eq(reservations.owner_id, ownerId),
        ),
      );
    if (!booking) return { ok: false, reason: "reservation_not_in_trip" };
    if (!booking.start_date) return { ok: false, reason: "reservation_unscheduled" };
    const [other] = await tx
      .select({ id: itineraryItems.id })
      .from(itineraryItems)
      .where(
        and(
          eq(itineraryItems.reservation_id, input.reservation_id),
          eq(itineraryItems.owner_id, ownerId),
          itemId ? ne(itineraryItems.id, itemId) : undefined,
        ),
      );
    if (other) return { ok: false, reason: "reservation_already_linked" };
  }
  return null;
}

function mapVisitWriteError(error: unknown): Extract<ItineraryWriteResult, { ok: false }> {
  if (isForeignKeyViolation(error, "itinerary_items_trip_same_owner_fk")) return { ok: false, reason: "not_found" };
  if (isForeignKeyViolation(error, "itinerary_items_place_same_trip_fk")) {
    return { ok: false, reason: "place_not_in_trip" };
  }
  if (isForeignKeyViolation(error, "itinerary_items_reservation_same_trip_fk")) {
    return { ok: false, reason: "reservation_not_in_trip" };
  }
  if (isUniqueViolation(error, "itinerary_items_reservation_unique")) {
    return { ok: false, reason: "reservation_already_linked" };
  }
  throw error;
}

/** Standalone visits without a zone use the trip's; reservation visits have none. */
function visitValues(input: ItineraryItemInput, tripTimeZone: string) {
  return input.reservation_id ? input : { ...input, timezone: input.timezone ?? tripTimeZone };
}

/** Next sort_order for the trip (new entries go last within their day). Call with the trip row locked. */
async function nextSortOrder(tx: Tx, ownerId: OwnerId, tripId: string) {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${itineraryItems.sort_order}), 0) + 1` })
    .from(itineraryItems)
    .where(and(eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)));
  return next;
}

/** A repeated submit (same requestId) in this owner's trip returns the entry it already created. */
async function existingRequest(tx: Tx, ownerId: OwnerId, tripId: string, requestId: string) {
  const [row] = await tx
    .select({ id: itineraryItems.id })
    .from(itineraryItems)
    .where(and(eq(itineraryItems.id, requestId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)));
  return row ? ({ ok: true, id: row.id } as const) : null;
}

export async function createItineraryItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  rawInput: ItineraryItemInput,
  options: ItineraryWriteOptions = {},
): Promise<ItineraryWriteResult> {
  try {
    return await db.transaction(async (tx): Promise<ItineraryWriteResult> => {
      // The trip row lock serializes concurrent creates, so the
      // "already scheduled" check below can't race a double click.
      const trip = await ownedTrip(tx, ownerId, tripId, true);
      if (!trip) return { ok: false, reason: "not_found" };
      if (options.requestId) {
        const existing = await existingRequest(tx, ownerId, tripId, options.requestId);
        if (existing) return existing;
      }
      const problem = await checkVisitLinks(tx, ownerId, tripId, rawInput, null);
      if (problem) return problem;
      if (options.completed) {
        if (rawInput.reservation_id || !rawInput.local_date) return { ok: false, reason: "reservation_backed" };
        if (rawInput.local_date < trip.start_date || rawInput.local_date > trip.end_date) {
          return { ok: false, reason: "outside_trip" };
        }
        if (rawInput.local_date > todayInTimeZone(trip.time_zone)) return { ok: false, reason: "in_future" };
      }
      if (options.unlessPlaceScheduled && rawInput.place_id) {
        const [visit] = await tx
          .select({ id: itineraryItems.id })
          .from(itineraryItems)
          .where(
            and(
              eq(itineraryItems.place_id, rawInput.place_id),
              eq(itineraryItems.owner_id, ownerId),
              inArray(itineraryItems.status, ["planned", "completed"]),
            ),
          )
          .limit(1);
        if (visit) return { ok: false, reason: "place_already_scheduled" };
      }
      const { input, explorePlace } = options.saveToExplore
        ? await linkToExplore(tx, ownerId, tripId, rawInput)
        : { input: rawInput, explorePlace: undefined };
      const [row] = await tx
        .insert(itineraryItems)
        .values({
          ...visitValues(input, trip.time_zone),
          ...(options.requestId ? { id: options.requestId } : {}),
          ...(options.completed ? { ...options.completed, status: "completed" as const, completed_at: sql`now()` } : {}),
          sort_order: await nextSortOrder(tx, ownerId, tripId),
          trip_id: tripId,
          owner_id: ownerId,
        })
        .onConflictDoNothing({ target: itineraryItems.id })
        .returning({ id: itineraryItems.id });
      // A requestId taken by someone else's row: refuse without revealing it.
      if (!row) return { ok: false, reason: "not_found" };
      return explorePlace ? { ok: true, id: row.id, explorePlace } : { ok: true, id: row.id };
    });
  } catch (error) {
    return mapVisitWriteError(error);
  }
}

/** Updates the planning fields only; completion and reflection are separate. */
export async function updateItineraryItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  rawInput: ItineraryItemInput,
  options: Pick<ItineraryWriteOptions, "saveToExplore"> & {
    /** The `updated_at` the editor loaded; a newer change by someone else is a "conflict", not overwritten. */
    expectedUpdatedAt?: string;
  } = {},
): Promise<ItineraryWriteResult> {
  try {
    return await db.transaction(async (tx): Promise<ItineraryWriteResult> => {
      const trip = await ownedTrip(tx, ownerId, tripId, true);
      if (!trip) return { ok: false, reason: "not_found" };
      const problem = await checkVisitLinks(tx, ownerId, tripId, rawInput, itemId);
      if (problem) return problem;
      const [current] = await tx
        .select({
          id: itineraryItems.id,
          stale: options.expectedUpdatedAt
            ? sql<boolean>`${itineraryItems.updated_at} <> ${options.expectedUpdatedAt}::timestamptz`
            : sql<boolean>`false`,
        })
        .from(itineraryItems)
        .where(
          and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)),
        )
        .for("update");
      if (!current) return { ok: false, reason: "not_found" };
      if (current.stale) return { ok: false, reason: "conflict" };
      const { input, explorePlace } = options.saveToExplore
        ? await linkToExplore(tx, ownerId, tripId, rawInput)
        : { input: rawInput, explorePlace: undefined };
      const rows = await tx
        .update(itineraryItems)
        .set(visitValues(input, trip.time_zone))
        .where(
          and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)),
        )
        .returning({ id: itineraryItems.id });
      if (!rows[0]) return { ok: false, reason: "not_found" };
      return explorePlace ? { ok: true, id: rows[0].id, explorePlace } : { ok: true, id: rows[0].id };
    });
  } catch (error) {
    return mapVisitWriteError(error);
  }
}

/**
 * Status, rating, reflection and favorite — only the fields given are
 * changed. completed_at is set the first time a visit is completed and
 * cleared if it is un-completed; a status change never clears the written
 * rating or reflection.
 */
export async function reviewItineraryItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  review: Partial<VisitReviewInput>,
) {
  const patch = Object.fromEntries(Object.entries(review).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return false;
  const rows = await db
    .update(itineraryItems)
    .set({
      ...patch,
      ...(review.status
        ? {
            completed_at:
              review.status === "completed" ? sql`coalesce(${itineraryItems.completed_at}, now())` : null,
          }
        : {}),
    })
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)))
    .returning({ id: itineraryItems.id });
  return rows.length === 1;
}

/** Removes the visit only — its place and reservation are untouched. */
export async function deleteItineraryItem(db: Db, ownerId: OwnerId, tripId: string, itemId: string) {
  const rows = await db
    .delete(itineraryItems)
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)))
    .returning({ id: itineraryItems.id });
  return rows.length === 1;
}

export type VisitRecordInput = Pick<VisitReviewInput, "rating" | "reflection" | "is_favorite"> & { date: string };

/** "auto" refuses when planned visits exist, so the caller must choose — nothing is guessed. */
export type VisitRecordChoice = { type: "auto" } | { type: "new" } | { type: "complete"; itemId: string };

export type VisitRecordResult =
  | { ok: true; id: string; completedExisting: boolean }
  | { ok: false; reason: "not_found" | "place_not_in_trip" | "visit_not_planned" }
  | { ok: false; reason: "has_planned_visits"; visits: { id: string; local_date: string | null }[] };

/**
 * Record that a place was visited: either complete one of its planned
 * visits (chosen explicitly) or add a completed visit on `date`. Rating,
 * reflection and favorite are kept on that visit; blank fields never erase
 * what a planned visit already holds.
 */
export async function recordPlaceVisit(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  placeId: string,
  input: VisitRecordInput,
  choice: VisitRecordChoice,
  requestId?: string,
): Promise<VisitRecordResult> {
  return db.transaction(async (tx): Promise<VisitRecordResult> => {
    const trip = await ownedTrip(tx, ownerId, tripId, true);
    if (!trip) return { ok: false, reason: "not_found" };
    if (requestId) {
      const existing = await existingRequest(tx, ownerId, tripId, requestId);
      if (existing) return { ok: true, id: existing.id, completedExisting: false };
    }
    const [place] = await tx
      .select({ id: places.id, kind: places.kind })
      .from(places)
      .where(and(eq(places.id, placeId), eq(places.trip_id, tripId), eq(places.owner_id, ownerId)));
    if (!place) return { ok: false, reason: "place_not_in_trip" };

    const planned = await tx
      .select({ id: itineraryItems.id, local_date: itineraryItems.local_date })
      .from(itineraryItems)
      .where(
        and(
          eq(itineraryItems.place_id, placeId),
          eq(itineraryItems.trip_id, tripId),
          eq(itineraryItems.owner_id, ownerId),
          eq(itineraryItems.status, "planned"),
        ),
      )
      .orderBy(sql`${itineraryItems.local_date} asc nulls last`, asc(itineraryItems.sort_order));

    if (choice.type === "complete") {
      if (!planned.some((v) => v.id === choice.itemId)) return { ok: false, reason: "visit_not_planned" };
      await tx
        .update(itineraryItems)
        .set({
          status: "completed",
          completed_at: sql`now()`,
          ...(input.rating !== null ? { rating: input.rating } : {}),
          ...(input.reflection ? { reflection: input.reflection } : {}),
          ...(input.is_favorite ? { is_favorite: true } : {}),
        })
        .where(and(eq(itineraryItems.id, choice.itemId), eq(itineraryItems.owner_id, ownerId)));
      return { ok: true, id: choice.itemId, completedExisting: true };
    }
    if (choice.type === "auto" && planned.length > 0) return { ok: false, reason: "has_planned_visits", visits: planned };

    const [row] = await tx
      .insert(itineraryItems)
      .values({
        ...(requestId ? { id: requestId } : {}),
        trip_id: tripId,
        owner_id: ownerId,
        place_id: placeId,
        category: place.kind === "food" ? "food" : "sightseeing",
        local_date: input.date,
        timezone: trip.time_zone,
        sort_order: await nextSortOrder(tx, ownerId, tripId),
        status: "completed",
        completed_at: sql`now()`,
        rating: input.rating,
        reflection: input.reflection,
        is_favorite: input.is_favorite,
      })
      .onConflictDoNothing({ target: itineraryItems.id })
      .returning({ id: itineraryItems.id });
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, id: row.id, completedExisting: false };
  });
}

/**
 * Move a standalone or place visit to another day of the trip. Times stay;
 * a multi-day end moves by the same number of days. It goes last among
 * that day's flexible entries. Booking-backed entries follow their booking.
 */
export async function moveItineraryItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  date: string,
): Promise<ItineraryWriteResult> {
  return db.transaction(async (tx): Promise<ItineraryWriteResult> => {
    const trip = await ownedTrip(tx, ownerId, tripId, true);
    if (!trip) return { ok: false, reason: "not_found" };
    const [item] = await tx
      .select()
      .from(itineraryItems)
      .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)));
    if (!item) return { ok: false, reason: "not_found" };
    if (item.reservation_id || !item.local_date) return { ok: false, reason: "reservation_backed" };
    if (date < trip.start_date || date > trip.end_date) return { ok: false, reason: "outside_trip" };
    const shift = daysBetweenDates(item.local_date, date);
    await tx
      .update(itineraryItems)
      .set({
        local_date: date,
        local_end_date: item.local_end_date ? addDays(item.local_end_date, shift) : null,
        sort_order: await nextSortOrder(tx, ownerId, tripId),
      })
      .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.owner_id, ownerId)));
    return { ok: true, id: itemId };
  });
}

/**
 * Copy an activity or place visit's plan (title, place, category, schedule,
 * notes) as a fresh planned entry: status, rating, reflection and favorite
 * start over. A booking's link can't be duplicated — a booking has one entry.
 */
export async function duplicateItineraryItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
): Promise<ItineraryWriteResult> {
  return db.transaction(async (tx): Promise<ItineraryWriteResult> => {
    const trip = await ownedTrip(tx, ownerId, tripId, true);
    if (!trip) return { ok: false, reason: "not_found" };
    const [item] = await tx
      .select()
      .from(itineraryItems)
      .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)));
    if (!item) return { ok: false, reason: "not_found" };
    if (item.reservation_id) return { ok: false, reason: "reservation_backed" };
    const [row] = await tx
      .insert(itineraryItems)
      .values({
        trip_id: tripId,
        owner_id: ownerId,
        place_id: item.place_id,
        title: item.title,
        category: item.category,
        local_date: item.local_date,
        local_start_time: item.local_start_time,
        local_end_date: item.local_end_date,
        local_end_time: item.local_end_time,
        timezone: item.timezone,
        planning_notes: item.planning_notes,
        is_optional: item.is_optional,
        is_protected_rest: item.is_protected_rest,
        sort_order: await nextSortOrder(tx, ownerId, tripId),
      })
      .returning({ id: itineraryItems.id });
    return { ok: true, id: row.id };
  });
}

export type ReorderResult = { ok: true } | { ok: false; reason: "not_found" | "invalid" };

/**
 * Persist the order of a day's flexible entries. Keys are `i:<itemId>` or
 * `r:<reservationId>`; a booking without an itinerary row gets one (its
 * single link) so its position can be stored. Every key must belong to this
 * owner's trip, or nothing changes.
 */
export async function reorderItinerary(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  keys: { type: "item" | "reservation"; id: string }[],
): Promise<ReorderResult> {
  return db.transaction(async (tx): Promise<ReorderResult> => {
    const trip = await ownedTrip(tx, ownerId, tripId, true);
    if (!trip) return { ok: false, reason: "not_found" };
    const itemIds = keys.filter((k) => k.type === "item").map((k) => k.id);
    const bookingIds = keys.filter((k) => k.type === "reservation").map((k) => k.id);
    if (new Set(keys.map((k) => `${k.type}:${k.id}`)).size !== keys.length) return { ok: false, reason: "invalid" };

    const ownItems = itemIds.length
      ? await tx
          .select({ id: itineraryItems.id })
          .from(itineraryItems)
          .where(
            and(
              inArray(itineraryItems.id, itemIds),
              eq(itineraryItems.trip_id, tripId),
              eq(itineraryItems.owner_id, ownerId),
            ),
          )
      : [];
    if (ownItems.length !== itemIds.length) return { ok: false, reason: "not_found" };

    const bookings = bookingIds.length
      ? await tx
          .select({ id: reservations.id, kind: reservations.kind, start_date: reservations.start_date })
          .from(reservations)
          .where(
            and(
              inArray(reservations.id, bookingIds),
              eq(reservations.trip_id, tripId),
              eq(reservations.owner_id, ownerId),
            ),
          )
      : [];
    if (bookings.length !== bookingIds.length || bookings.some((b) => !b.start_date)) {
      return { ok: false, reason: "not_found" };
    }

    const linkFor = new Map<string, string>();
    if (bookingIds.length) {
      const existing = await tx
        .select({ id: itineraryItems.id, reservation_id: itineraryItems.reservation_id })
        .from(itineraryItems)
        .where(and(inArray(itineraryItems.reservation_id, bookingIds), eq(itineraryItems.owner_id, ownerId)));
      for (const row of existing) linkFor.set(row.reservation_id!, row.id);
      for (const b of bookings.filter((b) => !linkFor.has(b.id))) {
        const [row] = await tx
          .insert(itineraryItems)
          .values({ reservation_id: b.id, category: categoryForReservation(b.kind), trip_id: tripId, owner_id: ownerId })
          .returning({ id: itineraryItems.id });
        linkFor.set(b.id, row.id);
      }
    }

    for (const [index, key] of keys.entries()) {
      const id = key.type === "item" ? key.id : linkFor.get(key.id)!;
      await tx
        .update(itineraryItems)
        .set({ sort_order: index + 1 })
        .where(and(eq(itineraryItems.id, id), eq(itineraryItems.owner_id, ownerId)));
    }
    return { ok: true };
  });
}

/**
 * Put a booking on the itinerary (or return its existing visit) so it can
 * be ordered, completed and reviewed. Idempotent.
 */
export async function ensureReservationVisit(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  reservationId: string,
  retry = true,
): Promise<ItineraryWriteResult> {
  const [booking] = await db
    .select({ kind: reservations.kind })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId)));
  if (!booking) return { ok: false, reason: "reservation_not_in_trip" };
  const [existing] = await db
    .select({ id: itineraryItems.id })
    .from(itineraryItems)
    .where(and(eq(itineraryItems.reservation_id, reservationId), eq(itineraryItems.owner_id, ownerId)));
  if (existing) return { ok: true, id: existing.id };
  const created = await createItineraryItem(db, ownerId, tripId, {
    place_id: null,
    reservation_id: reservationId,
    title: null,
    category: categoryForReservation(booking.kind),
    local_date: null,
    local_start_time: null,
    local_end_date: null,
    local_end_time: null,
    timezone: null,
    planning_notes: null,
  });
  if (!created.ok && created.reason === "reservation_already_linked" && retry) {
    // Lost a race with another request; return the winner.
    return ensureReservationVisit(db, ownerId, tripId, reservationId, false);
  }
  return created;
}

/* -------------------------- itinerary plans ------------------------ */

/** Everything a plan preview is computed from, read in one place (optionally under the trip lock). */
async function planContext(db: Executor, ownerId: OwnerId, tripId: string, lock: boolean) {
  const tripQuery = db
    .select({
      id: trips.id,
      title: trips.title,
      destination: trips.destination,
      start_date: trips.start_date,
      end_date: trips.end_date,
      time_zone: trips.time_zone,
      travelers: trips.travelers,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)))
    .limit(1);
  const [trip] = lock ? await tripQuery.for("update") : await tripQuery;
  if (!trip) return null;
  // Sequential: inside a transaction these share one connection.
  const rows = await db
    .select()
    .from(itineraryItems)
    .where(and(eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId)))
    .orderBy(asc(itineraryItems.sort_order), asc(itineraryItems.created_at));
  const placeRows = await db
    .select({ id: places.id, name: places.name })
    .from(places)
    .where(and(eq(places.trip_id, tripId), eq(places.owner_id, ownerId)))
    .orderBy(asc(places.created_at));
  const reservationRows = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.trip_id, tripId), eq(reservations.owner_id, ownerId)));
  return { trip, rows, places: placeRows, reservations: reservationRows };
}

export type PlanPreviewResult = PlanPreview & { token: string };

function previewFrom(plan: ItineraryPlan, ctx: NonNullable<Awaited<ReturnType<typeof planContext>>>): PlanPreviewResult {
  const preview = planPreview({ plan, ...ctx });
  return { ...preview, token: previewToken(preview, ctx.rows, ctx.trip, ctx.reservations) };
}

/** Read-only: what applying the plan would do. null = not the owner's trip. */
export async function previewItineraryPlan(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  plan: ItineraryPlan,
): Promise<PlanPreviewResult | null> {
  const ctx = await planContext(db, ownerId, tripId, false);
  return ctx ? previewFrom(plan, ctx) : null;
}

export type PlanApplyInput = {
  token: string;
  /** Conflict id → choice; anything missing stays "keep". */
  choices: Record<string, PlanChoice>;
  setTripTimeZone: boolean;
};

export type PlanApplySummary = {
  added: number;
  updated: number;
  linked: number;
  removed: number;
  kept: number;
  unchanged: number;
  tripTimeZone: string | null;
};

export type PlanApplyResult =
  | { ok: true; summary: PlanApplySummary }
  | { ok: false; reason: "not_found" | "blocked" }
  | { ok: false; reason: "stale"; preview: PlanPreviewResult };

/**
 * Apply a previewed plan in one transaction. The trip row is locked and the
 * preview recomputed from current data; if it no longer matches the token the
 * traveler reviewed, nothing is written and the fresh preview is returned.
 * Repeating an apply (double click, second tab) therefore finds nothing left
 * to do. Status, rating, reflection, favorite and place links are never
 * written; bookings are only read.
 */
export async function applyItineraryPlan(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  plan: ItineraryPlan,
  input: PlanApplyInput,
): Promise<PlanApplyResult> {
  return db.transaction(async (tx): Promise<PlanApplyResult> => {
    const ctx = await planContext(tx, ownerId, tripId, true);
    if (!ctx) return { ok: false, reason: "not_found" };
    const preview = previewFrom(plan, ctx);
    if (preview.blocked) return { ok: false, reason: "blocked" };
    if (preview.token !== input.token) return { ok: false, reason: "stale", preview };

    const byKey = new Map(plan.items.map((i) => [i.key, i]));
    const rowsById = new Map(ctx.rows.map((r) => [r.id, r]));
    const placeIdByName = new Map(ctx.places.map((p) => [p.name, p.id]));
    const summary: PlanApplySummary = { added: 0, updated: 0, linked: 0, removed: 0, kept: 0, unchanged: 0, tripTimeZone: null };
    const own = (rowId: string) =>
      and(eq(itineraryItems.id, rowId), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ownerId));
    let sortOrder = await nextSortOrder(tx, ownerId, tripId);

    for (const op of preview.ops) {
      if (op.kind === "unchanged") {
        summary.unchanged++;
      } else if (op.kind === "add") {
        const item = byKey.get(op.item.key)!;
        const values = planValues(plan, item);
        const inserted = await tx
          .insert(itineraryItems)
          .values({
            ...values,
            place_id: op.placeName ? (placeIdByName.get(op.placeName) ?? null) : null,
            source_key: sourceKey(plan, item),
            source_fingerprint: fingerprint(values),
            sort_order: sortOrder++,
            trip_id: tripId,
            owner_id: ownerId,
          })
          // The trip lock already serializes applies; this is the last line against a second copy.
          .onConflictDoNothing({ target: [itineraryItems.trip_id, itineraryItems.source_key] })
          .returning({ id: itineraryItems.id });
        if (inserted.length) summary.added++;
      } else if (op.kind === "update" || op.kind === "link") {
        const item = byKey.get(op.item.key)!;
        const values = planValues(plan, item);
        await tx
          .update(itineraryItems)
          .set(
            op.kind === "update"
              ? { ...values, source_key: sourceKey(plan, item), source_fingerprint: fingerprint(values) }
              : { source_key: sourceKey(plan, item), source_fingerprint: fingerprint(values) },
          )
          .where(own(op.rowId));
        summary[op.kind === "update" ? "updated" : "linked"]++;
      } else if (op.kind === "remove") {
        await tx.delete(itineraryItems).where(own(op.rowId));
        summary.removed++;
      } else if ((input.choices[op.id] ?? "keep") === "keep") {
        summary.kept++;
      } else if (op.reason === "retire") {
        await tx.delete(itineraryItems).where(own(op.rowId));
        summary.removed++;
      } else {
        // "Use the plan" on an edited / matching entry: planning fields only;
        // the traveler's notes stay (plan text appended), a place visit keeps its name.
        const item = byKey.get(op.item!.key)!;
        const row = rowsById.get(op.rowId)!;
        const values = planValues(plan, item);
        await tx
          .update(itineraryItems)
          .set({
            ...values,
            title: row.place_id && row.title === null ? null : values.title,
            planning_notes: mergeNotes(row.planning_notes, values.planning_notes),
            source_key: sourceKey(plan, item),
            source_fingerprint: fingerprint(values),
          })
          .where(own(op.rowId));
        summary.updated++;
      }
    }

    if (input.setTripTimeZone && preview.zoneOption) {
      await tx
        .update(trips)
        .set({ time_zone: plan.timeZone })
        .where(and(eq(trips.id, tripId), eq(trips.owner_id, ownerId)));
      summary.tripTimeZone = plan.timeZone;
    }
    return { ok: true, summary };
  });
}

/* ----------------------------- packing ---------------------------- */

export async function getPacking(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
): Promise<PackingCategoryWithItems[] | null> {
  const [trip, categories, items] = await Promise.all([
    ownedTrip(db, ownerId, tripId),
    db
      .select()
      .from(packingCategories)
      .where(and(eq(packingCategories.trip_id, tripId), eq(packingCategories.owner_id, ownerId)))
      .orderBy(asc(packingCategories.sort_order), asc(packingCategories.created_at)),
    db
      .select()
      .from(packingItems)
      .where(and(eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId)))
      .orderBy(asc(packingItems.sort_order), asc(packingItems.created_at)),
  ]);
  if (!trip) return null;
  return categories.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) }));
}

export type PackingCategoryWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "duplicate_name" };

/** Another category of this trip already uses the name (case/accents ignored)? */
async function categoryNameTaken(tx: Tx, ownerId: OwnerId, tripId: string, name: string, exceptId?: string) {
  const rows = await tx
    .select({ id: packingCategories.id, name: packingCategories.name })
    .from(packingCategories)
    .where(and(eq(packingCategories.trip_id, tripId), eq(packingCategories.owner_id, ownerId)));
  return rows.some((r) => r.id !== exceptId && normalizeName(r.name) === normalizeName(name));
}

/**
 * Category names are unique per trip (ignoring case and accents), so the
 * starter and "copy from another trip" can merge by name. The trip row is
 * locked so two concurrent adds can't both pass the check.
 */
export async function createPackingCategory(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  input: PackingCategoryInput,
): Promise<PackingCategoryWriteResult> {
  return db.transaction(async (tx): Promise<PackingCategoryWriteResult> => {
    if (!(await ownedTrip(tx, ownerId, tripId, true))) return { ok: false, reason: "not_found" };
    if (await categoryNameTaken(tx, ownerId, tripId, input.name)) return { ok: false, reason: "duplicate_name" };
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${packingCategories.sort_order}), 0) + 1` })
      .from(packingCategories)
      .where(and(eq(packingCategories.trip_id, tripId), eq(packingCategories.owner_id, ownerId)));
    const [row] = await tx
      .insert(packingCategories)
      .values({ ...input, sort_order: next, trip_id: tripId, owner_id: ownerId })
      .returning({ id: packingCategories.id });
    return { ok: true, id: row.id };
  });
}

export async function updatePackingCategory(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  categoryId: string,
  input: PackingCategoryInput,
): Promise<PackingCategoryWriteResult> {
  return db.transaction(async (tx): Promise<PackingCategoryWriteResult> => {
    if (!(await ownedTrip(tx, ownerId, tripId, true))) return { ok: false, reason: "not_found" };
    if (await categoryNameTaken(tx, ownerId, tripId, input.name, categoryId)) {
      return { ok: false, reason: "duplicate_name" };
    }
    const rows = await tx
      .update(packingCategories)
      .set(input)
      .where(
        and(
          eq(packingCategories.id, categoryId),
          eq(packingCategories.trip_id, tripId),
          eq(packingCategories.owner_id, ownerId),
        ),
      )
      .returning({ id: packingCategories.id });
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not_found" };
  });
}

export type PackingCategoryDeleteChoice =
  | { items: "none" }
  | { items: "delete" }
  | { items: "move"; target_category_id: string };

export type PackingCategoryDeleteResult =
  | { ok: true; affectedItems: number }
  | { ok: false; reason: "not_found" | "target_not_found" }
  | { ok: false; reason: "has_items"; items: number };

/**
 * A category with items is only deleted with an explicit choice: move the
 * items to another category of the same trip, or delete them too.
 */
export async function deletePackingCategory(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  categoryId: string,
  choice: PackingCategoryDeleteChoice,
): Promise<PackingCategoryDeleteResult> {
  return db.transaction(async (tx) => {
    const inTrip = (id: string) =>
      and(eq(packingCategories.id, id), eq(packingCategories.trip_id, tripId), eq(packingCategories.owner_id, ownerId));
    const [category] = await tx.select({ id: packingCategories.id }).from(packingCategories).where(inTrip(categoryId)).for("update");
    if (!category) return { ok: false, reason: "not_found" };

    const its = and(eq(packingItems.category_id, categoryId), eq(packingItems.owner_id, ownerId));
    const [{ n }] = await tx.select({ n: count() }).from(packingItems).where(its);
    if (n > 0) {
      if (choice.items === "none") return { ok: false, reason: "has_items", items: n };
      if (choice.items === "move") {
        if (choice.target_category_id === categoryId) return { ok: false, reason: "target_not_found" };
        const [target] = await tx
          .select({ id: packingCategories.id })
          .from(packingCategories)
          .where(inTrip(choice.target_category_id))
          .for("update");
        if (!target) return { ok: false, reason: "target_not_found" };
        const [{ base }] = await tx
          .select({ base: sql<number>`coalesce(max(${packingItems.sort_order}), 0)` })
          .from(packingItems)
          .where(and(eq(packingItems.category_id, target.id), eq(packingItems.owner_id, ownerId)));
        // Moved items go after the target's own, keeping their relative order.
        await tx
          .update(packingItems)
          .set({ category_id: target.id, sort_order: sql`${packingItems.sort_order} + ${base}` })
          .where(its);
      } else {
        await tx.delete(packingItems).where(its);
      }
    }
    await tx.delete(packingCategories).where(inTrip(categoryId));
    return { ok: true, affectedItems: n };
  });
}

export type PackingReorderResult = { ok: true } | { ok: false; reason: "not_found" | "stale" };

/**
 * Persist the trip's category order. `ids` must be exactly the trip's
 * categories (no more, no fewer); otherwise the list changed elsewhere and
 * nothing is written ("stale").
 */
export async function reorderPackingCategories(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  ids: string[],
): Promise<PackingReorderResult> {
  return db.transaction(async (tx): Promise<PackingReorderResult> => {
    if (!(await ownedTrip(tx, ownerId, tripId, true))) return { ok: false, reason: "not_found" };
    const rows = await tx
      .select({ id: packingCategories.id })
      .from(packingCategories)
      .where(and(eq(packingCategories.trip_id, tripId), eq(packingCategories.owner_id, ownerId)));
    if (!sameIdSet(rows.map((r) => r.id), ids)) return { ok: false, reason: "stale" };
    for (const [index, id] of ids.entries()) {
      await tx
        .update(packingCategories)
        .set({ sort_order: index + 1 })
        .where(and(eq(packingCategories.id, id), eq(packingCategories.owner_id, ownerId)));
    }
    return { ok: true };
  });
}

/** Persist one category's item order; `ids` must be exactly its items. */
export async function reorderPackingItems(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  categoryId: string,
  ids: string[],
): Promise<PackingReorderResult> {
  return db.transaction(async (tx): Promise<PackingReorderResult> => {
    const [category] = await tx
      .select({ id: packingCategories.id })
      .from(packingCategories)
      .where(
        and(
          eq(packingCategories.id, categoryId),
          eq(packingCategories.trip_id, tripId),
          eq(packingCategories.owner_id, ownerId),
        ),
      )
      .for("update");
    if (!category) return { ok: false, reason: "not_found" };
    const rows = await tx
      .select({ id: packingItems.id })
      .from(packingItems)
      .where(and(eq(packingItems.category_id, categoryId), eq(packingItems.owner_id, ownerId)));
    if (!sameIdSet(rows.map((r) => r.id), ids)) return { ok: false, reason: "stale" };
    for (const [index, id] of ids.entries()) {
      await tx
        .update(packingItems)
        .set({ sort_order: index + 1 })
        .where(and(eq(packingItems.id, id), eq(packingItems.owner_id, ownerId)));
    }
    return { ok: true };
  });
}

function sameIdSet(actual: string[], given: string[]) {
  if (new Set(given).size !== given.length || actual.length !== given.length) return false;
  const have = new Set(actual);
  return given.every((id) => have.has(id));
}

export type PackingItemWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "category_not_in_trip" | "conflict" | "assignee_not_member" };

/**
 * Assignment and deadline fields of a task write. Only the fields the caller
 * sent are touched. An assignee must be a CURRENT member (owner or
 * trip_members); the due time zone is the trip's zone, set by the server —
 * never taken from the request.
 */
async function taskFields(
  tx: Tx,
  ownerId: OwnerId,
  tripId: string,
  tripZone: string,
  input: PackingItemInput,
): Promise<{ ok: true; fields: Partial<typeof packingItems.$inferInsert> } | { ok: false; reason: "assignee_not_member" }> {
  const fields: Partial<typeof packingItems.$inferInsert> = {};
  if (input.assignee_id !== undefined) {
    if (input.assignee_id !== null && input.assignee_id !== ownerId) {
      const [member] = await tx
        .select({ id: tripMembers.id })
        .from(tripMembers)
        .where(and(eq(tripMembers.trip_id, tripId), eq(tripMembers.owner_id, ownerId), eq(tripMembers.user_id, input.assignee_id)));
      if (!member) return { ok: false, reason: "assignee_not_member" };
    }
    fields.assignee_id = input.assignee_id;
  }
  if (input.due_date !== undefined) {
    fields.due_date = input.due_date;
    fields.due_time = input.due_date ? (input.due_time ?? null) : null;
    fields.due_time_zone = input.due_date ? tripZone : null;
  }
  return { ok: true, fields };
}

async function categoryInTrip(tx: Tx, ownerId: OwnerId, tripId: string, categoryId: string) {
  const [row] = await tx
    .select({ id: packingCategories.id })
    .from(packingCategories)
    .where(
      and(
        eq(packingCategories.id, categoryId),
        eq(packingCategories.trip_id, tripId),
        eq(packingCategories.owner_id, ownerId),
      ),
    );
  return Boolean(row);
}

async function nextItemOrder(tx: Tx, ownerId: OwnerId, categoryId: string) {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${packingItems.sort_order}), 0) + 1` })
    .from(packingItems)
    .where(and(eq(packingItems.category_id, categoryId), eq(packingItems.owner_id, ownerId)));
  return next;
}

function mapPackingItemError(error: unknown): Extract<PackingItemWriteResult, { ok: false }> {
  if (isForeignKeyViolation(error, "packing_items_trip_same_owner_fk")) return { ok: false, reason: "not_found" };
  if (isForeignKeyViolation(error, "packing_items_category_same_trip_fk")) {
    return { ok: false, reason: "category_not_in_trip" };
  }
  throw error;
}

/**
 * New items go last in their category. `requestId` (a form-generated UUID)
 * becomes the row's id, so a double submit returns the same item.
 */
async function createPackingItemWrite(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  input: PackingItemInput,
  requestId?: string,
): Promise<PackingItemWriteResult> {
  try {
    return await db.transaction(async (tx): Promise<PackingItemWriteResult> => {
      const trip = await ownedTrip(tx, ownerId, tripId);
      if (!trip) return { ok: false, reason: "not_found" };
      if (!(await categoryInTrip(tx, ownerId, tripId, input.category_id))) {
        return { ok: false, reason: "category_not_in_trip" };
      }
      const task = await taskFields(tx, ownerId, tripId, trip.time_zone, input);
      if (!task.ok) return task;
      const next = await nextItemOrder(tx, ownerId, input.category_id);
      const [row] = await tx
        .insert(packingItems)
        .values({ ...input, ...task.fields, ...(requestId ? { id: requestId } : {}), sort_order: next, trip_id: tripId, owner_id: ownerId })
        .onConflictDoNothing({ target: packingItems.id })
        .returning({ id: packingItems.id });
      if (row) return { ok: true, id: row.id };
      const [existing] = await tx
        .select({ id: packingItems.id })
        .from(packingItems)
        .where(and(eq(packingItems.id, requestId!), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId)));
      return existing ? { ok: true, id: existing.id } : { ok: false, reason: "not_found" };
    });
  } catch (error) {
    return mapPackingItemError(error);
  }
}

export async function createPackingItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  input: PackingItemInput,
  requestId?: string,
): Promise<PackingItemWriteResult> {
  const result = await createPackingItemWrite(db, ownerId, tripId, input, requestId);
  if (result.ok) await safely(db, "reminder_sync_task", (tx) => syncSubject(tx, tripId, "task", result.id));
  return result;
}

/** Edits an item; moving it to another category puts it last there. Packed state is untouched. */
async function updatePackingItemWrite(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  input: PackingItemInput,
  expectedUpdatedAt?: string,
): Promise<PackingItemWriteResult> {
  try {
    return await db.transaction(async (tx): Promise<PackingItemWriteResult> => {
      const where = and(eq(packingItems.id, itemId), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId));
      const [current] = await tx
        .select({
          category_id: packingItems.category_id,
          quantity: packingItems.quantity,
          stale: expectedUpdatedAt
            ? sql<boolean>`${packingItems.updated_at} <> ${expectedUpdatedAt}::timestamptz`
            : sql<boolean>`false`,
        })
        .from(packingItems)
        .where(where)
        .for("update");
      if (!current) return { ok: false, reason: "not_found" };
      if (current.stale) return { ok: false, reason: "conflict" };
      if (!(await categoryInTrip(tx, ownerId, tripId, input.category_id))) {
        return { ok: false, reason: "category_not_in_trip" };
      }
      const trip = await ownedTrip(tx, ownerId, tripId);
      if (!trip) return { ok: false, reason: "not_found" };
      const task = await taskFields(tx, ownerId, tripId, trip.time_zone, input);
      if (!task.ok) return task;
      const moved = current.category_id !== input.category_id;
      const sort = moved ? { sort_order: await nextItemOrder(tx, ownerId, input.category_id) } : {};
      const rows = await tx
        .update(packingItems)
        // Editing the number drops the supplied wording ("4–6 pouches"); saving it unchanged keeps it.
        .set({ ...input, ...task.fields, ...sort, ...(input.quantity !== current.quantity ? { quantity_text: null } : {}) })
        .where(where)
        .returning({ id: packingItems.id });
      return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not_found" };
    });
  } catch (error) {
    return mapPackingItemError(error);
  }
}

/** Due time, assignee or label changed: its reminders are rescheduled, reassigned or canceled with it. */
export async function updatePackingItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  input: PackingItemInput,
  expectedUpdatedAt?: string,
): Promise<PackingItemWriteResult> {
  const result = await updatePackingItemWrite(db, ownerId, tripId, itemId, input, expectedUpdatedAt);
  if (result.ok) await safely(db, "reminder_sync_task", (tx) => syncSubject(tx, tripId, "task", itemId));
  return result;
}

/** Move an item to another category of the same trip (appended last). */
export async function movePackingItem(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  categoryId: string,
): Promise<PackingItemWriteResult> {
  try {
    return await db.transaction(async (tx): Promise<PackingItemWriteResult> => {
      const where = and(eq(packingItems.id, itemId), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId));
      const [current] = await tx.select({ category_id: packingItems.category_id }).from(packingItems).where(where).for("update");
      if (!current) return { ok: false, reason: "not_found" };
      if (!(await categoryInTrip(tx, ownerId, tripId, categoryId))) return { ok: false, reason: "category_not_in_trip" };
      if (current.category_id === categoryId) return { ok: true, id: itemId };
      const next = await nextItemOrder(tx, ownerId, categoryId);
      await tx.update(packingItems).set({ category_id: categoryId, sort_order: next }).where(where);
      return { ok: true, id: itemId };
    });
  } catch (error) {
    return mapPackingItemError(error);
  }
}

/**
 * Set (never toggle) the packed flag. Writing the desired value makes
 * retries and repeated clicks safe: the last request decides.
 */
export async function setPackingItemPacked(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  itemId: string,
  packed: boolean,
) {
  const rows = await db
    .update(packingItems)
    .set({ is_packed: packed })
    .where(and(eq(packingItems.id, itemId), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId)))
    .returning({ id: packingItems.id });
  // Completing a task cancels its reminders; un-completing one brings back what is still ahead.
  if (rows.length === 1) await safely(db, "reminder_sync_task", (tx) => syncSubject(tx, tripId, "task", itemId));
  return rows.length === 1;
}

/** "Mark everything unpacked" for the whole trip. Items are kept. null = trip not found. */
export async function unpackAllPackingItems(db: Db, ownerId: OwnerId, tripId: string): Promise<number | null> {
  return db.transaction(async (tx) => {
    if (!(await ownedTrip(tx, ownerId, tripId))) return null;
    const rows = await tx
      .update(packingItems)
      .set({ is_packed: false })
      .where(and(eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId), eq(packingItems.is_packed, true)))
      .returning({ id: packingItems.id });
    if (rows.length) await safely(tx, "reminder_sync_trip", (inner) => syncTrip(inner, tripId));
    return rows.length;
  });
}

export async function deletePackingItem(db: Db, ownerId: OwnerId, tripId: string, itemId: string) {
  const rows = await db
    .delete(packingItems)
    .where(and(eq(packingItems.id, itemId), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId)))
    .returning({ id: packingItems.id });
  return rows.length === 1;
}

export type PackingMergeResult =
  | { ok: true; addedItems: number; skippedItems: number; newCategories: number }
  | { ok: false; reason: "not_found" | "source_not_found" | "nothing_selected" };

/**
 * Add the source's missing categories and items to the trip (see
 * `planMerge`). Runs inside the caller's transaction with the destination
 * trip locked, so concurrent merges can't both add the same rows. New rows
 * get fresh IDs and timestamps and start unpacked.
 */
async function mergeIntoTrip(
  tx: Tx,
  ownerId: OwnerId,
  tripId: string,
  source: MergeSourceCategory[],
): Promise<PackingMergeResult> {
  const where = (t: typeof packingCategories | typeof packingItems) =>
    and(eq(t.trip_id, tripId), eq(t.owner_id, ownerId));
  const [categories, items] = await Promise.all([
    tx.select().from(packingCategories).where(where(packingCategories)),
    tx.select().from(packingItems).where(where(packingItems)),
  ]);
  const plan = planMerge(
    source,
    categories.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) })),
  );

  let categoryOrder = Math.max(0, ...categories.map((c) => c.sort_order));
  for (const group of plan.categories) {
    if (group.add.length === 0) continue;
    let categoryId = group.targetId;
    if (!categoryId) {
      const [row] = await tx
        .insert(packingCategories)
        .values({ name: group.name, sort_order: ++categoryOrder, trip_id: tripId, owner_id: ownerId })
        .returning({ id: packingCategories.id });
      categoryId = row.id;
    }
    let itemOrder = Math.max(0, ...items.filter((i) => i.category_id === categoryId).map((i) => i.sort_order));
    await tx.insert(packingItems).values(
      group.add.map((item) => ({
        category_id: categoryId,
        label: item.label,
        quantity: item.quantity,
        traveler_name: item.traveler_name,
        notes: item.notes,
        is_packed: false,
        sort_order: ++itemOrder,
        trip_id: tripId,
        owner_id: ownerId,
      })),
    );
  }
  return { ok: true, addedItems: plan.addedItems, skippedItems: plan.skippedItems, newCategories: plan.newCategories };
}

/** Copy the chosen starter categories into the trip, adding only what's missing. */
export async function applyPackingStarter(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  keys: StarterKey[],
): Promise<PackingMergeResult> {
  if (keys.length === 0) return { ok: false, reason: "nothing_selected" };
  return db.transaction(async (tx): Promise<PackingMergeResult> => {
    if (!(await ownedTrip(tx, ownerId, tripId, true))) return { ok: false, reason: "not_found" };
    return mergeIntoTrip(tx, ownerId, tripId, starterSource(keys));
  });
}


export type BabyImportResult =
  | { ok: true; added: number; matched: number; updated: number; skipped: number }
  | { ok: false; reason: "not_found" };

/**
 * Import Arjun's packing list. The plan is recomputed here from the stored
 * rows (the browser's preview is never trusted); the caller only says which
 * source keys it accepted: quantity changes and "add anyway" items. Everything
 * else that exists is left exactly as it is — packed state, notes, assignments.
 * Re-running adds nothing (stable keys + a unique index on (trip, key)).
 */
export async function importBabyPacking(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  accepted: { quantities: string[]; addAnyway: string[] },
): Promise<BabyImportResult> {
  return db.transaction(async (tx): Promise<BabyImportResult> => {
    if (!(await ownedTrip(tx, ownerId, tripId, true))) return { ok: false, reason: "not_found" };
    const inTrip = (t: typeof packingCategories | typeof packingItems) => and(eq(t.trip_id, tripId), eq(t.owner_id, ownerId));
    const [categories, items] = await Promise.all([
      tx.select().from(packingCategories).where(inTrip(packingCategories)),
      tx.select().from(packingItems).where(inTrip(packingItems)),
    ]);
    const plan: PlanEntry[] = planBabyImport(categories.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) })));
    const quantities = new Set(accepted.quantities);
    const addAnyway = new Set(accepted.addAnyway);

    const categoryIds = new Map(categories.map((c) => [normalizeName(c.name), c.id]));
    let categoryOrder = Math.max(0, ...categories.map((c) => c.sort_order));
    const itemOrder = new Map<string, number>();
    const categoryFor = async (name: string) => {
      let id = categoryIds.get(normalizeName(name));
      if (!id) {
        [{ id }] = await tx
          .insert(packingCategories)
          .values({ name, sort_order: ++categoryOrder, trip_id: tripId, owner_id: ownerId })
          .returning({ id: packingCategories.id });
        categoryIds.set(normalizeName(name), id);
      }
      if (!itemOrder.has(id)) itemOrder.set(id, Math.max(0, ...items.filter((i) => i.category_id === id).map((i) => i.sort_order)));
      return id;
    };
    const itemWhere = (id: string) => and(eq(packingItems.id, id), eq(packingItems.trip_id, tripId), eq(packingItems.owner_id, ownerId));

    let added = 0;
    let matched = 0;
    let updated = 0;
    let skipped = 0;
    for (const entry of plan) {
      const { item } = entry;
      if (entry.status === "new" || (entry.status === "ambiguous" && addAnyway.has(item.key))) {
        const categoryId = await categoryFor(item.category);
        const order = itemOrder.get(categoryId)! + 1;
        const rows = await tx
          .insert(packingItems)
          .values({
            category_id: categoryId,
            label: item.label,
            quantity: item.quantity,
            quantity_text: item.quantityText,
            source_key: item.key,
            traveler_name: item.traveler,
            notes: item.notes,
            is_packed: false,
            sort_order: order,
            trip_id: tripId,
            owner_id: ownerId,
          })
          .onConflictDoNothing()
          .returning({ id: packingItems.id });
        if (rows.length) {
          itemOrder.set(categoryId, order);
          added++;
        } else {
          matched++; // a concurrent import got there first
        }
      } else if (entry.status === "ambiguous") {
        skipped++;
      } else if (entry.status === "match") {
        // Only record the key on a row that doesn't have one; nothing else is touched.
        if (entry.adopt) await tx.update(packingItems).set({ source_key: item.key }).where(and(itemWhere(entry.existingId), isNull(packingItems.source_key)));
        matched++;
      } else if (quantities.has(item.key)) {
        await tx
          .update(packingItems)
          .set({
            quantity: item.quantity,
            quantity_text: item.quantityText,
            ...(entry.adopt ? { source_key: item.key } : {}),
          })
          .where(itemWhere(entry.existingId));
        updated++;
      } else {
        if (entry.adopt) await tx.update(packingItems).set({ source_key: item.key }).where(and(itemWhere(entry.existingId), isNull(packingItems.source_key)));
        skipped++;
      }
    }
    return { ok: true, added, matched, updated, skipped };
  });
}


/** The owner's other trips with their packing lists (for "Copy from another trip"). */
export async function listPackingSources(db: Db, ownerId: OwnerId, tripId: string): Promise<PackingSource[]> {
  const [tripRows, categories, items] = await Promise.all([
    db
      .select({
        id: trips.id,
        title: trips.title,
        destination: trips.destination,
        start_date: trips.start_date,
        end_date: trips.end_date,
      })
      .from(trips)
      .where(and(eq(trips.owner_id, ownerId), ne(trips.id, tripId)))
      .orderBy(sql`${trips.start_date} desc`, asc(trips.created_at)),
    db
      .select({ id: packingCategories.id, trip_id: packingCategories.trip_id, name: packingCategories.name })
      .from(packingCategories)
      .where(and(eq(packingCategories.owner_id, ownerId), ne(packingCategories.trip_id, tripId)))
      .orderBy(asc(packingCategories.sort_order), asc(packingCategories.created_at)),
    db
      .select({ category_id: packingItems.category_id, label: packingItems.label, traveler_name: packingItems.traveler_name })
      .from(packingItems)
      .where(and(eq(packingItems.owner_id, ownerId), ne(packingItems.trip_id, tripId)))
      .orderBy(asc(packingItems.sort_order), asc(packingItems.created_at)),
  ]);
  return tripRows.map((t) => ({
    ...t,
    categories: categories
      .filter((c) => c.trip_id === t.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        items: items.filter((i) => i.category_id === c.id).map(({ label, traveler_name }) => ({ label, traveler_name })),
      })),
  }));
}

/**
 * Copy categories (all, or the chosen ones) from another of the owner's
 * trips. The source trip and every chosen category are re-checked against
 * the verified owner; anything unknown refuses the whole copy. Labels,
 * quantities, notes, traveler names and category order are copied; packed
 * state, IDs and timestamps are not. The source is only read.
 */
export async function copyPackingFromTrip(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
  sourceTripId: string,
  categoryIds: string[] | "all",
): Promise<PackingMergeResult> {
  if (sourceTripId === tripId) return { ok: false, reason: "source_not_found" };
  if (categoryIds !== "all" && categoryIds.length === 0) return { ok: false, reason: "nothing_selected" };
  return db.transaction(async (tx): Promise<PackingMergeResult> => {
    if (!(await ownedTrip(tx, ownerId, tripId, true))) return { ok: false, reason: "not_found" };
    if (!(await ownedTrip(tx, ownerId, sourceTripId))) return { ok: false, reason: "source_not_found" };

    const sourceCategories = await tx
      .select({ id: packingCategories.id, name: packingCategories.name })
      .from(packingCategories)
      .where(and(eq(packingCategories.trip_id, sourceTripId), eq(packingCategories.owner_id, ownerId)))
      .orderBy(asc(packingCategories.sort_order), asc(packingCategories.created_at));
    const chosen = categoryIds === "all" ? sourceCategories : sourceCategories.filter((c) => categoryIds.includes(c.id));
    if (categoryIds !== "all" && (new Set(categoryIds).size !== chosen.length)) {
      return { ok: false, reason: "source_not_found" };
    }
    if (chosen.length === 0) return { ok: false, reason: "nothing_selected" };

    const sourceItems = await tx
      .select()
      .from(packingItems)
      .where(
        and(
          eq(packingItems.trip_id, sourceTripId),
          eq(packingItems.owner_id, ownerId),
          inArray(packingItems.category_id, chosen.map((c) => c.id)),
        ),
      )
      .orderBy(asc(packingItems.sort_order), asc(packingItems.created_at));

    return mergeIntoTrip(
      tx,
      ownerId,
      tripId,
      chosen.map((c) => ({
        name: c.name,
        items: sourceItems
          .filter((i) => i.category_id === c.id)
          .map(({ label, quantity, traveler_name, notes }) => ({ label, quantity, traveler_name, notes })),
      })),
    );
  });
}

/* ---------------------------- memories ---------------------------- */

/** The trip's summary (null if none yet), or undefined when the trip isn't the owner's. */
export async function getTripMemory(
  db: Db,
  ownerId: OwnerId,
  tripId: string,
): Promise<TripMemory | null | undefined> {
  const [trip, rows] = await Promise.all([
    ownedTrip(db, ownerId, tripId),
    db
      .select()
      .from(tripMemories)
      .where(and(eq(tripMemories.trip_id, tripId), eq(tripMemories.owner_id, ownerId))),
  ]);
  if (!trip) return undefined;
  return rows[0] ?? null;
}

/**
 * Create the trip's single summary or update it in one atomic upsert (the
 * unique trip_id makes concurrent first saves converge on one row). Only
 * the given fields are written, so the reflection and the album link can be
 * saved separately without erasing each other. false = trip not found.
 */
export async function saveTripMemory(db: Db, ownerId: OwnerId, tripId: string, input: Partial<TripMemoryInput>) {
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<TripMemoryInput>;
  if (Object.keys(patch).length === 0) return false;
  try {
    const rows = await db
      .insert(tripMemories)
      .values({ ...patch, trip_id: tripId, owner_id: ownerId })
      .onConflictDoUpdate({
        target: tripMemories.trip_id,
        set: { ...patch, updated_at: sql`now()` },
        // The trip FK already pins owner_id; this keeps the write owner-scoped regardless.
        setWhere: eq(tripMemories.owner_id, ownerId),
      })
      .returning({ id: tripMemories.id });
    return rows.length === 1;
  } catch (error) {
    if (isForeignKeyViolation(error, "trip_memories_trip_same_owner_fk")) return false;
    throw error;
  }
}

export async function deleteTripMemory(db: Db, ownerId: OwnerId, tripId: string) {
  const rows = await db
    .delete(tripMemories)
    .where(and(eq(tripMemories.trip_id, tripId), eq(tripMemories.owner_id, ownerId)))
    .returning({ id: tripMemories.id });
  return rows.length === 1;
}
