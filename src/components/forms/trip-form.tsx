"use client";

import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import { COVERS, DEFAULT_COVER } from "@/lib/covers";
import type { ActionState, Trip } from "@/lib/types";
import {
  FormMessage,
  SubmitButton,
  TextAreaField,
  TextField,
  TimeZoneField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";

type Props = {
  trip?: Trip;
  /** Pre-selected zone for a new trip (the viewer's own). */
  defaultTimeZone: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  cancelHref: string;
};

export function TripForm({ trip, defaultTimeZone, action, cancelHref }: Props) {
  const { state, onSubmit, pending } = useFormAction(action);
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />

      <fieldset className="space-y-5">
        <legend className="font-display mb-4 text-xl font-semibold text-ink">The basics</legend>
        <TextField
          name="title"
          label="Trip name"
          placeholder="Aruba, here we come"
          defaultValue={trip?.title}
          error={errors.title}
          required
          maxLength={120}
          autoComplete="off"
        />
        <TextField
          name="destination"
          label="Destination"
          placeholder="Aruba"
          defaultValue={trip?.destination}
          error={errors.destination}
          required
          maxLength={120}
          autoComplete="off"
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="start_date"
            label="Start date"
            type="date"
            defaultValue={trip?.start_date}
            error={errors.start_date}
            required
          />
          <TextField
            name="end_date"
            label="End date"
            type="date"
            defaultValue={trip?.end_date}
            error={errors.end_date}
            required
          />
        </div>
        <TimeZoneField
          name="time_zone"
          label="Destination time zone"
          defaultValue={trip?.time_zone ?? defaultTimeZone}
          error={errors.time_zone}
          hint="New bookings start in this zone; each booking can have its own."
        />
        <TextField
          name="travelers"
          label="Who’s going"
          placeholder="Nitin, Pavani, Arjun"
          defaultValue={trip?.travelers.join(", ")}
          error={errors.travelers}
          hint="Separate names with commas."
          optional
          maxLength={800}
          autoComplete="off"
        />
      </fieldset>

      <fieldset>
        <legend className="font-display text-xl font-semibold text-ink">Cover photo</legend>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Pick the scenery that feels most like this trip. These are illustrative photos.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COVERS.map((cover) => (
            <label key={cover.key} className="group relative block cursor-pointer">
              <input
                type="radio"
                name="cover_image"
                value={cover.key}
                defaultChecked={(trip?.cover_image ?? DEFAULT_COVER) === cover.key}
                className="peer sr-only"
              />
              <span className="relative block aspect-[4/3] overflow-hidden rounded-xl ring-1 ring-border transition peer-checked:ring-3 peer-checked:ring-moss peer-focus-visible:ring-3 peer-focus-visible:ring-moss/50">
                <Image src={cover.image} alt="" fill sizes="(min-width: 640px) 160px, 45vw" className="object-cover" />
              </span>
              <span className="absolute top-2 right-2 hidden size-6 place-items-center rounded-full bg-moss text-white peer-checked:grid">
                <Check className="size-3.5" aria-hidden="true" />
              </span>
              <span className="mt-1.5 block text-sm font-medium text-ink">{cover.label}</span>
            </label>
          ))}
        </div>
        {errors.cover_image ? <p className="mt-2 text-sm text-destructive">{errors.cover_image[0]}</p> : null}
      </fieldset>

      <fieldset>
        <legend className="sr-only">Notes</legend>
        <TextAreaField
          name="notes"
          label="Notes"
          placeholder="Anything worth remembering — a slower pace, nap times, a birthday dinner…"
          defaultValue={trip?.notes ?? ""}
          error={errors.notes}
          optional
          maxLength={5000}
        />
      </fieldset>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className={secondaryButtonClass}>
          Cancel
        </Link>
        <SubmitButton pending={pending} pendingLabel={trip ? "Saving…" : "Creating…"}>
          {trip ? "Save changes" : "Create trip"}
        </SubmitButton>
      </div>
    </form>
  );
}
