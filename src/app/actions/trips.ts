"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formFields, idSchema, tripSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { authedClient, failed, invalid, SIGNED_OUT } from "./shared";

const TRIP_FIELDS = ["title", "destination", "start_date", "end_date", "travelers", "cover_image", "notes"] as const;

export async function createTrip(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = tripSchema.safeParse(formFields(formData, TRIP_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { data, error } = await supabase.from("trips").insert(parsed.data).select("id").single();
  if (error) return failed("createTrip", error);

  revalidatePath("/trips");
  redirect(`/trips/${data.id}`);
}

export async function updateTrip(
  tripId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!idSchema.safeParse(tripId).success) return { ok: false, message: "Trip not found." };
  const parsed = tripSchema.safeParse(formFields(formData, TRIP_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { data, error } = await supabase
    .from("trips")
    .update(parsed.data)
    .eq("id", tripId)
    .select("id")
    .maybeSingle();
  if (error) return failed("updateTrip", error);
  if (!data) return { ok: false, message: "Trip not found." };

  revalidatePath("/trips");
  revalidatePath(`/trips/${tripId}`, "layout");
  redirect(`/trips/${tripId}`);
}

export async function deleteTrip(tripId: string): Promise<ActionState> {
  if (!idSchema.safeParse(tripId).success) return { ok: false, message: "Trip not found." };
  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { error } = await supabase.from("trips").delete().eq("id", tripId);
  if (error) return failed("deleteTrip", error);

  revalidatePath("/trips");
  redirect("/trips?deleted=1");
}
