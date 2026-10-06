"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, CircleCheckBig, Globe, Heart, MapPin, Pencil, Search, Star, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveItineraryItem } from "@/app/actions/itinerary";
import { recordPlaceVisit, type RecordVisitState } from "@/app/actions/places";
import {
  FormMessage,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { StarRatingInput, Stars } from "@/components/itinerary/star-rating";
import type { TripDayOption } from "@/components/itinerary/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatShortDay, formatTime } from "@/lib/dates";
import { formatRating, mapsLink } from "@/lib/explore";
import { itineraryHref } from "@/lib/itinerary-format";
import { LABELS } from "@/lib/plan-options";
import type { ActionState, ItineraryEntry, PlaceWithVisits } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useExplore } from "./explore-workspace";
import { PlaceArt } from "./place-art";

export type DetailAction = "schedule" | "record" | null;

type Props = {
  place: PlaceWithVisits;
  visits: ItineraryEntry[];
  days: TripDayOption[];
  /** Sensible default day: today in the trip's zone, clamped into the trip. */
  defaultDate: string;
  initialAction: DetailAction;
  closeHref: string;
};

const linkClass =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-teal-ink hover:bg-teal-soft/60";

export function PlaceDetailSheet(props: Props) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(open) => !open && router.push(props.closeHref, { scroll: false })}>
      <SheetContent
        side="right"
        className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <PlaceDetail key={props.place.id} {...props} />
      </SheetContent>
    </Sheet>
  );
}

function dayLabel(days: TripDayOption[], date: string | null) {
  if (!date) return "No date";
  return days.find((d) => d.date === date)?.label ?? `${formatShortDay(date)} (outside trip dates)`;
}

function PlaceDetail({ place, visits, days, defaultDate, initialAction }: Props) {
  const { tripId, editPlace, removePlace } = useExplore();
  const [action, setAction] = useState<DetailAction>(initialAction);
  const link = mapsLink(place);
  const planned = visits.filter((v) => v.status === "planned");
  const completed = visits.filter((v) => v.status === "completed");
  const skipped = visits.filter((v) => v.status === "skipped").length;
  const rating = formatRating(place.rating_avg);
  const category = LABELS.placeCategory[place.category as keyof typeof LABELS.placeCategory] ?? "Other";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="gap-0 px-5 pt-5 pb-4 pr-16 sm:px-6">
        <div className="flex items-start gap-4">
          <PlaceArt category={place.category} className="size-16 rounded-2xl" iconClassName="size-7" />
          <div className="min-w-0">
            <p className="eyebrow text-muted-foreground">
              {place.kind === "food" ? "Food & drink" : "Place"} · {category}
            </p>
            <SheetTitle className="font-display mt-1 text-2xl leading-tight font-semibold break-words text-ink">
              {place.name}
            </SheetTitle>
            <SheetDescription asChild>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {place.priority === "must_do" ? (
                  <span className="rounded-full bg-coral px-2.5 py-0.5 text-xs font-semibold text-white">Must do</span>
                ) : (
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-ink">Maybe</span>
                )}
                {rating ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 fill-[#e8a600] text-[#e8a600]" aria-hidden="true" />
                    <span>
                      {rating} <span className="sr-only">out of 5</span>· average of your{" "}
                      {place.rated_count === 1 ? "rating" : `${place.rated_count} ratings`}
                    </span>
                  </span>
                ) : null}
              </div>
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 sm:px-6">
        <div className="flex flex-wrap gap-2">
          <a href={link.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {link.exact ? <MapPin className="size-4" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
            {link.exact ? "Open in Google Maps" : "Search Google Maps"}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {place.website_url ? (
            <a href={place.website_url} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <Globe className="size-4" aria-hidden="true" /> Website
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
        {!link.exact ? (
          <p className="-mt-3 text-xs text-muted-foreground">
            No exact map link saved — this searches for “{[place.name, place.address].filter(Boolean).join(", ")}”.
          </p>
        ) : null}

        {place.address || place.planning_notes ? (
          <dl className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            {place.address ? (
              <div>
                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Address</dt>
                <dd className="mt-0.5 text-[0.9375rem] break-words text-ink">{place.address}</dd>
              </div>
            ) : null}
            {place.planning_notes ? (
              <div>
                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Planning notes</dt>
                <dd className="mt-0.5 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink">{place.planning_notes}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAction(action === "schedule" ? null : "schedule")}
            aria-expanded={action === "schedule"}
            className={cn(
              "focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] font-semibold transition-colors",
              action === "schedule" ? "bg-coral-hover text-white" : "bg-coral text-white hover:bg-coral-hover",
            )}
          >
            <CalendarPlus className="size-4" aria-hidden="true" /> Add to itinerary
          </button>
          <button
            type="button"
            onClick={() => setAction(action === "record" ? null : "record")}
            aria-expanded={action === "record"}
            className={cn(
              "focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] border-teal-ink px-3 text-[0.9375rem] font-semibold text-teal-ink transition-colors",
              action === "record" ? "bg-teal-soft" : "hover:bg-teal-soft",
            )}
          >
            <CircleCheckBig className="size-4" aria-hidden="true" /> Record a visit
          </button>
        </div>

        {action === "schedule" ? (
          <ScheduleForm tripId={tripId} place={place} days={days} defaultDate={defaultDate} onDone={() => setAction(null)} />
        ) : null}
        {action === "record" ? (
          <RecordForm tripId={tripId} place={place} planned={planned} days={days} defaultDate={defaultDate} onDone={() => setAction(null)} />
        ) : null}

        <section aria-labelledby="planned-heading">
          <h3 id="planned-heading" className="eyebrow text-ink">
            Planned {planned.length ? `· ${planned.length}` : ""}
          </h3>
          {planned.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Not on your itinerary yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {planned.map((v) => (
                <li key={v.id} className="rounded-xl border border-border bg-surface px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">
                      {dayLabel(days, v.local_date)}
                      {v.local_start_time ? <span className="font-normal text-muted-foreground"> · {formatTime(v.local_start_time)}</span> : null}
                    </p>
                    {v.local_date ? (
                      <Link
                        href={itineraryHref(tripId, v.local_date)}
                        className="focus-ring inline-flex min-h-10 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-teal-ink hover:bg-teal-soft/60"
                      >
                        Open day
                      </Link>
                    ) : null}
                  </div>
                  {v.planning_notes ? (
                    <p className="mt-0.5 flex gap-1.5 text-sm text-muted-foreground">
                      <StickyNote className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {v.planning_notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="visited-heading">
          <h3 id="visited-heading" className="eyebrow text-ink">
            Visited {completed.length ? `· ${completed.length}` : ""}
          </h3>
          {completed.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No visits recorded yet.{skipped ? ` ${skipped === 1 ? "One visit was" : `${skipped} visits were`} skipped.` : ""}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {completed.map((v) => (
                <li key={v.id} className="rounded-xl bg-sun/60 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Check className="size-4 text-teal-ink" strokeWidth={3} aria-hidden="true" />
                    <span className="text-sm font-semibold text-ink">{dayLabel(days, v.local_date)}</span>
                    {v.rating ? <Stars value={v.rating} /> : null}
                    {v.is_favorite ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#a33a2b]">
                        <Heart className="size-3 fill-current" aria-hidden="true" /> Favorite
                      </span>
                    ) : null}
                  </div>
                  {v.reflection ? (
                    <p className="mt-1 text-sm whitespace-pre-line text-ink/90 italic">“{v.reflection}”</p>
                  ) : null}
                </li>
              ))}
              {skipped ? (
                <li className="text-sm text-muted-foreground">
                  {skipped === 1 ? "One more visit was" : `${skipped} more visits were`} skipped.
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </div>

      <div className="flex gap-3 border-t border-border bg-surface px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => removePlace(place)}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[0.9375rem] font-semibold text-destructive hover:bg-[#fff1ee]"
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </button>
        <button type="button" onClick={() => editPlace(place)} className={`${secondaryButtonClass} ml-auto`}>
          <Pencil className="size-4" aria-hidden="true" /> Edit
        </button>
      </div>
    </div>
  );
}

function dayOptions(days: TripDayOption[]) {
  return days.map((d) => ({ value: d.date, label: d.label }));
}

/** "Add to itinerary": a planned visit linked to this place. */
function ScheduleForm({
  tripId,
  place,
  days,
  defaultDate,
  onDone,
}: {
  tripId: string;
  place: PlaceWithVisits;
  days: TripDayOption[];
  defaultDate: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveItineraryItem(tripId, null, prev, formData);
    if (result.ok) {
      const date = String(formData.get("local_date"));
      toast.success(`${place.name} is on your itinerary.`, {
        action: { label: "View day", onClick: () => router.push(itineraryHref(tripId, date)) },
      });
      onDone();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};
  const prefix = `schedule-${place.id}`;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="place_id" value={place.id} />
      <input type="hidden" name="reservation_id" value="" />
      <input type="hidden" name="title" value="" />
      <input type="hidden" name="category" value={place.kind === "food" ? "food" : "sightseeing"} />
      <input type="hidden" name="timezone" value="" />
      <input type="hidden" name="local_end_date" value="" />
      <SelectField idPrefix={prefix} name="local_date" label="Day" defaultValue={defaultDate} options={dayOptions(days)} error={errors.local_date} />
      <div className="grid grid-cols-2 gap-3">
        <TextField idPrefix={prefix} name="local_start_time" label="Starts" type="time" optional error={errors.local_start_time} />
        <TextField idPrefix={prefix} name="local_end_time" label="Ends" type="time" optional error={errors.local_end_time ?? errors.local_end_date} />
      </div>
      <TextAreaField
        idPrefix={prefix}
        name="planning_notes"
        label="Note for this visit"
        optional
        maxLength={5000}
        error={errors.planning_notes}
        placeholder="Go early, book a table…"
        className="min-h-20"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Adding…" className="min-h-10 px-4 text-sm">
          Add to itinerary
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * "Record a visit": complete a planned visit the traveler picks, or add a
 * completed one. With planned visits there is no default — nothing is guessed.
 */
function RecordForm({
  tripId,
  place,
  planned,
  days,
  defaultDate,
  onDone,
}: {
  tripId: string;
  place: PlaceWithVisits;
  planned: ItineraryEntry[];
  days: TripDayOption[];
  defaultDate: string;
  onDone: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [choice, setChoice] = useState<string>(planned.length ? "" : "new");
  const { state, onSubmit, pending } = useFormAction(async (prev: RecordVisitState, formData: FormData) => {
    const result = await recordPlaceVisit(tripId, place.id, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onDone();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};
  const prefix = `record-${place.id}`;
  const needsChoice = planned.length > 0;
  const showDate = choice === "new";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="visit_choice" value={choice} />

      {needsChoice ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Is this one of your planned visits?</legend>
          {planned.map((v) => (
            <label key={v.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-white px-3.5 py-2 text-sm text-ink has-[:checked]:border-teal has-[:checked]:bg-teal-soft/60">
              <input type="radio" name="choice_ui" checked={choice === v.id} onChange={() => setChoice(v.id)} className="size-4 accent-teal" />
              <span>
                Yes — mark the visit on <span className="font-semibold">{dayLabel(days, v.local_date)}</span> as done
              </span>
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-white px-3.5 py-2 text-sm text-ink has-[:checked]:border-teal has-[:checked]:bg-teal-soft/60">
            <input type="radio" name="choice_ui" checked={choice === "new"} onChange={() => setChoice("new")} className="size-4 accent-teal" />
            <span>No — it was a separate visit</span>
          </label>
        </fieldset>
      ) : null}

      {showDate ? (
        <SelectField idPrefix={prefix} name="date" label="When did you go?" defaultValue={defaultDate} options={dayOptions(days)} error={errors.date} />
      ) : (
        <input type="hidden" name="date" value={planned.find((v) => v.id === choice)?.local_date ?? defaultDate} />
      )}

      <div>
        <p className="mb-1 text-sm font-semibold text-ink">
          How was it? <span className="font-normal text-muted-foreground">(optional)</span>
        </p>
        <StarRatingInput defaultValue={null} />
      </div>
      <TextAreaField
        idPrefix={prefix}
        name="reflection"
        label="Reflection"
        optional
        maxLength={5000}
        error={errors.reflection}
        placeholder="What do you want to remember?"
        className="min-h-20"
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" name="is_favorite" className="size-5 accent-coral" />
        A trip favorite
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={cn(secondaryButtonClass, "min-h-10 px-4 text-sm")}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…" className="min-h-10 px-4 text-sm">
          {needsChoice && choice === "" ? "Choose above" : "Save visit"}
        </SubmitButton>
      </div>
      {needsChoice && choice === "" ? (
        <p className="text-xs text-muted-foreground">Pick an option so the right visit is updated.</p>
      ) : null}
    </form>
  );
}

