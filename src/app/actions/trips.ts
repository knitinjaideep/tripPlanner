"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTripForUser, deleteTripForUser, updateTripForUser } from "@/lib/dal";
import { formFields, tripSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

const TRIP_FIELDS = [
  "title",
  "destination",
  "start_date",
  "end_date",
  "time_zone",
  "travelers",
  "cover_image",
  "notes",
] as const;

export async function createTrip(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = tripSchema.safeParse(formFields(formData, TRIP_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  let tripId = "";
  const result = await guarded("createTrip", async () => {
    tripId = (await createTripForUser(parsed.data)).id;
    return { ok: true };
  });
  if (!result.ok) return result;

  revalidatePath("/trips");
  redirect(`/trips/${tripId}`);
}

export async function updateTrip(tripId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = tripSchema.safeParse(formFields(formData, TRIP_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  const result = await guarded("updateTrip", async () =>
    (await updateTripForUser(tripId, parsed.data)) ? { ok: true } : notFound("Trip"),
  );
  if (!result.ok) return result;

  revalidatePath("/trips");
  revalidatePath(`/trips/${tripId}`, "layout");
  redirect(`/trips/${tripId}`);
}

export async function deleteTrip(tripId: string): Promise<ActionState> {
  const result = await guarded("deleteTrip", async () =>
    (await deleteTripForUser(tripId)) ? { ok: true } : notFound("Trip"),
  );
  if (!result.ok) return result;

  revalidatePath("/trips");
  redirect("/trips?deleted=1");
}
