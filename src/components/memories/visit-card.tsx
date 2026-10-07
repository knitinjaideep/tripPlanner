"use client";

import { useTripAccess } from "@/components/trip/trip-access";
import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, Compass, Heart, Loader2, Pencil, PenLine, Ticket } from "lucide-react";
import { toast } from "sonner";
import { saveReflection, setItineraryFavorite } from "@/app/actions/itinerary";
import { FormMessage, SubmitButton, TextAreaField, secondaryButtonClass } from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { CategoryIcon } from "@/components/itinerary/category-icon";
import { StarRatingInput, Stars } from "@/components/itinerary/star-rating";
import { ViewBookingButton } from "@/components/trip/trip-workspace";
import { exploreHref } from "@/lib/explore";
import { entryClock, itineraryHref } from "@/lib/itinerary-format";
import { LABELS, type PlaceCategory } from "@/lib/plan-options";
import { entryTitle, itemSchedule } from "@/lib/schedule";
import type { ActionState, ItineraryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EditDialog, useDirty } from "./edit-dialog";

const linkClass =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-moss-ink hover:bg-moss-soft/60";

/**
 * One completed visit in the journal. Its rating, reflection and favorite
 * are the itinerary row's own fields, so edits here show up in the
 * Itinerary and Explore immediately (and vice versa).
 */
export function VisitCard({ tripId, visit, inTrip }: { tripId: string; visit: ItineraryEntry; inTrip: boolean }) {
  const title = entryTitle(visit);
  const schedule = itemSchedule(visit);
  const clock = schedule.date ? entryClock({ date: schedule.date, time: schedule.startTime, timeZone: schedule.timeZone }) : null;
  const { canEdit } = useTripAccess();
  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState(0);
  const [favorite, setOptimisticFavorite] = useOptimistic(visit.is_favorite);
  const [favoritePending, startFavorite] = useTransition();

  const kindLabel = [
    LABELS.itineraryCategory[visit.category],
    visit.place ? LABELS.placeCategory[visit.place.category as PlaceCategory] : null,
  ]
    .filter((v, i, all) => v && v !== "Other" && all.indexOf(v) === i)
    .join(" · ");

  function toggleFavorite() {
    const next = !favorite;
    startFavorite(async () => {
      setOptimisticFavorite(next);
      const result = await setItineraryFavorite(tripId, { itemId: visit.id }, next);
      if (!result.ok) toast.error(result.message ?? "Couldn’t update the favorite. Please try again.");
    });
  }

  function edit() {
    setSession((s) => s + 1);
    setEditing(true);
  }

  return (
    <article
      aria-labelledby={`visit-${visit.id}`}
      className={cn(
        "card-surface relative flex gap-3.5 p-4 sm:gap-4 sm:p-5",
        favorite && "border-gold/70 bg-[#fffbef]",
      )}
    >
      <CategoryIcon category={visit.category} kind={visit.reservation?.kind} className="mt-0.5 size-10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {[clock ? `${clock.time}${clock.zone ? ` ${clock.zone}` : ""}` : null, kindLabel || null].filter(Boolean).join(" · ")}
            </p>
            <h4 id={`visit-${visit.id}`} className="font-display mt-0.5 text-xl leading-snug font-semibold break-words text-ink">
              {title}
            </h4>
            {visit.reservation?.status === "cancelled" ? (
              <span className="mt-1 inline-block rounded-full bg-[#fff1ee] px-2 py-0.5 text-xs font-semibold text-[#8c2b1f]">
                Booking cancelled
              </span>
            ) : null}
          </div>
          {canEdit ? (
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={favoritePending}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${title} from favorites` : `Mark ${title} as a favorite`}
            title={favorite ? "Favorite" : "Mark as favorite"}
            className={cn(
              "focus-ring -mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-xl transition-colors hover:bg-[#ffe9e4] disabled:cursor-wait",
              favorite ? "text-coral" : "text-[#8e9480] hover:text-coral",
            )}
          >
            <Heart className={cn("size-5", favorite && "fill-current")} aria-hidden="true" />
          </button>
          ) : favorite ? (
            <Heart className="mt-1 size-5 shrink-0 fill-current text-coral" aria-label="Favorite" />
          ) : null}
        </div>

        {visit.rating ? <Stars value={visit.rating} className="mt-2" /> : null}

        {visit.reflection ? (
          <blockquote className="mt-2.5 border-l-2 border-gold pl-3.5 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink/90">
            {visit.reflection}
          </blockquote>
        ) : null}

        <div className="mt-3 -ml-2 flex flex-wrap items-center gap-x-1 gap-y-0.5">
          {!canEdit ? null : visit.reflection || visit.rating ? (
            <button type="button" onClick={edit} className={linkClass}>
              <Pencil className="size-3.5" aria-hidden="true" /> Edit<span className="sr-only"> reflection for {title}</span>
            </button>
          ) : (
            <button type="button" onClick={edit} className={cn(linkClass, "text-muted-foreground hover:text-moss-ink")}>
              <PenLine className="size-3.5" aria-hidden="true" /> Add a reflection<span className="sr-only"> for {title}</span>
            </button>
          )}
          {visit.place ? (
            <Link href={exploreHref(tripId, {}, visit.place.id)} className={linkClass}>
              <Compass className="size-3.5" aria-hidden="true" /> In Explore<span className="sr-only">: {visit.place.name}</span>
            </Link>
          ) : null}
          {visit.reservation ? (
            <ViewBookingButton bookingId={visit.reservation.id} className={linkClass}>
              <Ticket className="size-3.5" aria-hidden="true" /> Booking<span className="sr-only">: {visit.reservation.title}</span>
            </ViewBookingButton>
          ) : null}
          {schedule.date && inTrip ? (
            <Link href={itineraryHref(tripId, schedule.date)} className={linkClass}>
              <CalendarDays className="size-3.5" aria-hidden="true" /> Itinerary<span className="sr-only"> for that day</span>
            </Link>
          ) : null}
          {favoritePending ? <Loader2 className="ml-1 size-3.5 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
        </div>
      </div>

      {editing ? (
        <ReflectionDialog key={session} tripId={tripId} visit={visit} favorite={favorite} title={title} onClose={() => setEditing(false)} />
      ) : null}
    </article>
  );
}

function ReflectionDialog({
  tripId,
  visit,
  favorite,
  title,
  onClose,
}: {
  tripId: string;
  visit: ItineraryEntry;
  favorite: boolean;
  title: string;
  onClose: () => void;
}) {
  const { dirty, markDirty } = useDirty();
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveReflection(tripId, visit.id, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    }
    return result;
  });
  const prefix = `reflection-${visit.id}`;

  return (
    <EditDialog
      open
      onClose={onClose}
      dirty={dirty}
      pending={pending}
      title={title}
      description="Your rating and reflection for this visit. Also shown in the Itinerary and Explore."
    >
      {(requestClose) => (
        <form onSubmit={onSubmit} onInput={markDirty} noValidate className="space-y-4">
          <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink">
              How was it? <span className="font-normal text-muted-foreground">(optional)</span>
            </legend>
            <StarRatingInput defaultValue={visit.rating} legend="Rating for this visit" onChange={markDirty} />
          </fieldset>
          <TextAreaField
            idPrefix={prefix}
            name="reflection"
            label="Reflection"
            optional
            maxLength={5000}
            defaultValue={visit.reflection ?? ""}
            error={state.fieldErrors?.reflection}
            placeholder="What do you want to remember?"
            className="min-h-28"
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
            <input type="checkbox" name="is_favorite" defaultChecked={favorite} className="size-5 accent-coral" />
            A trip favorite
          </label>
          <div className="flex flex-wrap justify-end gap-2">
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
