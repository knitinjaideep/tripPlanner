"use server";

import { revalidatePath } from "next/cache";
import { createDocumentForUser, deleteDocumentForUser, updateDocumentForUser } from "@/lib/dal";
import { documentSchema, formFields } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

const DOCUMENT_FIELDS = ["reservation_id", "label", "url"] as const;

/** Create (no documentId) or update a document link on a trip. */
export async function saveDocument(
  tripId: string,
  documentId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = documentSchema.safeParse(formFields(formData, DOCUMENT_FIELDS));
  if (!parsed.success) return invalid(parsed.error);

  const result = await guarded(documentId ? "updateDocument" : "createDocument", async () => {
    const outcome = documentId
      ? await updateDocumentForUser(tripId, documentId, parsed.data)
      : await createDocumentForUser(tripId, parsed.data);
    if (outcome.ok) return { ok: true, message: documentId ? "Link updated." : "Link saved." };
    if (outcome.reason === "reservation_not_in_trip") {
      return {
        ok: false,
        message: "Please check the highlighted fields.",
        fieldErrors: { reservation_id: ["Choose a booking from this trip."] },
      };
    }
    return notFound(documentId ? "Document" : "Trip");
  });

  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}

export async function deleteDocument(tripId: string, documentId: string): Promise<ActionState> {
  const result = await guarded("deleteDocument", async () =>
    (await deleteDocumentForUser(tripId, documentId)) ? { ok: true, message: "Link removed." } : notFound("Document"),
  );
  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}
