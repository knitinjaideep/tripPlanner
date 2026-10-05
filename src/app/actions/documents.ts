"use server";

import { revalidatePath } from "next/cache";
import { documentSchema, formFields, idSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { authedClient, failed, invalid, SIGNED_OUT } from "./shared";

const DOCUMENT_FIELDS = ["trip_id", "booking_id", "label", "url"] as const;

/** Create (no documentId) or update a document link. */
export async function saveDocument(
  documentId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = documentSchema.safeParse(formFields(formData, DOCUMENT_FIELDS));
  if (!parsed.success) return invalid(parsed.error);
  if (documentId && !idSchema.safeParse(documentId).success) {
    return { ok: false, message: "Document not found." };
  }

  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { trip_id: tripId, ...fields } = parsed.data;

  if (documentId) {
    const { data, error } = await supabase
      .from("document_links")
      .update(fields)
      .eq("id", documentId)
      .eq("trip_id", tripId)
      .select("id")
      .maybeSingle();
    if (error) return failed("updateDocument", error);
    if (!data) return { ok: false, message: "Document not found." };
  } else {
    const { error } = await supabase.from("document_links").insert({ trip_id: tripId, ...fields });
    if (error) return failed("createDocument", error);
  }

  revalidatePath(`/trips/${tripId}`, "layout");
  return { ok: true, message: documentId ? "Link updated." : "Link saved." };
}

export async function deleteDocument(tripId: string, documentId: string): Promise<ActionState> {
  if (!idSchema.safeParse(tripId).success || !idSchema.safeParse(documentId).success) {
    return { ok: false, message: "Document not found." };
  }
  const supabase = await authedClient();
  if (!supabase) return SIGNED_OUT;

  const { error } = await supabase
    .from("document_links")
    .delete()
    .eq("id", documentId)
    .eq("trip_id", tripId);
  if (error) return failed("deleteDocument", error);

  revalidatePath(`/trips/${tripId}`, "layout");
  return { ok: true, message: "Link removed." };
}
