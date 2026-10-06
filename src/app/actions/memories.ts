"use server";

import { revalidatePath } from "next/cache";
import {
  createItineraryItemForUser,
  ensureReservationVisitForUser,
  reviewItineraryItemForUser,
  saveTripMemoryForUser,
  deleteTripMemoryForUser,
} from "@/lib/dal";
import {
  captureMomentSchema,
  formFields,
  reflectionSchema,
  requestIdSchema,
  tripAlbumSchema,
  tripSummarySchema,
} from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import type { EntryTarget } from "./itinerary";
import { guarded, invalid, notFound } from "./shared";

const SUMMARY_FIELDS = ["overall_rating", "summary", "favorite_moment", "would_return", "lessons_for_next_time"] as const;

const refresh = (tripId: string) => revalidatePath(`/trips/${tripId}`, "layout");

/** The trip's reflection. The album link is left as it is. */
export async function saveTripSummary(tripId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = tripSummarySchema.safeParse(formFields(formData, SUMMARY_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  const result = await guarded("saveTripSummary", async () =>
    (await saveTripMemoryForUser(tripId, parsed.data)) ? { ok: true, message: "Trip reflection saved." } : notFound("Trip"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

/** Save or replace the photo album link. The reflection is left as it is. */
export async function saveTripAlbum(tripId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = tripAlbumSchema.safeParse(formFields(formData, ["photo_album_url"] as const));
  if (!parsed.success) return invalid(parsed.error);
  if (!parsed.data.photo_album_url) {
    return { ok: false, message: "Please check the highlighted fields.", fieldErrors: { photo_album_url: ["Paste the album’s link."] } };
  }

  const result = await guarded("saveTripAlbum", async () =>
    (await saveTripMemoryForUser(tripId, parsed.data)) ? { ok: true, message: "Photo album link saved." } : notFound("Trip"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

/** Forget the album link (the album itself is not touched — Atlas never had access to it). */
export async function removeTripAlbum(tripId: string): Promise<ActionState> {
  const result = await guarded("removeTripAlbum", async () =>
    (await saveTripMemoryForUser(tripId, { photo_album_url: null }))
      ? { ok: true, message: "Album link removed." }
      : notFound("Trip"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

/** Clears the trip summary. Per-visit ratings and reflections are not touched. */
export async function deleteTripMemory(tripId: string): Promise<ActionState> {
  const result = await guarded("deleteTripMemory", async () =>
    (await deleteTripMemoryForUser(tripId)) ? { ok: true, message: "Trip summary cleared." } : notFound("Summary"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

/**
 * "Capture a moment" for something already on the itinerary (an activity,
 * a place visit or a booking): mark it done and keep the review on that
 * same row. Blank fields never erase what the visit already holds.
 */
export async function captureExistingMoment(
  tripId: string,
  target: EntryTarget,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reflectionSchema.safeParse(formFields(formData, ["rating", "reflection", "is_favorite"] as const));
  if (!parsed.success) return invalid(parsed.error);
  const { rating, reflection, is_favorite } = parsed.data;

  const result = await guarded("captureExistingMoment", async () => {
    let itemId: string;
    if ("itemId" in target && typeof target.itemId === "string") {
      itemId = target.itemId;
    } else if ("reservationId" in target && typeof target.reservationId === "string") {
      const linked = await ensureReservationVisitForUser(tripId, target.reservationId);
      if (!linked.ok) return notFound("Booking");
      itemId = linked.id;
    } else {
      return { ok: false, message: "Choose something from your itinerary." };
    }
    const saved = await reviewItineraryItemForUser(tripId, itemId, {
      status: "completed",
      ...(rating !== null ? { rating } : {}),
      ...(reflection ? { reflection } : {}),
      ...(is_favorite ? { is_favorite: true } : {}),
    });
    return saved ? { ok: true, message: "Moment captured." } : notFound("Itinerary entry");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/**
 * "Capture a moment" for something that was never planned: a completed
 * standalone activity on the itinerary (so it shows in Itinerary and
 * Memories alike). Idempotent per form via request_id.
 */
export async function captureNewMoment(tripId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = captureMomentSchema.safeParse(
    formFields(formData, ["title", "category", "local_date", "rating", "reflection", "is_favorite"] as const),
  );
  if (!parsed.success) return invalid(parsed.error);
  const requestId = requestIdSchema.safeParse(formData.get("request_id") ?? "");
  const { title, category, local_date, rating, reflection, is_favorite } = parsed.data;

  const result = await guarded("captureNewMoment", async () => {
    const outcome = await createItineraryItemForUser(
      tripId,
      {
        place_id: null,
        reservation_id: null,
        title,
        category,
        local_date,
        local_start_time: null,
        local_end_date: null,
        local_end_time: null,
        timezone: null,
        planning_notes: null,
      },
      {
        completed: { rating, reflection, is_favorite },
        saveToExplore: formData.get("save_to_explore") === "on",
        requestId: requestId.success ? requestId.data : undefined,
      },
    );
    if (outcome.ok) {
      return {
        ok: true,
        message:
          outcome.explorePlace === "existing"
            ? "Moment captured — linked to the place in Explore."
            : outcome.explorePlace === "created"
              ? "Moment captured and saved to Explore."
              : "Moment captured.",
      };
    }
    switch (outcome.reason) {
      case "outside_trip":
        return { ok: false, message: "Please check the highlighted fields.", fieldErrors: { local_date: ["Choose a day of the trip."] } };
      case "in_future":
        return {
          ok: false,
          message: "Please check the highlighted fields.",
          fieldErrors: { local_date: ["That day hasn’t happened yet — add it to the itinerary as a plan instead."] },
        };
      default:
        return notFound("Trip");
    }
  });
  if (result.ok) refresh(tripId);
  return result;
}
