import "server-only";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { getDb, type Db } from "@/db";
import * as q from "@/db/queries";
import * as notif from "@/db/notifications";
import * as eveningDb from "@/db/evening-preview";
import * as reminderDb from "@/db/reminders";
import * as pollDb from "@/db/polls";
import * as sharing from "@/db/sharing";
import * as settingsDb from "@/db/settings";
import { getCurrentUser, initialsFrom, type CurrentUser } from "@/lib/user";
import { availableBackgrounds } from "@/lib/background-assets";
import { defaultDisplayPreferences, type SettingsSection, type SettingsSnapshot, type BackgroundId, type EveningPreviewSchedule } from "@/lib/settings";
import type { TripContext } from "@/db/sharing";
import { decideInvitePage, type InvitePage } from "@/lib/invite-page";
import { actionLabel, sampleTarget } from "@/lib/evening-preview";
import { createPreviewSender } from "@/lib/email/evening-email";
import { createReminderSender } from "@/lib/email/reminder-email";
import { type PresetChoice, type ReminderSubject, type RuleInput } from "@/lib/reminders";
import { getEmailConfig } from "@/lib/email/invitation-email";
import { type NotificationFilter, type NotificationItem, type NotificationPage } from "@/lib/notifications";
import {
  ForbiddenError,
  TOKEN_PATTERN,
  normalizeEmail,
  type Capability,
  type InviteRole,
  type ShareView,
} from "@/lib/sharing";
import type { StarterKey } from "@/lib/packing";
import { COLLECTIONS, collectionById } from "@/lib/collections/aruba-2026-explore";
import { collectionMatchesTrip } from "@/lib/collections/collection";
import { PLANS } from "@/lib/plans/aruba-2026";
import { planMatchesTrip } from "@/lib/plans/itinerary-plan";
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
 * proxy are not trusted for this).
 *
 * Trips can be shared, so access is resolved per trip: `readTrip`, `editTrip`
 * and `ownTrip` verify the session, look up the caller's role on THAT trip
 * (owner, editor, viewer, or none) from the database, and only then call the
 * owner-scoped queries with the trip's real owner ID (child rows carry it).
 * A trip ID from the browser is never trusted: no access → the same "not
 * found" result as a missing trip; too little access (a viewer writing) →
 * ForbiddenError. Writes run in a transaction attributed to the caller.
 */

export type { ChangeKind, InvitationRow, MemberChange } from "@/db/sharing";
export type {
  CollectionImportResult,
  ItineraryWriteResult,
  PlanApplyInput,
  PlanApplyResult,
  PlanApplySummary,
  PlanPreviewResult,
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
  return withLocalName(user);
}

/**
 * The person's Atlas-only display name (Settings → Account), when they set one,
 * replaces the Google name everywhere Atlas shows it. Only the name changes —
 * email and photo stay the Google account's. If Settings can't be read the
 * Google name is used: a name lookup never takes a page down.
 */
const withLocalName = cache(async (user: CurrentUser): Promise<CurrentUser> => {
  try {
    const name = await settingsDb.displayNameOverride(getDb(), user.id);
    return name ? { ...user, displayName: name, firstName: name.split(/\s+/)[0], initials: initialsFrom(name) } : user;
  } catch {
    return user;
  }
});

/** For mutations: the verified user ID, or AuthRequiredError. */
async function requireUserId() {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user.id;
}

const isId = (value: string) => idSchema.safeParse(value).success;

const NOT_FOUND = { ok: false, reason: "not_found" } as const;

export { ForbiddenError };
export type { TripContext };

/** The caller's role on a trip (cached per request); null = no access or no such trip. */
const accessFor = cache(async (userId: string, tripId: string) => sharing.resolveTripAccess(getDb(), userId, tripId));

/** Read access to a trip. For pages: redirects to sign-in when signed out. */
async function readTrip<T, F>(tripId: string, fallback: F, fn: (db: Db, ctx: TripContext) => Promise<T>): Promise<T | F> {
  const user = await requireUser();
  if (!isId(tripId)) return fallback;
  const access = await accessFor(user.id, tripId);
  if (!access) return fallback;
  return fn(getDb(), { userId: user.id, ...access });
}

/** Resolve access inside the write transaction (so a just-removed member cannot slip a write in). */
async function withTripWrite<T, F>(
  tripId: string,
  capability: Capability,
  fallback: F,
  fn: (db: Db, ctx: TripContext) => Promise<T>,
): Promise<T | F> {
  const userId = await requireUserId();
  if (!isId(tripId)) return fallback;
  return sharing.runTripWrite(getDb(), userId, tripId, capability, fallback, fn);
}

/** Owner, or an editor: add / change / delete planning content. */
const editTrip = <T, F>(tripId: string, fallback: F, fn: (db: Db, ctx: TripContext) => Promise<T>) =>
  withTripWrite(tripId, "contribute", fallback, fn);

/**
 * Any current member, viewers included: answer a poll, and (with an organizer
 * check inside the query) close / cancel / decide the polls they asked. This
 * is a narrow participation permission — it never reaches the itinerary or any
 * other trip data, which still go through editTrip / ownTrip.
 */
const participateTrip = <T, F>(tripId: string, fallback: F, fn: (db: Db, ctx: TripContext) => Promise<T>) =>
  withTripWrite(tripId, "participate", fallback, fn);

/** Owner only: trip settings, deletion, invitations, members. */
const ownTrip = <T, F>(tripId: string, fallback: F, fn: (db: Db, ctx: TripContext) => Promise<T>) =>
  withTripWrite(tripId, "manage_trip", fallback, fn);

/* ----------------------------- reads ------------------------------ */

/** Trips the user owns plus trips shared with them (with the user's role on each). */
export const listTripsForUser = cache(async () => {
  const user = await requireUser();
  return sharing.listAccessibleTrips(getDb(), user.id);
});

export const getTripForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => q.getTripWithDetails(db, ctx.ownerId, tripId));
});

/** The caller's role on a trip, or null (no access / no such trip). */
export const getTripRoleForUser = cache(async (tripId: string) => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  const access = await accessFor(user.id, tripId);
  return access ? { role: access.role, ownerId: access.ownerId, userId: user.id } : null;
});

/** Cheap change fingerprint for the "someone updated this trip" poll. null = no access. */
export async function getTripVersionForUser(tripId: string) {
  const userId = await requireUserId();
  if (!isId(tripId)) return null;
  const access = await sharing.resolveTripAccess(getDb(), userId, tripId);
  return access ? sharing.tripVersion(getDb(), access.ownerId, tripId) : null;
}

/* ----------------------------- trips ------------------------------ */

export async function createTripForUser(input: TripInput) {
  const ownerId = await requireUserId();
  return q.createTrip(getDb(), ownerId, input);
}

/** false = not found (missing, malformed, or no access). Owners only. */
export async function updateTripForUser(tripId: string, input: TripInput) {
  return ownTrip(tripId, false, (db, ctx) => q.updateTrip(db, ctx.ownerId, tripId, input));
}

export async function deleteTripForUser(tripId: string) {
  return ownTrip(tripId, false, (db, ctx) => q.deleteTrip(db, ctx.ownerId, tripId));
}

/* -------------------------- reservations -------------------------- */

export async function createReservationForUser(tripId: string, input: ReservationInput) {
  return editTrip(tripId, null, (db, ctx) => q.createReservation(db, ctx.ownerId, tripId, input));
}

/** `expectedUpdatedAt` (what the editor loaded) turns a lost update into a "conflict" result. */
export async function updateReservationForUser(
  tripId: string,
  reservationId: string,
  input: ReservationInput,
  expectedUpdatedAt?: string,
) {
  if (!isId(reservationId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) =>
    q.updateReservation(db, ctx.ownerId, tripId, reservationId, input, expectedUpdatedAt),
  );
}

/** null = not found; otherwise how many linked visits were kept as standalone. */
export async function deleteReservationForUser(tripId: string, reservationId: string) {
  if (!isId(reservationId)) return editTrip(tripId, null, async () => null);
  return editTrip(tripId, null, (db, ctx) => q.deleteReservation(db, ctx.ownerId, tripId, reservationId));
}

/* ---------------------------- documents --------------------------- */

export async function createDocumentForUser(tripId: string, input: DocumentInput) {
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.createDocument(db, ctx.ownerId, tripId, input));
}

export async function updateDocumentForUser(tripId: string, documentId: string, input: DocumentInput) {
  if (!isId(documentId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.updateDocument(db, ctx.ownerId, tripId, documentId, input));
}

export async function deleteDocumentForUser(tripId: string, documentId: string) {
  if (!isId(documentId)) return editTrip(tripId, false, async () => false);
  return editTrip(tripId, false, (db, ctx) => q.deleteDocument(db, ctx.ownerId, tripId, documentId));
}

/* ------------------------------ places ---------------------------- */

/** Explore list with derived visited state (and the caller's private hearts / notes); null = no access. */
export const getPlacesForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => q.listPlaces(db, ctx.ownerId, tripId, ctx.userId));
});

/** requestId (optional, a form-generated UUID) makes repeated submits idempotent. */
export async function createPlaceForUser(tripId: string, input: PlaceInput, requestId?: string) {
  if (requestId !== undefined && !isId(requestId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.createPlace(db, ctx.ownerId, tripId, input, requestId));
}

export async function recordPlaceVisitForUser(
  tripId: string,
  placeId: string,
  input: q.VisitRecordInput,
  choice: q.VisitRecordChoice,
  requestId?: string,
) {
  const bad =
    !isId(placeId) ||
    (choice.type === "complete" && !isId(choice.itemId)) ||
    (requestId !== undefined && !isId(requestId));
  if (bad) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) =>
    q.recordPlaceVisit(db, ctx.ownerId, tripId, placeId, input, choice, requestId),
  );
}

/** true = saved, false = not found, "conflict" = changed by someone else since it was opened. */
export async function updatePlaceForUser(tripId: string, placeId: string, input: PlaceInput, expectedUpdatedAt?: string) {
  if (!isId(placeId)) return editTrip(tripId, false, async () => false as const);
  return editTrip(tripId, false, (db, ctx) => q.updatePlace(db, ctx.ownerId, tripId, placeId, input, expectedUpdatedAt));
}

export async function deletePlaceForUser(tripId: string, placeId: string, visits: "block" | "detach") {
  if (!isId(placeId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.deletePlace(db, ctx.ownerId, tripId, placeId, visits));
}

/**
 * "Your notes" and the heart are private to the signed-in member, so any
 * member — viewers included — may keep their own; they never change the trip.
 */
export async function updatePlaceNotesForUser(tripId: string, placeId: string, notes: string | null) {
  const userId = await requireUserId();
  if (!isId(tripId) || !isId(placeId)) return false;
  const access = await sharing.resolveTripAccess(getDb(), userId, tripId);
  if (!access) return false;
  return q.updatePlaceNotes(getDb(), access.ownerId, tripId, placeId, notes, userId);
}

export async function setPlaceFavoriteForUser(tripId: string, placeId: string, favorite: boolean) {
  const userId = await requireUserId();
  if (!isId(tripId) || !isId(placeId)) return false;
  const access = await sharing.resolveTripAccess(getDb(), userId, tripId);
  if (!access) return false;
  return q.setPlaceFavorite(getDb(), access.ownerId, tripId, placeId, favorite, userId);
}

/**
 * Curated collections that fit this trip. Only the owner is offered the
 * user's other trips (members never see trips that aren't shared with them).
 * Read-only; null = no access.
 */
export const getExploreCollectionsForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, async (db, ctx) => {
    const own = ctx.role === "owner" ? await q.listTrips(db, ctx.userId) : [];
    const trip = ctx.role === "owner" ? own.find((t) => t.id === tripId) : await q.getTripWithDetails(db, ctx.ownerId, tripId);
    if (!trip) return null;
    return COLLECTIONS.filter((c) => collectionMatchesTrip(c, trip)).map((c) => ({
      id: c.id,
      label: c.label,
      heading: c.heading,
      subheading: c.subheading,
      sourceKeys: c.items.map((i) => i.sourceKey),
      counts: {
        outings: c.items.filter((i) => i.recommendation.type === "attraction" || i.recommendation.type === "beach").length,
        restaurants: c.items.filter((i) => i.recommendation.type === "restaurant").length,
        spas: c.items.filter((i) => i.recommendation.type === "spa").length,
      },
      otherTrips: own
        .filter((t) => t.id !== tripId && collectionMatchesTrip(c, t))
        .map((t) => ({ id: t.id, title: t.title, start_date: t.start_date, end_date: t.end_date })),
    }));
  });
});

/** Import a curated collection into the trip (idempotent). */
export async function importExploreCollectionForUser(tripId: string, collectionId: string) {
  const collection = collectionById(collectionId);
  if (!collection) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.importExploreCollection(db, ctx.ownerId, tripId, collection));
}

/* ----------------------------- itinerary -------------------------- */

/**
 * Itinerary writes tell the rest of the trip about meaningful changes (an
 * activity added, removed, rescheduled, or given another place) — see
 * `withItineraryAnnouncement`. The actor is never notified.
 */
async function announcingItinerary<R>(
  db: Db,
  ctx: TripContext,
  tripId: string,
  kind: "added" | "removed" | "changed",
  itemId: string | null,
  write: () => Promise<R>,
  outcome: (result: R) => { ok: boolean; id?: string },
): Promise<R> {
  const user = await getCurrentUser();
  return notif.withItineraryAnnouncement(
    db,
    { ownerId: ctx.ownerId, tripId, actorId: ctx.userId, actorName: user?.displayName ?? "", kind, itemId },
    write,
    outcome,
  );
}

/** Every visit with its place and booking; null = no access. */
export const getItineraryForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => q.listItinerary(db, ctx.ownerId, tripId));
});

export async function createItineraryItemForUser(
  tripId: string,
  input: ItineraryItemInput,
  options: q.ItineraryWriteOptions = {},
) {
  if (options.requestId !== undefined && !isId(options.requestId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => {
    const write = () => q.createItineraryItem(db, ctx.ownerId, tripId, input, options);
    // A "Capture a moment" entry is a memory of something done, not a plan change.
    if (options.completed) return write();
    return announcingItinerary(db, ctx, tripId, "added", null, write, (r) => ({ ok: r.ok, id: r.ok ? r.id : undefined }));
  });
}

export async function updateItineraryItemForUser(
  tripId: string,
  itemId: string,
  input: ItineraryItemInput,
  options: Pick<q.ItineraryWriteOptions, "saveToExplore"> & { expectedUpdatedAt?: string } = {},
) {
  if (!isId(itemId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) =>
    announcingItinerary(db, ctx, tripId, "changed", itemId, () => q.updateItineraryItem(db, ctx.ownerId, tripId, itemId, input, options), (r) => ({ ok: r.ok })),
  );
}

/** Only the given review fields change. */
export async function reviewItineraryItemForUser(tripId: string, itemId: string, review: Partial<VisitReviewInput>) {
  if (!isId(itemId)) return editTrip(tripId, false, async () => false);
  return editTrip(tripId, false, (db, ctx) => q.reviewItineraryItem(db, ctx.ownerId, tripId, itemId, review));
}

export async function deleteItineraryItemForUser(tripId: string, itemId: string) {
  if (!isId(itemId)) return editTrip(tripId, false, async () => false);
  return editTrip(tripId, false, (db, ctx) =>
    announcingItinerary(db, ctx, tripId, "removed", itemId, () => q.deleteItineraryItem(db, ctx.ownerId, tripId, itemId), (ok) => ({ ok })),
  );
}

export async function moveItineraryItemForUser(tripId: string, itemId: string, date: string) {
  if (!isId(itemId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) =>
    announcingItinerary(db, ctx, tripId, "changed", itemId, () => q.moveItineraryItem(db, ctx.ownerId, tripId, itemId, date), (r) => ({ ok: r.ok })),
  );
}

export async function duplicateItineraryItemForUser(tripId: string, itemId: string) {
  if (!isId(itemId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) =>
    announcingItinerary(db, ctx, tripId, "added", null, () => q.duplicateItineraryItem(db, ctx.ownerId, tripId, itemId), (r) => ({ ok: r.ok, id: r.ok ? r.id : undefined })),
  );
}

export async function reorderItineraryForUser(tripId: string, keys: { type: "item" | "reservation"; id: string }[]) {
  if (keys.some((k) => !isId(k.id))) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.reorderItinerary(db, ctx.ownerId, tripId, keys));
}

export async function ensureReservationVisitForUser(tripId: string, reservationId: string) {
  if (!isId(reservationId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.ensureReservationVisit(db, ctx.ownerId, tripId, reservationId));
}

/* -------------------------- itinerary plans ------------------------ */

const planById = (planId: string) => PLANS.find((p) => p.id === planId) ?? null;

/**
 * Preview a saved plan against the trip (read-only). The owner is also
 * offered their other trips the plan could fit; members are not.
 * null = trip or plan not found.
 */
export async function previewItineraryPlanForUser(tripId: string, planId: string) {
  const plan = planById(planId);
  return readTrip(tripId, null, async (db, ctx) => {
    if (!plan) return null;
    const [preview, trips] = await Promise.all([
      q.previewItineraryPlan(db, ctx.ownerId, tripId, plan),
      ctx.role === "owner" ? q.listTrips(db, ctx.userId) : Promise.resolve([]),
    ]);
    if (!preview) return null;
    const otherTrips = trips
      .filter((t) => t.id !== tripId && planMatchesTrip(plan, t))
      .map((t) => ({ id: t.id, title: t.title, start_date: t.start_date, end_date: t.end_date }));
    return { preview, otherTrips };
  });
}

export async function applyItineraryPlanForUser(tripId: string, planId: string, input: q.PlanApplyInput) {
  const plan = planById(planId);
  if (!plan) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.applyItineraryPlan(db, ctx.ownerId, tripId, plan, input));
}

/* ------------------------------ packing --------------------------- */

/** Categories with their items, in order; null = no access. */
export const getPackingForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => q.getPacking(db, ctx.ownerId, tripId));
});

export async function createPackingCategoryForUser(tripId: string, input: PackingCategoryInput) {
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.createPackingCategory(db, ctx.ownerId, tripId, input));
}

export async function updatePackingCategoryForUser(tripId: string, categoryId: string, input: PackingCategoryInput) {
  if (!isId(categoryId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.updatePackingCategory(db, ctx.ownerId, tripId, categoryId, input));
}

export async function deletePackingCategoryForUser(
  tripId: string,
  categoryId: string,
  choice: q.PackingCategoryDeleteChoice,
) {
  if (!isId(categoryId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.deletePackingCategory(db, ctx.ownerId, tripId, categoryId, choice));
}

/** requestId (optional, a form-generated UUID) makes repeated submits idempotent. */
export async function createPackingItemForUser(tripId: string, input: PackingItemInput, requestId?: string) {
  if (requestId !== undefined && !isId(requestId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.createPackingItem(db, ctx.ownerId, tripId, input, requestId));
}

export async function updatePackingItemForUser(
  tripId: string,
  itemId: string,
  input: PackingItemInput,
  expectedUpdatedAt?: string,
) {
  if (!isId(itemId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) =>
    q.updatePackingItem(db, ctx.ownerId, tripId, itemId, input, expectedUpdatedAt),
  );
}

export async function movePackingItemForUser(tripId: string, itemId: string, categoryId: string) {
  if (!isId(itemId) || !isId(categoryId)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.movePackingItem(db, ctx.ownerId, tripId, itemId, categoryId));
}

/** Sets the given value (never inverts the stored one). */
export async function setPackingItemPackedForUser(tripId: string, itemId: string, packed: boolean) {
  if (!isId(itemId)) return editTrip(tripId, false, async () => false);
  return editTrip(tripId, false, (db, ctx) => q.setPackingItemPacked(db, ctx.ownerId, tripId, itemId, packed));
}

/** How many items were unpacked; null = no access. */
export async function unpackAllPackingItemsForUser(tripId: string) {
  return editTrip(tripId, null, (db, ctx) => q.unpackAllPackingItems(db, ctx.ownerId, tripId));
}

export async function deletePackingItemForUser(tripId: string, itemId: string) {
  if (!isId(itemId)) return editTrip(tripId, false, async () => false);
  return editTrip(tripId, false, (db, ctx) => q.deletePackingItem(db, ctx.ownerId, tripId, itemId));
}

export async function reorderPackingCategoriesForUser(tripId: string, ids: string[]) {
  if (ids.some((id) => !isId(id))) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.reorderPackingCategories(db, ctx.ownerId, tripId, ids));
}

export async function reorderPackingItemsForUser(tripId: string, categoryId: string, ids: string[]) {
  if (!isId(categoryId) || ids.some((id) => !isId(id))) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.reorderPackingItems(db, ctx.ownerId, tripId, categoryId, ids));
}

export async function applyPackingStarterForUser(tripId: string, keys: StarterKey[]) {
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.applyPackingStarter(db, ctx.ownerId, tripId, keys));
}

export async function importBabyPackingForUser(tripId: string, accepted: { quantities: string[]; addAnyway: string[] }) {
  return editTrip(tripId, NOT_FOUND, (db, ctx) => q.importBabyPacking(db, ctx.ownerId, tripId, accepted));
}

/**
 * The owner's OTHER trips with their lists, for "Copy from another trip".
 * Only the owner is offered them: an editor must never reach trips that
 * aren't shared with them.
 */
export const getPackingSourcesForUser = cache(async (tripId: string) => {
  return readTrip(tripId, [], async (db, ctx) => (ctx.role === "owner" ? q.listPackingSources(db, ctx.userId, tripId) : []));
});

/** Owner only. The source trip is untrusted input: the query re-checks it belongs to the verified owner. */
export async function copyPackingFromTripForUser(tripId: string, sourceTripId: string, categoryIds: string[] | "all") {
  if (!isId(sourceTripId)) return ownTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  if (categoryIds !== "all" && categoryIds.some((id) => !isId(id))) {
    return ownTrip(tripId, NOT_FOUND, async () => ({ ok: false, reason: "source_not_found" }) as const);
  }
  return ownTrip(tripId, NOT_FOUND, (db, ctx) => q.copyPackingFromTrip(db, ctx.ownerId, tripId, sourceTripId, categoryIds));
}

/* ----------------------------- memories --------------------------- */

/**
 * The trip summary plus its completed visits (the per-activity memories,
 * read from itinerary_items — never copied). null = no access.
 */
export const getMemoriesForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, async (db, ctx) => {
    const [memory, visits] = await Promise.all([
      q.getTripMemory(db, ctx.ownerId, tripId),
      q.listItinerary(db, ctx.ownerId, tripId, { completedOnly: true }),
    ]);
    if (memory === undefined || visits === null) return null;
    return { memory, visits };
  });
});

/** Writes only the given fields (atomic upsert on the trip's unique summary row). */
export async function saveTripMemoryForUser(tripId: string, input: Partial<TripMemoryInput>) {
  return editTrip(tripId, false, (db, ctx) => q.saveTripMemory(db, ctx.ownerId, tripId, input));
}

export async function deleteTripMemoryForUser(tripId: string) {
  return editTrip(tripId, false, (db, ctx) => q.deleteTripMemory(db, ctx.ownerId, tripId));
}

/** When a record last changed and who changed it (names only) — to explain an edit conflict. */
export async function getRowChangeForUser(tripId: string, kind: sharing.ChangeKind, id: string) {
  return readTrip(tripId, null, async (db, ctx) => {
    if (!isId(id)) return null;
    const row = await sharing.rowChange(db, ctx.ownerId, tripId, kind, id);
    if (!row) return null;
    const names = row.updated_by ? await sharing.profileNames(db, [row.updated_by]) : {};
    return {
      updatedAt: row.updated_at,
      by: row.updated_by && row.updated_by !== ctx.userId ? (names[row.updated_by] ?? null) : null,
    };
  });
}

/* ------------------------------ sharing ---------------------------- */

/**
 * Who this trip is shared with, from the caller's point of view. Everyone
 * with access sees names and roles; only the owner sees member emails and
 * pending invitations. Also records the caller's name for attribution.
 */
export const getShareViewForUser = cache(async (tripId: string): Promise<ShareView | null> => {
  const user = await requireUser();
  if (!isId(tripId)) return null;
  const db = getDb();
  const access = await accessFor(user.id, tripId);
  if (!access) return null;
  await sharing.upsertProfile(db, { id: user.id, name: user.displayName, email: user.email ? normalizeEmail(user.email) : null });
  const [members, invitations, names] = await Promise.all([
    sharing.listMembers(db, access.ownerId, tripId),
    access.role === "owner" ? sharing.listOpenInvitations(db, access.ownerId, tripId) : Promise.resolve([]),
    sharing.profileNames(db, [access.ownerId]),
  ]);
  const ownerName = access.role === "owner" ? user.displayName : (names[access.ownerId] ?? "The trip owner");
  const people: Record<string, string> = { [access.ownerId]: ownerName };
  for (const m of members) people[m.user_id] = m.display_name;
  return {
    role: access.role,
    owner: { name: ownerName },
    people,
    members: members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      name: m.display_name,
      email: access.role === "owner" ? m.email : null,
      isYou: m.user_id === user.id,
    })),
    invitations,
  };
});

export type InviteOutcome =
  | { ok: true; id: string; token: string; email: string | null; role: InviteRole; expires_at: string }
  | { ok: false; reason: sharing.InvitationRefused["reason"]; invitationId?: string };

/** Owner only. Creates an email-bound invitation (`email` given) or a single-use copied link (`email` null). */
export async function createInvitationForUser(tripId: string, input: { email: string | null; role: InviteRole }): Promise<InviteOutcome> {
  const user = await requireUser();
  return ownTrip(tripId, { ok: false, reason: "not_found" } as InviteOutcome, async (db, ctx) => {
    await sharing.upsertProfile(db, { id: user.id, name: user.displayName, email: user.email ? normalizeEmail(user.email) : null });
    const outcome = await sharing.createInvitation(db, {
      ownerId: ctx.ownerId,
      tripId,
      invitedBy: ctx.userId,
      inviterName: user.displayName,
      email: input.email,
      role: input.role,
    });
    if (outcome.ok && outcome.email) {
      await notif.announceInvitationCreated(db, {
        ownerId: ctx.ownerId,
        tripId,
        inviterId: ctx.userId,
        inviterName: user.displayName,
        invitationId: outcome.id,
        email: outcome.email,
        role: outcome.role,
      });
    }
    return outcome;
  });
}

/** Owner only. Replaces the token (the old link stops working). `forEmail` applies the resend cooldown. */
export async function rotateInvitationForUser(tripId: string, invitationId: string, forEmail: boolean): Promise<InviteOutcome> {
  if (!isId(invitationId)) return ownTrip(tripId, { ok: false, reason: "not_found" } as InviteOutcome, async () => ({ ok: false, reason: "not_found" }) as InviteOutcome);
  return ownTrip(tripId, { ok: false, reason: "not_found" } as InviteOutcome, (db, ctx) =>
    sharing.rotateInvitation(db, { ownerId: ctx.ownerId, tripId, invitationId, forEmail }),
  );
}

/** Owner only. Records what the mail provider said — "sent" only once it accepted the message. */
export async function recordInvitationDeliveryForUser(
  tripId: string,
  invitationId: string,
  token: string,
  status: "sent" | "failed" | "not_configured",
) {
  if (!isId(invitationId)) return ownTrip(tripId, undefined, async () => undefined);
  return ownTrip(tripId, undefined, (db, ctx) =>
    sharing.recordDelivery(db, { ownerId: ctx.ownerId, tripId, invitationId, token, status }),
  );
}

export async function revokeInvitationForUser(tripId: string, invitationId: string) {
  if (!isId(invitationId)) return ownTrip(tripId, false, async () => false);
  return ownTrip(tripId, false, (db, ctx) => sharing.revokeInvitation(db, ctx.ownerId, tripId, invitationId));
}

export async function updateMemberRoleForUser(tripId: string, memberUserId: string, role: InviteRole) {
  return ownTrip(tripId, { ok: false, reason: "not_found" } as sharing.MemberChange, (db, ctx) =>
    sharing.updateMemberRole(db, ctx.ownerId, tripId, memberUserId, role),
  );
}

export async function removeMemberForUser(tripId: string, memberUserId: string) {
  return ownTrip(tripId, { ok: false, reason: "not_found" } as sharing.MemberChange, (db, ctx) =>
    sharing.removeMember(db, ctx.ownerId, tripId, memberUserId),
  );
}

/** A member leaves a trip shared with them. The owner cannot leave (they have no membership to drop). */
export async function leaveTripForUser(tripId: string) {
  const userId = await requireUserId();
  if (!isId(tripId)) return false;
  return sharing.leaveTrip(getDb(), userId, tripId);
}

/* --------------------------- invitation page ----------------------- */

export type { InvitePage };

/**
 * What the invitation page shows to the signed-in visitor. Only a minimal
 * preview (title, dates, inviter, role) and never the plan, bookings,
 * members or the full invited address. The browser supplies only the token.
 */
export async function getInvitePageForUser(token: string): Promise<InvitePage> {
  const user = await getCurrentUser();
  if (!user) return { kind: "signed_out" };
  if (!TOKEN_PATTERN.test(token)) return { kind: "invalid" };
  const db = getDb();
  const preview = await sharing.previewInvitation(db, sharing.hashInviteToken(token));
  if (!preview) return { kind: "invalid" };
  const isMember = Boolean(await sharing.resolveTripAccess(db, user.id, preview.trip.id));
  return decideInvitePage(preview, user, isMember);
}

/** Explicit acceptance by the verified, signed-in user. Safe to call twice or concurrently. */
export async function acceptInvitationForUser(token: string): Promise<sharing.AcceptResult> {
  const user = await requireUser();
  if (!TOKEN_PATTERN.test(token)) return { status: "invalid" };
  const result = await sharing.acceptInvitation(getDb(), {
    tokenHash: sharing.hashInviteToken(token),
    userId: user.id,
    userName: user.displayName,
    verifiedEmail: user.emailVerified && user.email ? normalizeEmail(user.email) : null,
    emailUnverified: !user.emailVerified,
  });
  if (result.status === "ok" || result.status === "accepted_by_you" || result.status === "already_member") {
    await sharing.upsertProfile(getDb(), { id: user.id, name: user.displayName, email: user.email ? normalizeEmail(user.email) : null });
  }
  return result;
}

/* ------------------- invitation page by id (from the inbox) ------------------- */

/**
 * The invitation page for a signed-in invitee reached from a notification:
 * the invitation id stands in for the raw token, which the inbox never sees.
 * Only an email-bound invitation whose address matches the viewer's VERIFIED
 * email (or one they already belong to) is shown; any other id looks exactly
 * like an unknown one.
 */
export async function getInvitePageByIdForUser(invitationId: string): Promise<InvitePage> {
  const user = await getCurrentUser();
  if (!user) return { kind: "signed_out" };
  if (!isId(invitationId)) return { kind: "invalid" };
  const db = getDb();
  const preview = await sharing.previewInvitationById(db, invitationId);
  if (!preview) return { kind: "invalid" };
  const isMember = Boolean(await sharing.resolveTripAccess(db, user.id, preview.trip.id));
  const verified = user.emailVerified && user.email ? normalizeEmail(user.email) : null;
  const theirs =
    isMember ||
    preview.owner_id === user.id ||
    preview.accepted_by === user.id ||
    (preview.email_bound && verified !== null && verified === preview.email);
  if (!theirs) return { kind: "invalid" };
  return decideInvitePage(preview, user, isMember);
}

/** Explicit acceptance from the invitation page opened via the inbox. Email-bound invitations only. */
export async function acceptInvitationByIdForUser(invitationId: string): Promise<sharing.AcceptResult> {
  const user = await requireUser();
  if (!isId(invitationId)) return { status: "invalid" };
  const result = await sharing.acceptInvitation(getDb(), {
    invitationId,
    userId: user.id,
    userName: user.displayName,
    verifiedEmail: user.emailVerified && user.email ? normalizeEmail(user.email) : null,
    emailUnverified: !user.emailVerified,
  });
  if (result.status === "ok" || result.status === "accepted_by_you" || result.status === "already_member") {
    await sharing.upsertProfile(getDb(), { id: user.id, name: user.displayName, email: user.email ? normalizeEmail(user.email) : null });
  }
  return result;
}

/* ------------------------------ notifications ------------------------------ */

export type { NotificationFilter, NotificationItem, NotificationPage };

/** The verified user, or AuthRequiredError (route handlers and actions answer 401 / "sign in again" rather than redirect). */
async function requireSessionUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

const viewerOf = (user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>): notif.Viewer => ({
  id: user.id,
  verifiedEmail: user.emailVerified && user.email ? normalizeEmail(user.email) : null,
});

/** Remember (at most every 10 minutes per server process) who this account is, so invitations to their email can find them. */
const profileSeen = new Map<string, number>();
async function rememberProfile(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const last = profileSeen.get(user.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  profileSeen.set(user.id, Date.now());
  if (profileSeen.size > 5000) profileSeen.clear();
  await sharing.upsertProfile(getDb(), { id: user.id, name: user.displayName, email: user.email ? normalizeEmail(user.email) : null });
}

/**
 * After a verified sign-in the inbox quietly picks up open invitations
 * addressed to the person's verified email (they had no account when it was
 * sent). Creates notifications only; it never accepts anything.
 */
async function reconcile(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  try {
    if (user.emailVerified) await rememberProfile(user);
    await notif.reconcileInvitationNotifications(getDb(), viewerOf(user));
  } catch (error) {
    console.error("[rove] invitation reconcile failed:", (error as Error)?.name);
  }
}

/** The bell: unread items the person can still open, plus a marker that changes when anything new arrives. */
export async function getNotificationSummaryForUser() {
  const user = await requireSessionUser();
  await reconcile(user);
  return notif.countUnread(getDb(), viewerOf(user));
}

export async function listNotificationsForUser(opts: { filter?: NotificationFilter; cursor?: string | null; limit?: number } = {}) {
  const user = await requireSessionUser();
  await reconcile(user);
  const page = await notif.listNotifications(getDb(), viewerOf(user), opts);
  return { ...page, items: await withReminderActions(user.id, page.items) };
}

/** Reminder items get what the person may do NOW (re-derived from live data), so an old item never offers a stale action. */
async function withReminderActions(userId: string, items: NotificationItem[]): Promise<NotificationItem[]> {
  const mine = items.filter((i) => i.available && i.reminder);
  if (mine.length === 0) return items;
  const db = getDb();
  const roles = new Map<string, "owner" | "editor" | "viewer" | null>();
  const role = async (tripId: string) => {
    if (!roles.has(tripId)) roles.set(tripId, (await sharing.resolveTripAccess(db, userId, tripId))?.role ?? null);
    return roles.get(tripId)!;
  };
  const live = await reminderDb.inboxActions(db, userId, mine.map((i) => ({ reminderId: i.reminder!.reminderId, occurrence: i.reminder!.occurrence })), role);
  return items.map((i) => {
    if (!i.reminder) return i;
    const l = live.get(i.reminder.reminderId);
    return { ...i, reminder: { ...i.reminder, live: l ? { canComplete: l.canComplete, taskDone: l.taskDone, canSnooze: l.canSnooze, snoozeOptions: l.snoozeOptions, directionsUrl: l.directionsUrl, zoneName: l.zoneName, zone: l.zone, limitAtMs: l.limitAtMs, superseded: l.superseded } : null } };
  });
}

/** Opening an item: marks just that one read and returns it with its (re-checked) destination. null = not theirs. */
export async function openNotificationForUser(notificationId: string) {
  const user = await requireSessionUser();
  const viewer = viewerOf(user);
  const db = getDb();
  const item = await notif.getNotification(db, viewer, notificationId);
  if (!item) return null;
  await notif.markRead(db, viewer, notificationId);
  const [withActions] = await withReminderActions(user.id, [item]);
  return { ...withActions, read_at: item.read_at ?? new Date().toISOString() };
}

export async function markNotificationReadForUser(notificationId: string) {
  const user = await requireSessionUser();
  return notif.markRead(getDb(), viewerOf(user), notificationId);
}

export async function markAllNotificationsReadForUser(upTo?: string | null) {
  const user = await requireSessionUser();
  return notif.markAllRead(getDb(), viewerOf(user), upTo);
}


/* ------------------------------- polls ------------------------------- */

export type { PollInput, PollWriteReason } from "@/db/polls";
export type { PollView } from "@/lib/polls";

/** Every poll of the trip with totals, who voted (current members) and what the caller may do; null = no access. */
export const getPollsForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => pollDb.listPolls(db, ctx, tripId));
});

/** Owners and editors ask the group. */
export async function createPollForUser(tripId: string, input: pollDb.PollInput) {
  const user = await requireUser();
  if (input.replaces_poll_id !== null && !isId(input.replaces_poll_id)) return editTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return editTrip(tripId, NOT_FOUND, (db, ctx) => pollDb.createPoll(db, ctx, tripId, input, user.displayName));
}

export async function updatePollForUser(tripId: string, pollId: string, input: pollDb.PollInput) {
  const user = await requireUser();
  if (!isId(pollId)) return participateTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return participateTrip(tripId, NOT_FOUND, (db, ctx) => pollDb.updatePoll(db, ctx, tripId, pollId, input, user.displayName));
}

/** Any current member who was asked — viewers too. Nothing else on the trip changes. */
export async function castVoteForUser(tripId: string, pollId: string, response: pollDb.VoteResponse) {
  if (!isId(pollId) || ("option_id" in response && !isId(response.option_id))) return participateTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return participateTrip(tripId, NOT_FOUND, (db, ctx) => pollDb.castVote(db, ctx, tripId, pollId, response));
}

export async function closePollForUser(tripId: string, pollId: string) {
  if (!isId(pollId)) return participateTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return participateTrip(tripId, NOT_FOUND, (db, ctx) => pollDb.closePoll(db, ctx, tripId, pollId));
}

export async function cancelPollForUser(tripId: string, pollId: string) {
  if (!isId(pollId)) return participateTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return participateTrip(tripId, NOT_FOUND, (db, ctx) => pollDb.cancelPoll(db, ctx, tripId, pollId));
}

/** The organizer's explicit decision. Adds nothing to the itinerary. */
export async function chooseResultForUser(tripId: string, pollId: string, optionId: string) {
  const user = await requireUser();
  if (!isId(pollId) || !isId(optionId)) return participateTrip(tripId, NOT_FOUND, async () => NOT_FOUND);
  return participateTrip(tripId, NOT_FOUND, (db, ctx) => pollDb.chooseResult(db, ctx, tripId, pollId, optionId, user.displayName));
}

/* ------------------------- evening preview ------------------------- */

export type { RunReport as EveningRunReport } from "@/db/evening-preview";

/**
 * The caller's own evening-preview settings for a trip, what the preview
 * would look like (a sample from the saved plan — nothing is sent), whether
 * email can work for them, and whether the scheduled job has really run.
 */
export const getEveningPreviewSettingsForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, async (db, ctx) => {
    const trip = await q.getTripWithDetails(db, ctx.ownerId, tripId);
    if (!trip) return null;
    const now = new Date();
    const target = sampleTarget(now, trip.time_zone, trip.start_date, trip.end_date);
    const [prefs, address, scheduler, sample] = await Promise.all([
      eveningDb.getPrefs(db, tripId, ctx.userId),
      eveningDb.profileEmail(db, ctx.userId),
      eveningDb.schedulerStatus(db, now),
      target ? eveningDb.buildPreview(db, tripId, ctx.userId, target.date, now) : Promise.resolve(null),
    ]);
    return {
      prefs,
      timeZone: trip.time_zone,
      sample: sample ? { ...sample, isTomorrow: target!.isTomorrow, action: actionLabel(sample) } : null,
      email: { providerConfigured: getEmailConfig() !== null, hasAddress: Boolean(address) },
      scheduler,
    };
  });
});

/** Any member sets their own preference — private to them, and it changes nothing else on the trip. */
export async function saveEveningPrefsForUser(tripId: string, input: eveningDb.PrefsInput) {
  return withTripWrite(tripId, "read", false, (db, ctx) => eveningDb.savePrefs(db, ctx.ownerId, tripId, ctx.userId, input));
}

/**
 * The scheduled job's entry point. It has NO user session by design — it is
 * reached only from the cron route, which authenticates the caller with a
 * server secret — and acts for each opted-in person after re-checking their
 * membership and preferences. `dryRun` composes but writes and sends nothing.
 */
export async function runEveningPreviewJob(opts: { dryRun?: boolean; now?: Date; only?: { tripId?: string; userId?: string } } = {}) {
  return eveningDb.runEveningPreviews(getDb(), { ...opts, email: opts.dryRun ? null : createPreviewSender(), });
}


/* ------------------------------ reminders ------------------------------ */

export type { ReminderPanel, OverviewRow, ReminderPrefs } from "@/db/reminders";

/** Everyone on the trip, by name only — for the task assignee picker. Any member may read it. null = no access. */
export const getTripPeopleForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => reminderDb.tripPeopleChoices(db, tripId, ctx.userId));
});
export type { RunReport as ReminderRunReport } from "@/db/reminders";

/**
 * Everything the reminder control needs for one booking or task: the record's
 * time and zone, who may receive a reminder, what is set up and where each one
 * stands. Any member may read it (names only, no emails). null = no access.
 */
export async function getReminderPanelForUser(tripId: string, type: ReminderSubject, id: string) {
  if (!isId(id)) return null;
  return readTrip(tripId, null, (db, ctx) => reminderDb.getPanel(db, ctx.userId, ctx.ownerId, tripId, type, id, getEmailConfig() !== null));
}

/** Owners and editors only (the same permission as editing the record): what a setup would do, writing nothing. */
export async function previewRemindersForUser(tripId: string, type: ReminderSubject, id: string, input: { preset: PresetChoice; rule: Omit<RuleInput, "preset">; recipientIds: string[] }) {
  if (!isId(id) || input.recipientIds.some((r) => r.length > 255)) return null;
  return editTrip(tripId, null, (db, ctx) => reminderDb.previewReminders(db, ctx, tripId, type, id, input));
}

/** Owners and editors: set up, change or turn off the reminder(s) of one booking or task. Nothing is created unless this is called. */
export async function setRemindersForUser(tripId: string, type: ReminderSubject, id: string, input: reminderDb.SetupInput) {
  const notFound = { ok: false, reason: "not_found" } as reminderDb.SetupResult;
  if (!isId(id)) return editTrip(tripId, notFound, async () => notFound);
  return editTrip(tripId, notFound, (db, ctx) => reminderDb.setReminders(db, ctx, tripId, type, id, input));
}

/** The review list: reminder-eligible bookings and tasks and whether anything is set up. Read-only. */
export const getReminderOverviewForUser = cache(async (tripId: string) => {
  return readTrip(tripId, null, (db, ctx) => reminderDb.getOverview(db, ctx.ownerId, tripId));
});

/**
 * The recipient's own actions. Any current member may act on THEIR OWN
 * reminder (a viewer can snooze the reminder addressed to them, which changes
 * nothing about the trip); someone else's reminder id is "not found".
 */
export async function snoozeReminderForUser(tripId: string, reminderId: string, atMs: number) {
  const notFound = { ok: false, reason: "not_found" } as reminderDb.OwnReminderResult;
  if (!isId(reminderId)) return notFound;
  return withTripWrite(tripId, "read", notFound, (db, ctx) => reminderDb.snoozeReminder(db, ctx.userId, reminderId, atMs));
}

export async function muteReminderForUser(tripId: string, reminderId: string) {
  const notFound = { ok: false, reason: "not_found" } as reminderDb.OwnReminderResult;
  if (!isId(reminderId)) return notFound;
  return withTripWrite(tripId, "read", notFound, (db, ctx) => reminderDb.muteReminder(db, ctx.userId, reminderId));
}

export async function allowQuietReminderForUser(tripId: string, reminderId: string) {
  const notFound = { ok: false, reason: "not_found" } as reminderDb.OwnReminderResult;
  if (!isId(reminderId)) return notFound;
  return withTripWrite(tripId, "read", notFound, (db, ctx) => reminderDb.allowQuietReminder(db, ctx.userId, reminderId));
}

/** The caller's own delivery settings (all trips) and whether email can work for them. */
export const getReminderPrefsForUser = cache(async () => {
  const user = await requireUser();
  const db = getDb();
  const [prefs, address, scheduler] = await Promise.all([reminderDb.getPrefs(db, user.id), reminderDb.profileEmail(db, user.id), reminderDb.schedulerStatus(db)]);
  return { prefs, email: { providerConfigured: getEmailConfig() !== null, hasAddress: Boolean(address) }, scheduler };
});

export async function saveReminderPrefsForUser(input: reminderDb.ReminderPrefs) {
  const userId = await requireUserId();
  return reminderDb.savePrefs(getDb(), userId, input);
}

/**
 * The scheduled job's entry point. It has NO user session by design — it is
 * reached only from the cron route, which authenticates the caller with a
 * server secret — and acts for each recipient after re-checking the record,
 * their membership and their preferences. `dryRun` writes and sends nothing.
 */
export async function runReminderJob(opts: { dryRun?: boolean; now?: Date } = {}) {
  return reminderDb.runReminders(getDb(), { ...opts, email: opts.dryRun ? null : createReminderSender() });
}


/* ------------------------------- settings ------------------------------- */

export type SettingsView = {
  snapshot: SettingsSnapshot;
  /** Backgrounds whose pictures exist on this server (Plain Ivory is always there). */
  available: BackgroundId[];
  /** Read-only: the trips where this person turned evening previews on, with their trip-specific send time. */
  eveningPreviews: EveningPreviewSchedule[];
};

/** The signed-in user's own settings. Never takes a user id: it is always the verified session user. */
export const getSettingsForUser = cache(async (): Promise<SettingsView> => {
  const user = await requireUser();
  const available = await availableBackgrounds();
  const db = getDb();
  const [snapshot, eveningPreviews] = await Promise.all([settingsDb.readSettings(db, user.id, available), settingsDb.eveningPreviewSchedules(db, user.id)]);
  return { snapshot, available, eveningPreviews };
});

/** Display preferences for server-rendered text (times). Falls back to the defaults: formatting never takes a page down. */
export const getDisplayPrefsForUser = cache(async () => {
  await requireUser();
  try {
    return (await getSettingsForUser()).snapshot.display;
  } catch (error) {
    unstable_rethrow(error);
    return defaultDisplayPreferences();
  }
});

/** Merge `patch` (already validated) into one section of the caller's own settings; returns what was stored. */
export async function saveSettingsSectionForUser(section: SettingsSection, patch: Record<string, unknown>) {
  const userId = await requireUserId();
  await settingsDb.saveSection(getDb(), userId, section, patch, reminderDb.syncRecipient);
  return settingsDb.readSettings(getDb(), userId, await availableBackgrounds());
}

export type AppearanceSaveResult =
  | { ok: true; appearance: SettingsSnapshot["appearance"]; version: number }
  | { ok: false; conflict: true; appearance: SettingsSnapshot["appearance"]; version: number };

/**
 * Save appearance fields for the caller (verified session user, never a parameter),
 * based on `expectedVersion`. A newer save from another device returns the stored
 * appearance as a conflict instead of overwriting it.
 */
export async function saveAppearanceForUser(patch: Record<string, unknown>, expectedVersion: number): Promise<AppearanceSaveResult> {
  const userId = await requireUserId();
  const db = getDb();
  const available = await availableBackgrounds();
  const result = await settingsDb.saveAppearance(db, userId, patch, expectedVersion, available);
  if (result.ok) return result;
  return { ok: false, conflict: true, ...(await settingsDb.readAppearance(db, userId, available)) };
}

/** The caller's saved appearance and its version (focus refresh). */
export async function getAppearanceForUser() {
  const userId = await requireUserId();
  return settingsDb.readAppearance(getDb(), userId, await availableBackgrounds());
}

/** Set or clear (null) the caller's Atlas-only display name; returns the stored override. */
export async function saveDisplayNameForUser(name: string | null) {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return settingsDb.saveDisplayName(getDb(), user.id, name, user.displayName);
}
