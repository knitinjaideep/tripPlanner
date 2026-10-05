"use server";

import { revalidatePath } from "next/cache";
import { bookingSchema, formFields, idSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { authedClient, failed, invalid, SIGNED_OUT } from "./shared";

const BOOKING_FIELDS = [
  "trip_id",
  "kind",
  "title",
  "provider",
  "confirmation_code",
  "start_date",
  "start_time",
  "end_date",
  "end_time",
  "origin",
  "destination",
  "location",
  "booking_url",
  "notes",
] as const;

/** Create (no bookingId) or update a booking. */
export async function saveBooking(
  bookingId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = bookingSchema.safeParse(formFields(formData, BOOKING_FIELDS));
  if (!parsed.success) return invalid(parsed.error);
  if (bookingId && !idSchema.safeParse(bookingId).success) {
    return { ok: false, message: "Booking not found." };
  }

  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { trip_id: tripId, ...fields } = parsed.data;

  if (bookingId) {
    const { data, error } = await supabase
      .from("bookings")
      .update(fields)
      .eq("id", bookingId)
      .eq("trip_id", tripId)
      .select("id")
      .maybeSingle();
    if (error) return failed("updateBooking", error);
    if (!data) return { ok: false, message: "Booking not found." };
  } else {
    // The composite FK rejects a trip_id the user does not own.
    const { error } = await supabase.from("bookings").insert({ trip_id: tripId, ...fields });
    if (error) return failed("createBooking", error);
  }

  revalidatePath(`/trips/${tripId}`, "layout");
  return { ok: true, message: bookingId ? "Booking updated." : "Booking added." };
}

export async function deleteBooking(tripId: string, bookingId: string): Promise<ActionState> {
  if (!idSchema.safeParse(tripId).success || !idSchema.safeParse(bookingId).success) {
    return { ok: false, message: "Booking not found." };
  }
  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { error } = await supabase.from("bookings").delete().eq("id", bookingId).eq("trip_id", tripId);
  if (error) return failed("deleteBooking", error);

  revalidatePath(`/trips/${tripId}`, "layout");
  return { ok: true, message: "Booking deleted." };
}
