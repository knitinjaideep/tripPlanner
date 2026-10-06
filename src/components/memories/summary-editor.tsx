"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { saveTripSummary } from "@/app/actions/memories";
import { FormMessage, SubmitButton, TextAreaField, secondaryButtonClass } from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { StarRatingInput } from "@/components/itinerary/star-rating";
import { LABELS, WOULD_RETURN, type WouldReturn } from "@/lib/plan-options";
import type { ActionState, TripMemory } from "@/lib/types";
import { EditDialog, useDirty } from "./edit-dialog";

type Summary = Pick<TripMemory, "overall_rating" | "summary" | "favorite_moment" | "would_return" | "lessons_for_next_time">;

/** Opens the trip reflection editor. The album link is edited on its own card. */
export function SummaryEditButton({
  tripId,
  memory,
  children,
  className,
}: {
  tripId: string;
  memory: Summary | null;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // A fresh form (and dirty state) every time it opens.
  const [session, setSession] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSession((s) => s + 1);
          setOpen(true);
        }}
        className={className}
      >
        {children}
      </button>
      {open ? <SummaryDialog key={session} tripId={tripId} memory={memory} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SummaryDialog({ tripId, memory, onClose }: { tripId: string; memory: Summary | null; onClose: () => void }) {
  const { dirty, markDirty } = useDirty();
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveTripSummary(tripId, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};

  return (
    <EditDialog
      open
      onClose={onClose}
      dirty={dirty}
      pending={pending}
      wide
      title="Your trip reflection"
      description="Everything here is optional. Write as much or as little as you like."
    >
      {(requestClose) => (
      <form onSubmit={onSubmit} onInput={markDirty} noValidate className="space-y-5">
        <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">
            Overall rating <span className="font-normal text-muted-foreground">(optional)</span>
          </legend>
          <StarRatingInput
            name="overall_rating"
            legend="Overall trip rating"
            defaultValue={memory?.overall_rating ?? null}
            onChange={markDirty}
          />
          {errors.overall_rating ? <p className="mt-1 text-sm text-destructive">{errors.overall_rating[0]}</p> : null}
        </fieldset>
        <TextAreaField
          idPrefix="memory"
          name="summary"
          label="How was the trip?"
          optional
          maxLength={5000}
          defaultValue={memory?.summary ?? ""}
          error={errors.summary}
          placeholder="A few lines to remember it by…"
          className="min-h-28"
        />
        <TextAreaField
          idPrefix="memory"
          name="favorite_moment"
          label="Favorite moment"
          optional
          maxLength={2000}
          defaultValue={memory?.favorite_moment ?? ""}
          error={errors.favorite_moment}
          className="min-h-20"
        />
        <WouldReturnField defaultValue={memory?.would_return ?? null} onChange={markDirty} error={errors.would_return} />
        <TextAreaField
          idPrefix="memory"
          name="lessons_for_next_time"
          label="Lessons for next time"
          optional
          maxLength={5000}
          defaultValue={memory?.lessons_for_next_time ?? ""}
          error={errors.lessons_for_next_time}
          placeholder="Pack lighter, book the boat trip earlier…"
          className="min-h-20"
        />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={requestClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <SubmitButton pending={pending} pendingLabel="Saving…">
            Save reflection
          </SubmitButton>
        </div>
      </form>
      )}
    </EditDialog>
  );
}

/** Yes / No / Undecided as radios; "Clear" goes back to not answered. */
function WouldReturnField({
  defaultValue,
  onChange,
  error,
}: {
  defaultValue: WouldReturn | null;
  onChange: () => void;
  error?: string[];
}) {
  const [value, setValue] = useState<WouldReturn | "">(defaultValue ?? "");
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        Would you go back? <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      {/* Submitted even when nothing is chosen, so clearing saves as "not answered". */}
      <input type="hidden" name="would_return" value={value} />
      <div className="flex flex-wrap items-center gap-2">
        {WOULD_RETURN.map((option) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-input bg-white px-4 text-sm font-medium text-ink has-[:checked]:border-moss has-[:checked]:bg-moss-soft/70 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-moss/40"
          >
            <input
              type="radio"
              name="would_return_choice"
              value={option}
              checked={value === option}
              onChange={() => {
                setValue(option);
                onChange();
              }}
              className="size-4 accent-moss"
            />
            {LABELS.wouldReturn[option]}
          </label>
        ))}
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onChange();
            }}
            className="focus-ring min-h-11 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-ink"
          >
            Clear<span className="sr-only"> answer</span>
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-sm text-destructive">{error[0]}</p> : null}
    </fieldset>
  );
}
