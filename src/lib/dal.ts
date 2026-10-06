import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import * as q from "@/db/queries";
import { getCurrentUser } from "@/lib/user";
import type { StarterKey } from "@/lib/packing";
import { idSchema } from "@/lib/validation";
import type {
  DocumentInput,
  ItineraryItemInput,
  PackingCategoryInput,
  PackingItemInput,
  PlaceInput,
  ReservationInput,
  TripInput,
  TripMemoryInput,
  VisitReviewInput,
} from "@/lib/types";

/**
 * Data access layer — the only way pages and Server Actions reach the
 * database. Every function verifies the session itself (layouts and the
 * proxy are not trusted for this) and passes the verified user ID to the
 * owner-scoped queries. Client-supplied IDs are treated as untrusted: invalid
 * or inaccessible IDs all produce the same "not found" result.
 */

export type {
  ItineraryWriteResult,
  PackingCategoryDeleteChoice,
  ReorderResult,
  VisitRecordResult,
} from "@/db/queries";

/** Signed out (or session expired) during a mutation. */
export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
  }
}

/** For pages: the verified user, or a redirect to sign in. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For mutations: the verified user ID, or AuthRequiredError. */
async function requireUserId() {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user.id;
}

const isId = (value: string) => idSchema.safeParse(value).success;

const NOT_FOUND = { ok: false, reason: "not_found" } as const;

/* ----------------------------- reads ------------------------------ */

export const listTripsForUser = cache(async () => {
  const user = await requireUser();
  return q.listTrips(getDb(), user.id);
});

export const getTripForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  return q.getTripWithDetails(getDb(), user.id, tripId);
});

/* ----------------------------- trips ------------------------------ */

export async function createTripForUser(input: TripInput) {
  const ownerId = await requireUserId();
  return q.createTrip(getDb(), ownerId, input);
}

/** false = not found (missing, malformed, or someone else's). */
export async function updateTripForUser(tripId: string, input: TripInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return false;
  return q.updateTrip(getDb(), ownerId, tripId, input);
}

export async function deleteTripForUser(tripId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return false;
  return q.deleteTrip(getDb(), ownerId, tripId);
}

/* -------------------------- reservations -------------------------- */

export async function createReservationForUser(tripId: string, input: ReservationInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return null;
  return q.createReservation(getDb(), ownerId, tripId, input);
}

export async function updateReservationForUser(tripId: string, reservationId: string, input: ReservationInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(reservationId)) return NOT_FOUND;
  return q.updateReservation(getDb(), ownerId, tripId, reservationId, input);
}

/** null = not found; otherwise how many linked visits were kept as standalone. */
export async function deleteReservationForUser(tripId: string, reservationId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(reservationId)) return null;
  return q.deleteReservation(getDb(), ownerId, tripId, reservationId);
}

/* ---------------------------- documents --------------------------- */

export async function createDocumentForUser(tripId: string, input: DocumentInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return NOT_FOUND;
  return q.createDocument(getDb(), ownerId, tripId, input);
}

export async function updateDocumentForUser(tripId: string, documentId: string, input: DocumentInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(documentId)) return NOT_FOUND;
  return q.updateDocument(getDb(), ownerId, tripId, documentId, input);
}

export async function deleteDocumentForUser(tripId: string, documentId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(documentId)) return false;
  return q.deleteDocument(getDb(), ownerId, tripId, documentId);
}

/* ------------------------------ places ---------------------------- */

/** Explore list with derived visited state; null = trip not found. */
export const getPlacesForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  return q.listPlaces(getDb(), user.id, tripId);
});

/** requestId (optional, a form-generated UUID) makes repeated submits idempotent. */
export async function createPlaceForUser(tripId: string, input: PlaceInput, requestId?: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || (requestId !== undefined && !isId(requestId))) return NOT_FOUND;
  return q.createPlace(getDb(), ownerId, tripId, input, requestId);
}

export async function recordPlaceVisitForUser(
  tripId: string,
  placeId: string,
  input: q.VisitRecordInput,
  choice: q.VisitRecordChoice,
  requestId?: string,
) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(placeId)) return NOT_FOUND;
  if (choice.type === "complete" && !isId(choice.itemId)) return NOT_FOUND;
  if (requestId !== undefined && !isId(requestId)) return NOT_FOUND;
  return q.recordPlaceVisit(getDb(), ownerId, tripId, placeId, input, choice, requestId);
}

export async function updatePlaceForUser(tripId: string, placeId: string, input: PlaceInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(placeId)) return false;
  return q.updatePlace(getDb(), ownerId, tripId, placeId, input);
}

export async function deletePlaceForUser(tripId: string, placeId: string, visits: "block" | "detach") {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(placeId)) return NOT_FOUND;
  return q.deletePlace(getDb(), ownerId, tripId, placeId, visits);
}

/* ----------------------------- itinerary -------------------------- */

/** Every visit with its place and booking; null = trip not found. */
export const getItineraryForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  return q.listItinerary(getDb(), user.id, tripId);
});

export async function createItineraryItemForUser(
  tripId: string,
  input: ItineraryItemInput,
  options: q.ItineraryWriteOptions = {},
) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || (options.requestId !== undefined && !isId(options.requestId))) return NOT_FOUND;
  return q.createItineraryItem(getDb(), ownerId, tripId, input, options);
}

export async function updateItineraryItemForUser(
  tripId: string,
  itemId: string,
  input: ItineraryItemInput,
  options: Pick<q.ItineraryWriteOptions, "saveToExplore"> = {},
) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return NOT_FOUND;
  return q.updateItineraryItem(getDb(), ownerId, tripId, itemId, input, options);
}

/** Only the given review fields change. */
export async function reviewItineraryItemForUser(tripId: string, itemId: string, review: Partial<VisitReviewInput>) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return false;
  return q.reviewItineraryItem(getDb(), ownerId, tripId, itemId, review);
}

export async function deleteItineraryItemForUser(tripId: string, itemId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return false;
  return q.deleteItineraryItem(getDb(), ownerId, tripId, itemId);
}

export async function moveItineraryItemForUser(tripId: string, itemId: string, date: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return NOT_FOUND;
  return q.moveItineraryItem(getDb(), ownerId, tripId, itemId, date);
}

export async function duplicateItineraryItemForUser(tripId: string, itemId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return NOT_FOUND;
  return q.duplicateItineraryItem(getDb(), ownerId, tripId, itemId);
}

export async function reorderItineraryForUser(tripId: string, keys: { type: "item" | "reservation"; id: string }[]) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || keys.some((k) => !isId(k.id))) return NOT_FOUND;
  return q.reorderItinerary(getDb(), ownerId, tripId, keys);
}

export async function ensureReservationVisitForUser(tripId: string, reservationId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(reservationId)) return NOT_FOUND;
  return q.ensureReservationVisit(getDb(), ownerId, tripId, reservationId);
}

/* ------------------------------ packing --------------------------- */

/** Categories with their items, in order; null = trip not found. */
export const getPackingForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  return q.getPacking(getDb(), user.id, tripId);
});

export async function createPackingCategoryForUser(tripId: string, input: PackingCategoryInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return NOT_FOUND;
  return q.createPackingCategory(getDb(), ownerId, tripId, input);
}

export async function updatePackingCategoryForUser(tripId: string, categoryId: string, input: PackingCategoryInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(categoryId)) return NOT_FOUND;
  return q.updatePackingCategory(getDb(), ownerId, tripId, categoryId, input);
}

export async function deletePackingCategoryForUser(
  tripId: string,
  categoryId: string,
  choice: q.PackingCategoryDeleteChoice,
) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(categoryId)) return NOT_FOUND;
  return q.deletePackingCategory(getDb(), ownerId, tripId, categoryId, choice);
}

/** requestId (optional, a form-generated UUID) makes repeated submits idempotent. */
export async function createPackingItemForUser(tripId: string, input: PackingItemInput, requestId?: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || (requestId !== undefined && !isId(requestId))) return NOT_FOUND;
  return q.createPackingItem(getDb(), ownerId, tripId, input, requestId);
}

export async function updatePackingItemForUser(tripId: string, itemId: string, input: PackingItemInput) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return NOT_FOUND;
  return q.updatePackingItem(getDb(), ownerId, tripId, itemId, input);
}

export async function movePackingItemForUser(tripId: string, itemId: string, categoryId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId) || !isId(categoryId)) return NOT_FOUND;
  return q.movePackingItem(getDb(), ownerId, tripId, itemId, categoryId);
}

/** Sets the given value (never inverts the stored one). */
export async function setPackingItemPackedForUser(tripId: string, itemId: string, packed: boolean) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return false;
  return q.setPackingItemPacked(getDb(), ownerId, tripId, itemId, packed);
}

/** How many items were unpacked; null = trip not found. */
export async function unpackAllPackingItemsForUser(tripId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return null;
  return q.unpackAllPackingItems(getDb(), ownerId, tripId);
}

export async function deletePackingItemForUser(tripId: string, itemId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(itemId)) return false;
  return q.deletePackingItem(getDb(), ownerId, tripId, itemId);
}

export async function reorderPackingCategoriesForUser(tripId: string, ids: string[]) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || ids.some((id) => !isId(id))) return NOT_FOUND;
  return q.reorderPackingCategories(getDb(), ownerId, tripId, ids);
}

export async function reorderPackingItemsForUser(tripId: string, categoryId: string, ids: string[]) {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(categoryId) || ids.some((id) => !isId(id))) return NOT_FOUND;
  return q.reorderPackingItems(getDb(), ownerId, tripId, categoryId, ids);
}

export async function applyPackingStarterForUser(tripId: string, keys: StarterKey[]) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return NOT_FOUND;
  return q.applyPackingStarter(getDb(), ownerId, tripId, keys);
}

/** The signed-in owner's other trips with their lists, for "Copy from another trip". */
export const getPackingSourcesForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return [];
  return q.listPackingSources(getDb(), user.id, tripId);
});

/** The source trip is untrusted input: the query re-checks it belongs to the verified owner. */
export async function copyPackingFromTripForUser(tripId: string, sourceTripId: string, categoryIds: string[] | "all") {
  const ownerId = await requireUserId();
  if (!isId(tripId) || !isId(sourceTripId)) return NOT_FOUND;
  if (categoryIds !== "all" && categoryIds.some((id) => !isId(id))) return { ok: false, reason: "source_not_found" } as const;
  return q.copyPackingFromTrip(getDb(), ownerId, tripId, sourceTripId, categoryIds);
}

/* ----------------------------- memories --------------------------- */

/**
 * The trip summary plus its completed visits (the per-activity memories,
 * read from itinerary_items — never copied). null = trip not found.
 */
export const getMemoriesForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  const db = getDb();
  const [memory, visits] = await Promise.all([
    q.getTripMemory(db, user.id, tripId),
    q.listItinerary(db, user.id, tripId, { completedOnly: true }),
  ]);
  if (memory === undefined || visits === null) return null;
  return { memory, visits };
});

/** Writes only the given fields (atomic upsert on the trip's unique summary row). */
export async function saveTripMemoryForUser(tripId: string, input: Partial<TripMemoryInput>) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return false;
  return q.saveTripMemory(getDb(), ownerId, tripId, input);
}

export async function deleteTripMemoryForUser(tripId: string) {
  const ownerId = await requireUserId();
  if (!isId(tripId)) return false;
  return q.deleteTripMemory(getDb(), ownerId, tripId);
}
