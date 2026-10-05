"use client";

import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { saveDocument } from "@/app/actions/documents";
import type { ActionState, Booking, DocumentLink } from "@/lib/types";
import {
  FieldShell,
  FormMessage,
  SubmitButton,
  TextField,
  controlClass,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { cn } from "@/lib/utils";

type Props = {
  tripId: string;
  doc?: DocumentLink;
  bookingId?: string | null;
  bookings: Booking[];
  onCancel: () => void;
  onSaved: () => void;
};

export function DocumentForm({ tripId, doc, bookingId, bookings, onCancel, onSaved }: Props) {
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveDocument(doc?.id ?? null, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onSaved();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <input type="hidden" name="trip_id" value={tripId} />
      <FormMessage message={state.ok ? undefined : state.message} />
      <TextField
        idPrefix="doc"
        name="label"
        label="Name"
        placeholder="Passports, boarding passes, hotel confirmation…"
        defaultValue={doc?.label}
        error={errors.label}
        required
        maxLength={120}
        autoComplete="off"
      />
      <TextField
        idPrefix="doc"
        name="url"
        label="Link"
        type="url"
        inputMode="url"
        placeholder="https://drive.google.com/…"
        defaultValue={doc?.url}
        error={errors.url}
        required
        hint="Paste a Google Drive share link, or any https:// link."
      />
      <FieldShell id="doc-booking_id" label="Attach to" error={errors.booking_id}>
        <div className="relative">
          <select
            id="doc-booking_id"
            name="booking_id"
            defaultValue={doc?.booking_id ?? bookingId ?? ""}
            className={cn(controlClass, "w-full appearance-none border pr-10")}
          >
            <option value="">Whole trip</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </FieldShell>
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {doc ? "Save link" : "Add link"}
        </SubmitButton>
      </div>
    </form>
  );
}
