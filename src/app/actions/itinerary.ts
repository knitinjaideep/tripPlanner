"use server";

import { revalidatePath } from "next/cache";
import {
  createItineraryItemForUser,
  deleteItineraryItemForUser,
  duplicateItineraryItemForUser,
  ensureReservationVisitForUser,
  moveItineraryItemForUser,
  reorderItineraryForUser,
  reviewItineraryItemForUser,
  updateItineraryItemForUser,
  type ItineraryWriteResult,
} from "@/lib/dal";
import {
  formFields,
  idSchema,
  itineraryDateSchema,
  itineraryItemSchema,
  itineraryOrderSchema,
  itineraryStatusSchema,
  reflectionSchema,
  requestIdSchema,
  visitReviewSchema,
} from "@/lib/validation";
import { ITINERARY_CATEGORIES, type ItineraryCategory, type ItineraryStatus } from "@/lib/plan-options";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

const ITEM_FIELDS = [
  "place_id",
  "reservation_id",
  "title",
  "category",
  "local_date",
  "local_start_time",
  "local_end_date",
  "local_end_time",
  "timezone",
  "planning_notes",
  "is_optional",
  "is_protected_rest",
] as const;

const REVIEW_FIELDS = ["status", "rating", "reflection", "is_favorite"] as const;

/** Entries are addressed by their row, or — before it has one — by their booking. */
export type EntryTarget = { itemId: string } | { reservationId: string };

type ItemResult = ActionState & { itemId?: string };

const fieldError = (field: string, message: string): ActionState => ({
  ok: false,
  message: "Please check the highlighted fields.",
  fieldErrors: { [field]: [message] },
});

function visitWriteState(outcome: ItineraryWriteResult, isUpdate: boolean): ActionState {
  if (outcome.ok) {
    const saved = isUpdate ? "Itinerary updated." : "Added to the itinerary.";
    if (outcome.explorePlace === "created") return { ok: true, message: `${saved} Also saved to Explore.` };
    if (outcome.explorePlace === "existing") return { ok: true, message: `${saved} Linked to the place already in Explore.` };
    return { ok: true, message: saved };
  }
  switch (outcome.reason) {
    case "place_not_in_trip":
      return fieldError("place_id", "Choose a place from this trip.");
    case "place_already_scheduled":
      return { ok: false, message: "That place is already on your itinerary." };
    case "reservation_not_in_trip":
      return fieldError("reservation_id", "Choose a booking from this trip.");
    case "reservation_unscheduled":
      return fieldError("reservation_id", "Give this booking a date first.");
    case "reservation_already_linked":
      return fieldError("reservation_id", "This booking is already on the itinerary.");
    case "reservation_backed":
      return { ok: false, message: "Bookings follow their own dates — edit the booking instead." };
    case "outside_trip":
      return { ok: false, message: "Choose a day within the trip." };
    case "in_future":
      return { ok: false, message: "That day hasn’t happened yet." };
    default:
      return notFound(isUpdate ? "Itinerary entry" : "Trip");
  }
}

const refresh = (tripId: string) => revalidatePath(`/trips/${tripId}`, "layout");

/** Resolve a target to an itinerary row, creating a booking's link row if needed. */
async function resolveTarget(
  tripId: string,
  target: EntryTarget,
): Promise<{ ok: true; itemId: string } | { ok: false; state: ActionState }> {
  if ("itemId" in target) return { ok: true, itemId: target.itemId };
  const outcome = await ensureReservationVisitForUser(tripId, target.reservationId);
  return outcome.ok ? { ok: true, itemId: outcome.id } : { ok: false, state: visitWriteState(outcome, false) };
}

/** Create (no itemId) or update a visit / activity's planning fields. */
export async function saveItineraryItem(
  tripId: string,
  itemId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = itineraryItemSchema.safeParse(formFields(formData, ITEM_FIELDS));
  if (!parsed.success) return invalid(parsed.error);
  const saveToExplore = formData.get("save_to_explore") === "on";
  const requestId = requestIdSchema.safeParse(formData.get("request_id") ?? "");

  const result = await guarded(itemId ? "updateItineraryItem" : "createItineraryItem", async () =>
    visitWriteState(
      itemId
        ? await updateItineraryItemForUser(tripId, itemId, parsed.data, { saveToExplore })
        : await createItineraryItemForUser(tripId, parsed.data, {
            saveToExplore,
            requestId: requestId.success ? requestId.data : undefined,
          }),
      Boolean(itemId),
    ),
  );

  if (result.ok) refresh(tripId);
  return result;
}

/** Mark a visit planned / completed / skipped, with rating and reflection. */
export async function reviewItineraryItem(
  tripId: string,
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = visitReviewSchema.safeParse(formFields(formData, REVIEW_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  const result = await guarded("reviewItineraryItem", async () =>
    (await reviewItineraryItemForUser(tripId, itemId, parsed.data))
      ? { ok: true, message: parsed.data.status === "completed" ? "Marked as done." : "Saved." }
      : notFound("Itinerary entry"),
  );

  if (result.ok) refresh(tripId);
  return result;
}

/** Rating, reflection and favorite only — the status is left as it is. */
export async function saveReflection(
  tripId: string,
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reflectionSchema.safeParse(formFields(formData, ["rating", "reflection", "is_favorite"] as const));
  if (!parsed.success) return invalid(parsed.error);

  const result = await guarded("saveReflection", async () =>
    (await reviewItineraryItemForUser(tripId, itemId, parsed.data))
      ? { ok: true, message: "Reflection saved." }
      : notFound("Itinerary entry"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

const STATUS_MESSAGE: Record<ItineraryStatus, string> = {
  completed: "Marked as done.",
  skipped: "Marked as skipped.",
  planned: "Back to planned.",
};

/** Change only the status; written reflections and ratings are kept. */
export async function setItineraryStatus(tripId: string, target: EntryTarget, status: ItineraryStatus): Promise<ItemResult> {
  if (!itineraryStatusSchema.safeParse(status).success) return { ok: false, message: "Choose a status." };
  let itemId: string | undefined;
  const result = await guarded("setItineraryStatus", async () => {
    const resolved = await resolveTarget(tripId, target);
    if (!resolved.ok) return resolved.state;
    itemId = resolved.itemId;
    return (await reviewItineraryItemForUser(tripId, resolved.itemId, { status }))
      ? { ok: true, message: STATUS_MESSAGE[status] }
      : notFound("Itinerary entry");
  });
  if (result.ok) refresh(tripId);
  return result.ok && itemId ? { ...result, itemId } : result;
}

export async function setItineraryFavorite(tripId: string, target: EntryTarget, favorite: boolean): Promise<ItemResult> {
  const result = await guarded("setItineraryFavorite", async () => {
    const resolved = await resolveTarget(tripId, target);
    if (!resolved.ok) return resolved.state;
    return (await reviewItineraryItemForUser(tripId, resolved.itemId, { is_favorite: favorite === true }))
      ? { ok: true, message: favorite ? "Added to favorites." : "Removed from favorites." }
      : notFound("Itinerary entry");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** Put a dated booking on the itinerary so it can be completed and reviewed. */
export async function addReservationToItinerary(
  tripId: string,
  reservationId: string,
): Promise<ItemResult> {
  let itemId: string | undefined;
  const result = await guarded("ensureReservationVisit", async () => {
    const outcome = await ensureReservationVisitForUser(tripId, reservationId);
    if (outcome.ok) itemId = outcome.id;
    return visitWriteState(outcome, false);
  });
  if (result.ok) refresh(tripId);
  return itemId ? { ...result, itemId } : result;
}

/** Move an activity or place visit to another trip day (bookings follow their booking). */
export async function moveItineraryItem(tripId: string, itemId: string, date: string): Promise<ActionState> {
  if (!itineraryDateSchema.safeParse(date).success) return { ok: false, message: "Choose a day." };
  const result = await guarded("moveItineraryItem", async () => {
    const outcome = await moveItineraryItemForUser(tripId, itemId, date);
    return outcome.ok ? { ok: true, message: "Moved." } : visitWriteState(outcome, true);
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** Copy an activity's plan as a new planned entry (no completion, rating or reflection). */
export async function duplicateItineraryItem(tripId: string, itemId: string): Promise<ActionState> {
  const result = await guarded("duplicateItineraryItem", async () => {
    const outcome = await duplicateItineraryItemForUser(tripId, itemId);
    return outcome.ok ? { ok: true, message: "Duplicated — the copy starts as planned." } : visitWriteState(outcome, true);
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** Save the order of a day's flexible entries. */
export async function reorderFlexibleEntries(tripId: string, keys: string[]): Promise<ActionState> {
  const parsed = itineraryOrderSchema.safeParse(keys);
  if (!parsed.success) return { ok: false, message: "Couldn’t read that order. Please refresh and try again." };
  const result = await guarded("reorderItinerary", async () => {
    const outcome = await reorderItineraryForUser(tripId, parsed.data);
    return outcome.ok ? { ok: true, message: "Order saved." } : notFound("Itinerary entry");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/**
 * Schedule an Explore place on a day. Without `again`, a place that already
 * has a visit is refused — so repeated clicks never stack duplicate visits.
 * Scheduling it again is a separate, deliberate choice.
 */
export async function schedulePlace(
  tripId: string,
  placeId: string,
  date: string,
  category: ItineraryCategory,
  again: boolean,
): Promise<ActionState> {
  if (!idSchema.safeParse(placeId).success) return notFound("Place");
  if (!itineraryDateSchema.safeParse(date).success) return { ok: false, message: "Choose a day." };
  if (!ITINERARY_CATEGORIES.includes(category)) return { ok: false, message: "Choose a category." };
  const result = await guarded("schedulePlace", async () =>
    visitWriteState(
      await createItineraryItemForUser(
        tripId,
        {
          place_id: placeId,
          reservation_id: null,
          title: null,
          category,
          local_date: date,
          local_start_time: null,
          local_end_date: null,
          local_end_time: null,
          timezone: null,
          planning_notes: null,
        },
        { unlessPlaceScheduled: again !== true },
      ),
      false,
    ),
  );
  if (result.ok) refresh(tripId);
  return result;
}

/** Removes the visit only; its place and booking stay. */
export async function deleteItineraryItem(tripId: string, itemId: string): Promise<ActionState> {
  const result = await guarded("deleteItineraryItem", async () =>
    (await deleteItineraryItemForUser(tripId, itemId))
      ? { ok: true, message: "Removed from the itinerary." }
      : notFound("Itinerary entry"),
  );
  if (result.ok) refresh(tripId);
  return result;
}
