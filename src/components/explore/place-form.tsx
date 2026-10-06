"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { savePlace } from "@/app/actions/places";
import {
  FormMessage,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { similarPlaces } from "@/lib/explore";
import { LABELS, PLACE_CATEGORIES, PLACE_KINDS, PLACE_PRIORITIES, type PlaceKind } from "@/lib/plan-options";
import type { ActionState, Place } from "@/lib/types";
import { cn } from "@/lib/utils";

const p = "place";

const pill =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-white px-4 text-sm font-medium text-ink transition-colors peer-checked:border-moss peer-checked:bg-moss-soft peer-checked:text-moss-ink peer-focus-visible:ring-3 peer-focus-visible:ring-moss/40";

export function PlaceForm({
  tripId,
  place,
  existing,
  onCancel,
  onSaved,
}: {
  tripId: string;
  place?: Place;
  /** This trip's places, for the gentle "similar name" hint. */
  existing: { id: string; name: string }[];
  onCancel: () => void;
  onSaved: (placeId: string | null) => void;
}) {
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? "place");
  const [name, setName] = useState(place?.name ?? "");
  // Becomes the new place's id, so a double submit can't save it twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await savePlace(tripId, place?.id ?? null, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onSaved(place?.id ?? result.placeId ?? null);
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};
  const similar = similarPlaces(name, existing, place?.id);
  const currentCategory = place && place.kind === kind ? place.category : "";

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 sm:px-6">
        <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
        {place ? null : <input type="hidden" name="request_id" value={requestId} />}

        <div>
          <TextField
            idPrefix={p}
            name="name"
            label="Name"
            placeholder={kind === "food" ? "Zeerovers" : "California Lighthouse"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            required
            maxLength={160}
            autoComplete="off"
          />
          {similar.length > 0 ? (
            <p role="status" className="mt-2 flex gap-2 rounded-xl bg-gold-soft/70 px-3 py-2 text-sm text-gold-ink">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                You already have {similar.slice(0, 2).map((s) => `“${s.name}”`).join(" and ")}
                {similar.length > 2 ? ` and ${similar.length - 2} more` : ""}. Saving adds another — that’s fine if it’s a
                different spot.
              </span>
            </p>
          ) : null}
        </div>

        <fieldset>
          <legend className="mb-2.5 text-sm font-semibold text-ink">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {PLACE_KINDS.map((k) => (
              <label key={k} className="cursor-pointer">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="peer sr-only" />
                <span className={pill}>{k === "place" ? "Place" : "Food & drink"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            key={kind}
            idPrefix={p}
            name="category"
            label="Category"
            optional
            defaultValue={currentCategory === "other" ? "" : currentCategory}
            error={errors.category}
            options={[
              { value: "", label: "Not sure" },
              ...PLACE_CATEGORIES[kind].filter((c) => c !== "other").map((c) => ({ value: c, label: LABELS.placeCategory[c] })),
              { value: "other", label: "Something else" },
            ]}
          />
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink">Priority</legend>
            <div className="flex gap-2">
              {[...PLACE_PRIORITIES].reverse().map((pr) => (
                <label key={pr} className="cursor-pointer">
                  <input
                    type="radio"
                    name="priority"
                    value={pr}
                    defaultChecked={(place?.priority ?? "maybe") === pr}
                    className="peer sr-only"
                  />
                  <span className={cn(pill, "min-h-11")}>{LABELS.placePriority[pr]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <TextField
          idPrefix={p}
          name="address"
          label="Address or area"
          defaultValue={place?.address ?? ""}
          error={errors.address}
          optional
          maxLength={240}
        />
        <TextField
          idPrefix={p}
          name="maps_url"
          label="Google Maps link"
          type="url"
          inputMode="url"
          placeholder="https://maps.app.goo.gl/…"
          defaultValue={place?.maps_url ?? ""}
          error={errors.maps_url}
          optional
          hint="Share → Copy link in Google Maps pins the exact place. Without it, Atlas links to a Maps search for the name and address."
        />
        <TextField
          idPrefix={p}
          name="website_url"
          label="Website"
          type="url"
          inputMode="url"
          placeholder="https://"
          defaultValue={place?.website_url ?? ""}
          error={errors.website_url}
          optional
        />
        <TextAreaField
          idPrefix={p}
          name="planning_notes"
          label="Planning notes"
          defaultValue={place?.planning_notes ?? ""}
          error={errors.planning_notes}
          optional
          maxLength={5000}
          placeholder={kind === "food" ? "Order the catch of the day, cash only…" : "Go at sunset, bring water…"}
        />
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {place ? "Save changes" : "Save to Explore"}
        </SubmitButton>
      </div>
    </form>
  );
}
