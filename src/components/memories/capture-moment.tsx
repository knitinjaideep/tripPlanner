"use client";

import type { ComponentProps } from "react";
import { useTripAccess } from "@/components/trip/trip-access";
import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { captureExistingMoment, captureNewMoment } from "@/app/actions/memories";
import {
  FormMessage,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { StarRatingInput } from "@/components/itinerary/star-rating";
import type { TripDayOption } from "@/components/itinerary/types";
import { formatTime } from "@/lib/dates";
import { useDisplayPrefs } from "@/components/settings/settings-provider";
import type { CaptureCandidate } from "@/lib/memories";
import { ITINERARY_CATEGORIES, LABELS, exploreKindFor, type ItineraryCategory } from "@/lib/plan-options";
import type { ActionState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EditDialog, useDirty } from "./edit-dialog";

type Mode = "existing" | "new";

/**
 * "Capture a moment": complete something already on the itinerary, or add
 * something unplanned as a completed activity. Either way it is an
 * itinerary row — nothing is stored separately for Memories.
 */
function CaptureMomentButtonInner({
  tripId,
  candidates,
  days,
  autoOpen = false,
  className,
  children,
}: {
  tripId: string;
  candidates: CaptureCandidate[];
  /** Trip days up to today, newest first. */
  days: TripDayOption[];
  autoOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(autoOpen);
  const [session, setSession] = useState(0);

  function close() {
    setOpen(false);
    // Drop ?capture=1 so a refresh doesn't reopen it.
    if (autoOpen) router.replace(pathname, { scroll: false });
  }

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
      {open ? <CaptureDialog key={session} tripId={tripId} candidates={candidates} days={days} onClose={close} /> : null}
    </>
  );
}

function CaptureDialog({
  tripId,
  candidates,
  days,
  onClose,
}: {
  tripId: string;
  candidates: CaptureCandidate[];
  days: TripDayOption[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(candidates.length ? "existing" : "new");
  const { dirty, markDirty } = useDirty();
  const [pending, setPending] = useState(false);

  return (
    <EditDialog
      open
      onClose={onClose}
      dirty={dirty}
      pending={pending}
      wide
      title="Capture a moment"
      description="It’s saved on your itinerary as done, and appears here in your journal."
    >
      {(requestClose) => (
        <div className="space-y-5">
          <fieldset>
            <legend className="sr-only">What are you capturing?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeOption
                checked={mode === "existing"}
                disabled={candidates.length === 0}
                onSelect={() => setMode("existing")}
                title="From the itinerary"
                detail={candidates.length ? "Mark a plan or booking as done" : "Nothing planned up to today"}
              />
              <ModeOption
                checked={mode === "new"}
                onSelect={() => setMode("new")}
                title="Something new"
                detail="It wasn’t planned — add it as done"
              />
            </div>
          </fieldset>
          {mode === "existing" ? (
            <ExistingForm
              tripId={tripId}
              candidates={candidates}
              days={days}
              onDirty={markDirty}
              onPending={setPending}
              onDone={onClose}
              onCancel={requestClose}
            />
          ) : (
            <NewForm tripId={tripId} days={days} onDirty={markDirty} onPending={setPending} onDone={onClose} onCancel={requestClose} />
          )}
        </div>
      )}
    </EditDialog>
  );
}

function ModeOption({
  checked,
  disabled,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-input bg-white p-3 has-[:checked]:border-moss has-[:checked]:bg-moss-soft/60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-moss/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name="capture_mode" checked={checked} disabled={disabled} onChange={onSelect} className="mt-1 size-4 accent-moss" />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}

type FormProps = {
  tripId: string;
  days: TripDayOption[];
  onDirty: () => void;
  onPending: (pending: boolean) => void;
  onDone: () => void;
  onCancel: () => void;
};

function ReviewFields({ prefix, onDirty, error }: { prefix: string; onDirty: () => void; error?: string[] }) {
  return (
    <>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink">
          How was it? <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <StarRatingInput defaultValue={null} legend="Rating" onChange={onDirty} />
      </fieldset>
      <TextAreaField
        idPrefix={prefix}
        name="reflection"
        label="Reflection"
        optional
        maxLength={5000}
        error={error}
        placeholder="What do you want to remember?"
        className="min-h-24"
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" name="is_favorite" className="size-5 accent-coral" />
        A trip favorite
      </label>
    </>
  );
}

function Buttons({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onCancel} className={secondaryButtonClass}>
        Cancel
      </button>
      <SubmitButton pending={pending} pendingLabel="Saving…">
        Save moment
      </SubmitButton>
    </div>
  );
}

function ExistingForm({ tripId, candidates, days, onDirty, onPending, onDone, onCancel }: FormProps & { candidates: CaptureCandidate[] }) {
  const { clock: clockPref } = useDisplayPrefs();
  const [key, setKey] = useState("");
  const chosen = candidates.find((c) => c.key === key);
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    if (!chosen) {
      return { ok: false, message: "Please check the highlighted fields.", fieldErrors: { entry: ["Choose what you did from the list."] } };
    }
    onPending(true);
    const result = await captureExistingMoment(tripId, chosen.target, prev, formData);
    onPending(false);
    if (result.ok) {
      toast.success(result.message);
      onDone();
    }
    return result;
  });
  const dayLabel = (date: string) => days.find((d) => d.date === date)?.label ?? date;
  const byDay = new Map<string, CaptureCandidate[]>();
  for (const c of candidates) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);

  return (
    <form onSubmit={onSubmit} onInput={onDirty} noValidate className="space-y-4">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <div className="space-y-1.5">
        <label htmlFor="capture-entry" className="text-sm font-semibold text-ink">
          What did you do?
        </label>
        <select
          id="capture-entry"
          value={key}
          aria-invalid={state.fieldErrors?.entry ? true : undefined}
          aria-describedby="capture-entry-hint"
          onChange={(e) => setKey(e.target.value)}
          className="h-11 w-full rounded-[10px] border border-input bg-white px-3.5 text-[0.9375rem] text-ink focus-visible:border-moss focus-visible:ring-3 focus-visible:ring-moss/25 focus-visible:outline-none"
        >
          <option value="">Choose from your itinerary…</option>
          {[...byDay.entries()].map(([date, list]) => (
            <optgroup key={date} label={dayLabel(date)}>
              {list.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.time ? `${formatTime(c.time, clockPref)} · ` : ""}
                  {c.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p id="capture-entry-hint" className={cn("text-sm", state.fieldErrors?.entry ? "text-destructive" : "text-muted-foreground")}>
          {state.fieldErrors?.entry?.[0] ?? "Plans and bookings from trip days up to today that aren’t marked done yet."}
        </p>
      </div>
      <ReviewFields prefix="capture-existing" onDirty={onDirty} error={state.fieldErrors?.reflection} />
      <Buttons pending={pending} onCancel={onCancel} />
    </form>
  );
}

function NewForm({ tripId, days, onDirty, onPending, onDone, onCancel }: FormProps) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState<ItineraryCategory>("activity");
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    onPending(true);
    const result = await captureNewMoment(tripId, prev, formData);
    onPending(false);
    if (result.ok) {
      toast.success(result.message);
      onDone();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};
  const explore = exploreKindFor(category);

  return (
    <form onSubmit={onSubmit} onInput={onDirty} noValidate className="space-y-4">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <input type="hidden" name="request_id" value={requestId} />
      <TextField
        idPrefix="capture-new"
        name="title"
        label="What did you do?"
        required
        maxLength={160}
        error={errors.title}
        placeholder="Sunset at Eagle Beach"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          idPrefix="capture-new"
          name="local_date"
          label="Day"
          defaultValue={days[0]?.date}
          options={days.map((d) => ({ value: d.date, label: d.label }))}
          error={errors.local_date}
        />
        <SelectField
          idPrefix="capture-new"
          name="category"
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ItineraryCategory)}
          options={ITINERARY_CATEGORIES.map((c) => ({ value: c, label: LABELS.itineraryCategory[c] }))}
          error={errors.category}
        />
      </div>
      <ReviewFields prefix="capture-new" onDirty={onDirty} error={errors.reflection} />
      {explore ? (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
          <input type="checkbox" name="save_to_explore" className="mt-0.5 size-5 accent-moss" />
          <span>
            <span className="font-medium">Also save to Explore</span>
            <span className="block text-muted-foreground">
              Links to a place with the same name if you already have one, so it shows as visited.
            </span>
          </span>
        </label>
      ) : null}
      <Buttons pending={pending} onCancel={onCancel} />
    </form>
  );
}

/** Editors and the owner only; viewers never see this control (the server refuses it regardless). */
export function CaptureMomentButton(props: ComponentProps<typeof CaptureMomentButtonInner>) {
  const { canEdit } = useTripAccess();
  return canEdit ? <CaptureMomentButtonInner {...props} /> : null;
}
