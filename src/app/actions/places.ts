"use server";

import { revalidatePath } from "next/cache";
import { createPlaceForUser, deletePlaceForUser, recordPlaceVisitForUser, updatePlaceForUser } from "@/lib/dal";
import {
  deletePlaceSchema,
  formFields,
  placeSchema,
  recordVisitSchema,
  requestIdSchema,
} from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

const PLACE_FIELDS = [
  "name",
  "kind",
  "category",
  "priority",
  "address",
  "maps_url",
  "website_url",
  "planning_notes",
] as const;

/** Create (no placeId) or update an Explore place. */
export async function savePlace(
  tripId: string,
  placeId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { placeId?: string }> {
  const parsed = placeSchema.safeParse(formFields(formData, PLACE_FIELDS));
  if (!parsed.success) return invalid(parsed.error);
  const requestId = requestIdSchema.safeParse(formData.get("request_id") ?? "");

  let id: string | undefined;
  const result = await guarded(placeId ? "updatePlace" : "createPlace", async () => {
    if (placeId) {
      return (await updatePlaceForUser(tripId, placeId, parsed.data))
        ? { ok: true, message: "Place updated." }
        : notFound("Place");
    }
    const created = await createPlaceForUser(tripId, parsed.data, requestId.success ? requestId.data : undefined);
    if (created.ok) id = created.id;
    return created.ok ? { ok: true, message: "Saved to Explore." } : notFound("Trip");
  });

  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return id ? { ...result, placeId: id } : result;
}

export type RecordVisitState = ActionState & {
  /** Planned visits the traveler must choose between (nothing is guessed). */
  plannedVisits?: { id: string; local_date: string | null }[];
};

/**
 * Record a visit to a place: complete a chosen planned visit, or add a
 * completed one. If planned visits exist and no choice was made, the
 * traveler is asked which — the server never picks one silently.
 */
export async function recordPlaceVisit(
  tripId: string,
  placeId: string,
  _prev: RecordVisitState,
  formData: FormData,
): Promise<RecordVisitState> {
  const parsed = recordVisitSchema.safeParse(
    formFields(formData, ["date", "rating", "reflection", "is_favorite", "visit_choice"] as const),
  );
  if (!parsed.success) return invalid(parsed.error);
  const requestId = requestIdSchema.safeParse(formData.get("request_id") ?? "");
  const { visit_choice, ...input } = parsed.data;
  const choice =
    visit_choice === "" ? { type: "auto" as const } : visit_choice === "new" ? { type: "new" as const } : { type: "complete" as const, itemId: visit_choice };

  let plannedVisits: RecordVisitState["plannedVisits"];
  const result = await guarded("recordPlaceVisit", async () => {
    const outcome = await recordPlaceVisitForUser(tripId, placeId, input, choice, requestId.success ? requestId.data : undefined);
    if (outcome.ok) {
      return { ok: true, message: outcome.completedExisting ? "Planned visit marked as done." : "Visit recorded." };
    }
    switch (outcome.reason) {
      case "has_planned_visits":
        plannedVisits = outcome.visits;
        return { ok: false, message: "You already have this place planned. Was it that visit?" };
      case "visit_not_planned":
        return { ok: false, message: "That planned visit has changed. Please choose again." };
      case "place_not_in_trip":
        return notFound("Place");
      default:
        return notFound("Trip");
    }
  });

  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return plannedVisits ? { ...result, plannedVisits } : result;
}

/**
 * Delete a place. With visits = "block" a place on the itinerary is kept
 * and the caller is told how many visits use it; "detach" keeps those
 * visits (with the place's name) and deletes the place.
 */
export async function deletePlace(
  tripId: string,
  placeId: string,
  visits: "block" | "detach" = "block",
): Promise<ActionState & { visits?: number }> {
  const choice = deletePlaceSchema.safeParse({ visits });
  if (!choice.success) return { ok: false, message: "Choose what to do with its itinerary visits." };

  let linkedVisits: number | undefined;
  const result = await guarded("deletePlace", async () => {
    const outcome = await deletePlaceForUser(tripId, placeId, choice.data.visits);
    if (outcome.ok) {
      return {
        ok: true,
        message: outcome.detachedVisits ? "Place removed. Its itinerary visits were kept." : "Place removed.",
      };
    }
    if (outcome.reason === "has_visits") {
      linkedVisits = outcome.visits;
      return {
        ok: false,
        message: `This place is on your itinerary ${outcome.visits === 1 ? "once" : `${outcome.visits} times`}. Keep those visits and remove the place?`,
      };
    }
    return notFound("Place");
  });

  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return linkedVisits ? { ...result, visits: linkedVisits } : result;
}
