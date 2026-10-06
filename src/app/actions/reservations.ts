"use server";

import { revalidatePath } from "next/cache";
import {
  createReservationForUser,
  deleteReservationForUser,
  updateReservationForUser,
} from "@/lib/dal";
import { detailFields, formFields, reservationSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

const RESERVATION_FIELDS = [
  "kind",
  "title",
  "provider",
  "confirmation_code",
  "start_date",
  "start_time",
  "start_time_zone",
  "end_date",
  "end_time",
  "end_time_zone",
  "origin",
  "destination",
  "location",
  "booking_url",
  "notes",
] as const;

/** Create (no reservationId) or update a reservation on a trip. */
export async function saveReservation(
  tripId: string,
  reservationId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = formFields(formData, RESERVATION_FIELDS);
  // Non-transport bookings have one zone for both ends.
  if (!fields.end_time_zone) fields.end_time_zone = fields.start_time_zone;
  const status = formData.get("cancelled") === "on" ? "cancelled" : "confirmed";
  const parsed = reservationSchema.safeParse({ ...fields, status, details: detailFields(formData) });
  if (!parsed.success) return invalid(parsed.error);

  const result = await guarded(reservationId ? "updateReservation" : "createReservation", async () => {
    if (reservationId) {
      const updated = await updateReservationForUser(tripId, reservationId, parsed.data);
      if (updated.ok) return { ok: true, message: "Booking updated." };
      if (updated.reason === "linked_visit_needs_date") {
        return {
          ok: false,
          message: "Please check the highlighted fields.",
          fieldErrors: { start_date: ["This booking is on your itinerary, so it needs a date."] },
        };
      }
      return notFound("Booking");
    }
    const created = await createReservationForUser(tripId, parsed.data);
    return created ? { ok: true, message: "Booking added." } : notFound("Trip");
  });

  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}

export async function deleteReservation(tripId: string, reservationId: string): Promise<ActionState> {
  const result = await guarded("deleteReservation", async () => {
    const deleted = await deleteReservationForUser(tripId, reservationId);
    if (!deleted) return notFound("Booking");
    return {
      ok: true,
      message: deleted.keptVisits
        ? "Booking deleted. Its itinerary entry and your notes were kept."
        : "Booking deleted.",
    };
  });
  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}
