"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import { saveItineraryItem } from "@/app/actions/itinerary";
import {
  FormMessage,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  TimeZoneField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { ConflictGuard } from "@/components/forms/conflict";
import { useFormAction } from "@/components/forms/use-form-action";
import { Attribution } from "@/components/trip/trip-access";
import { useTripWorkspace } from "@/components/trip/trip-workspace";
import { BOOKING_KIND_META } from "@/lib/booking-kinds";
import { formatMoment, placeSummary } from "@/lib/booking-format";
import { useDisplayPrefs } from "@/components/settings/settings-provider";
import { formatShortDay, toTimeInput } from "@/lib/dates";
import { placeMapsUrl } from "@/lib/itinerary-format";
import { ITINERARY_CATEGORIES, LABELS, exploreKindFor, type ItineraryCategory } from "@/lib/plan-options";
import { categoryForReservation } from "@/lib/schedule";
import { timeZoneLabel } from "@/lib/time-zones";
import type { ActionState, ItineraryEntry, Reservation } from "@/lib/types";
import { CATEGORY_STYLE } from "./category-icon";
import type { ActivityFormMode, ExplorePlace, TripDayOption } from "./types";

type Props = {
  tripId: string;
  tripTimeZone: string;
  days: TripDayOption[];
  places: ExplorePlace[];
  bookings: Reservation[];
  /** Bookings that already have an itinerary row (one entry per booking). */
  linkedBookingIds: string[];
  mode: ActivityFormMode;
  date: string;
  /** Editing: the existing row, and/or the booking it belongs to. */
  item?: ItineraryEntry | null;
  reservation?: Reservation | null;
  onCancel: () => void;
  onSaved: (date: string | null) => void;
};

const p = "itinerary";

const MODES: { value: ActivityFormMode; label: string }[] = [
  { value: "activity", label: "New activity" },
  { value: "place", label: "From Explore" },
  { value: "booking", label: "A booking" },
];

/** Bookings that can be linked here: dated, not cancelled, not already on the itinerary. */
function linkableBookings({ bookings, linkedBookingIds, reservation }: Pick<Props, "bookings" | "linkedBookingIds" | "reservation">) {
  const linked = new Set(linkedBookingIds);
  return bookings.filter((b) => b.id === reservation?.id || (b.start_date && b.status !== "cancelled" && !linked.has(b.id)));
}

const placeCategory = (kind: ExplorePlace["kind"]): ItineraryCategory => (kind === "food" ? "food" : "sightseeing");

export function ItineraryForm(props: Props) {
  const { tripId, item, reservation, onCancel, onSaved } = props;
  const editing = Boolean(item || reservation);
  const [mode, setMode] = useState<ActivityFormMode>(props.mode);
  // Becomes the new row's id, so a double submit can't create two entries.
  const [requestId] = useState(() => crypto.randomUUID());

  const nothingToSave =
    (mode === "place" && props.places.length === 0) || (mode === "booking" && linkableBookings(props).length === 0);

  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveItineraryItem(tripId, item?.id ?? null, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      const date = formData.get("local_date");
      onSaved(typeof date === "string" && date ? date : null);
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 sm:px-6">
        <FormMessage message={state.ok || state.conflict ? undefined : state.message} signedOut={state.signedOut} />
        <ConflictGuard state={state} expectedUpdatedAt={item?.updated_at} onDiscard={onCancel} />
        {editing ? null : <input type="hidden" name="request_id" value={requestId} />}

        {editing ? null : (
          <fieldset>
            <legend className="sr-only">What are you adding?</legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
              {MODES.map((m) => (
                <label key={m.value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-11 items-center justify-center rounded-lg px-2 text-center text-sm font-semibold text-muted-foreground transition-colors peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:ring-3 peer-focus-visible:ring-moss/40">
                    {m.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {mode === "activity" ? <ActivityFields {...props} errors={errors} /> : null}
        {mode === "place" ? <PlaceFields {...props} errors={errors} /> : null}
        {mode === "booking" ? <BookingFields {...props} errors={errors} /> : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        {editing ? <Attribution createdBy={item?.created_by} updatedBy={item?.updated_by} className="text-xs text-muted-foreground sm:mr-auto" /> : null}
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        {nothingToSave ? null : (
          <SubmitButton pending={pending} pendingLabel="Saving…">
            {editing ? "Save changes" : "Add to itinerary"}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

type FieldProps = Props & { errors: Record<string, string[] | undefined> };

/* ----------------------------- activity ----------------------------- */

function ActivityFields({ item, errors, ...props }: FieldProps) {
  const [category, setCategory] = useState<ItineraryCategory>(item?.category ?? "activity");
  const canSaveToExplore = !item?.place_id && exploreKindFor(category) !== null;

  return (
    <>
      <input type="hidden" name="place_id" value="" />
      <input type="hidden" name="reservation_id" value="" />
      <TextField
        idPrefix={p}
        name="title"
        label="What’s the plan?"
        placeholder="Sunset at California Lighthouse"
        defaultValue={item?.title ?? ""}
        error={errors.title}
        required
        maxLength={160}
        autoComplete="off"
      />

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-ink">Category</legend>
        <div className="flex flex-wrap gap-2">
          {ITINERARY_CATEGORIES.map((c) => {
            const { icon: Icon } = CATEGORY_STYLE[c];
            return (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="category"
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                  className="peer sr-only"
                />
                <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-white px-3.5 text-sm font-medium text-ink transition-colors peer-checked:border-moss peer-checked:bg-moss-soft peer-checked:text-moss-ink peer-focus-visible:ring-3 peer-focus-visible:ring-moss/40">
                  <Icon className="size-4" aria-hidden="true" />
                  {LABELS.itineraryCategory[c]}
                </span>
              </label>
            );
          })}
        </div>
        {errors.category?.length ? <p className="mt-1.5 text-sm text-destructive">{errors.category[0]}</p> : null}
      </fieldset>

      <ScheduleFields item={item} errors={errors} {...props} />

      <TextAreaField
        idPrefix={p}
        name="planning_notes"
        label="Planning notes"
        defaultValue={item?.planning_notes ?? ""}
        error={errors.planning_notes}
        optional
        maxLength={5000}
        placeholder="Tickets at the door, bring reef-safe sunscreen…"
      />

      <PlanFlags item={item} />

      {canSaveToExplore ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-input bg-white p-3.5">
          <input type="checkbox" name="save_to_explore" className="mt-0.5 size-5 shrink-0 accent-moss" />
          <span>
            <span className="block text-sm font-semibold text-ink">Also save to Explore</span>
            <span className="block text-sm text-muted-foreground">
              Keeps it with your places. If a place with this name is already there, it’s linked instead of
              duplicated.
            </span>
          </span>
        </label>
      ) : null}
    </>
  );
}

/* ------------------------------- place ------------------------------ */

function PlaceFields({ item, places, errors, ...props }: FieldProps) {
  const [placeId, setPlaceId] = useState(item?.place_id ?? places.find((pl) => pl.planned_count === 0 && pl.completed_count === 0)?.id ?? places[0]?.id ?? "");
  const place = places.find((pl) => pl.id === placeId);

  if (places.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-input p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-ink">No places saved yet</p>
        <p className="mt-1">
          Save places in the Explore tab, or add a new activity and tick{" "}
          <span className="font-medium text-ink">“Also save to Explore”</span>.
        </p>
      </div>
    );
  }

  return (
    <>
      <input type="hidden" name="reservation_id" value="" />
      <input type="hidden" name="title" value={item?.title ?? ""} />
      <input type="hidden" name="category" value={item?.category ?? (place ? placeCategory(place.kind) : "sightseeing")} />
      <SelectField
        idPrefix={p}
        name="place_id"
        label="Place"
        value={placeId}
        onChange={(e) => setPlaceId(e.target.value)}
        error={errors.place_id}
        options={places.map((pl) => ({
          value: pl.id,
          label: `${pl.name}${pl.priority === "must_do" ? " · Must do" : ""}${pl.visit_count > 0 ? ` · scheduled ${pl.visit_count}×` : ""}`,
        }))}
        hint={place && place.visit_count > 0 && place.id !== item?.place_id ? "Already on your itinerary — this adds another visit." : undefined}
      />
      {place ? (
        <div className="flex items-start gap-3 rounded-2xl bg-moss-soft/60 p-4">
          <MapPin className="mt-0.5 size-4 shrink-0 text-moss-ink" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{place.name}</p>
            <p className="text-sm text-muted-foreground">
              {[LABELS.placeCategory[place.category as keyof typeof LABELS.placeCategory], place.address].filter(Boolean).join(" · ")}
            </p>
            <a
              href={placeMapsUrl(place)}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring mt-1 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-moss-ink hover:underline"
            >
              Open in Maps <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
      ) : null}

      <ScheduleFields item={item} errors={errors} {...props} />

      <TextAreaField
        idPrefix={p}
        name="planning_notes"
        label="Notes for this visit"
        defaultValue={item?.planning_notes ?? ""}
        error={errors.planning_notes}
        optional
        maxLength={5000}
        placeholder="Go early for the light, try the pastechi…"
      />

      <PlanFlags item={item} />
    </>
  );
}

/* ------------------------------ booking ----------------------------- */

function BookingFields({ item, reservation, bookings, linkedBookingIds, errors, onCancel }: FieldProps) {
  const { clock: clockPref } = useDisplayPrefs();
  const { editBooking } = useTripWorkspace();
  const available = linkableBookings({ bookings, linkedBookingIds, reservation });
  const undated = bookings.filter((b) => !b.start_date && b.status !== "cancelled");
  const [bookingId, setBookingId] = useState(reservation?.id ?? available[0]?.id ?? "");
  const booking = bookings.find((b) => b.id === bookingId);

  const openBooking = (id: string) => {
    onCancel();
    editBooking(id);
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Dated bookings already appear on their day. Link one here to add your own planning notes — its times and
        confirmation stay on the booking.
      </p>
      {available.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input p-5 text-sm text-muted-foreground">
          Every dated booking is already on your itinerary.
        </div>
      ) : (
        <>
          <input type="hidden" name="place_id" value="" />
          <input type="hidden" name="title" value={item?.title ?? ""} />
          <input type="hidden" name="category" value={item?.category ?? (booking ? categoryForReservation(booking.kind) : "other")} />
          {reservation ? (
            <input type="hidden" name="reservation_id" value={reservation.id} />
          ) : (
            <SelectField
              idPrefix={p}
              name="reservation_id"
              label="Booking"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              error={errors.reservation_id}
              options={available.map((b) => ({
                value: b.id,
                label: `${b.title} · ${b.start_date ? formatShortDay(b.start_date) : ""}`,
              }))}
            />
          )}
          {booking ? (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {BOOKING_KIND_META[booking.kind].label}
              </p>
              <p className="mt-0.5 font-semibold text-ink">{booking.title}</p>
              <p className="text-sm text-muted-foreground">
                {[formatMoment(booking.start_date, booking.start_time, true, booking.start_time_zone, clockPref), placeSummary(booking)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <button
                type="button"
                onClick={() => openBooking(booking.id)}
                className="focus-ring mt-2 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
              >
                <Pencil className="size-3.5" aria-hidden="true" /> Edit booking details
              </button>
              {errors.reservation_id?.length && reservation ? (
                <p className="text-sm text-destructive">{errors.reservation_id[0]}</p>
              ) : null}
            </div>
          ) : null}
          <TextAreaField
            idPrefix={p}
            name="planning_notes"
            label="Planning notes"
            defaultValue={item?.planning_notes ?? ""}
            error={errors.planning_notes}
            optional
            maxLength={5000}
            placeholder="Leave for the airport by 6, snacks for the drive…"
          />
        </>
      )}
      {undated.length > 0 && !reservation ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Needs a date first</p>
          <ul className="space-y-1.5">
            {undated.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/70 py-1 pr-1 pl-3.5 text-sm">
                <span className="min-w-0 truncate text-ink">{b.title}</span>
                <button
                  type="button"
                  onClick={() => openBooking(b.id)}
                  className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-semibold text-moss-ink hover:bg-white"
                >
                  Add a date
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------ flags ------------------------------- */

function PlanFlags({ item }: { item?: ItineraryEntry | null }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        Planning <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="is_optional" defaultChecked={item?.is_optional ?? false} className="mt-0.5 size-5 shrink-0 accent-moss" />
        <span>
          <span className="font-medium">Optional</span>
          <span className="block text-muted-foreground">Fine to shorten or skip on the day.</span>
        </span>
      </label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="is_protected_rest"
          defaultChecked={item?.is_protected_rest ?? false}
          className="mt-0.5 size-5 shrink-0 accent-moss"
        />
        <span>
          <span className="font-medium">Protected rest</span>
          <span className="block text-muted-foreground">Keep this window free of outings — overlaps get a gentle note.</span>
        </span>
      </label>
    </fieldset>
  );
}

/* ----------------------------- schedule ----------------------------- */

function ScheduleFields({
  item,
  days,
  date,
  tripTimeZone,
  errors,
}: Pick<FieldProps, "item" | "days" | "date" | "tripTimeZone" | "errors">) {
  const current = item?.local_date ?? date;
  const options = days.map((d) => ({ value: d.date, label: d.label }));
  if (current && !days.some((d) => d.date === current)) {
    options.unshift({ value: current, label: `${formatShortDay(current)} (outside trip dates)` });
  }
  const zone = item?.timezone ?? tripTimeZone;

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">When</legend>
      <SelectField idPrefix={p} name="local_date" label="Day" defaultValue={current} options={options} error={errors.local_date} />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          idPrefix={p}
          name="local_start_time"
          label="Starts"
          type="time"
          optional
          defaultValue={toTimeInput(item?.local_start_time ?? null)}
          error={errors.local_start_time}
        />
        <TextField
          idPrefix={p}
          name="local_end_time"
          label="Ends"
          type="time"
          optional
          defaultValue={toTimeInput(item?.local_end_time ?? null)}
          error={errors.local_end_time}
        />
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">No time? It goes in the day’s Flexible list.</p>

      <details
        className="group rounded-xl border border-border bg-surface px-3.5"
        open={Boolean(item?.local_end_date || errors.local_end_date || errors.timezone || (item && item.timezone && item.timezone !== tripTimeZone))}
      >
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span>
            Overnight or another time zone?
            <span className="ml-1.5 font-normal text-muted-foreground">{timeZoneLabel(zone)}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-4 pt-1 pb-4">
          <TextField
            idPrefix={p}
            name="local_end_date"
            label="End date"
            type="date"
            optional
            defaultValue={item?.local_end_date ?? ""}
            error={errors.local_end_date}
            hint="Only if it ends on a later day."
          />
          <TimeZoneField idPrefix={p} name="timezone" label="Time zone" defaultValue={zone} error={errors.timezone} />
        </div>
      </details>
    </fieldset>
  );
}
