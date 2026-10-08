"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarPlus,
  Car,
  Check,
  CircleAlert,
  CircleCheckBig,
  ExternalLink,
  Globe,
  Heart,
  Info,
  MapPin,
  Pencil,
  Repeat2,
  Search,
  Star,
  StickyNote,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { saveItineraryItem } from "@/app/actions/itinerary";
import { recordPlaceVisit, savePlaceNotes, type RecordVisitState } from "@/app/actions/places";
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
import { formatShortDay, formatTime, parseDate } from "@/lib/dates";
import { useDisplayPrefs } from "@/components/settings/settings-provider";
import { formatRating, mapsLink } from "@/lib/explore";
import { itineraryHref } from "@/lib/itinerary-format";
import { addMinutesToTime, checkOuting, type OutingNotice } from "@/lib/outing-check";
import {
  CONFIRM_DIRECTLY,
  DRIVE_DISCLAIMER,
  FAMILY_DISCLAIMER,
  durationLabel,
  formatRange,
  isLongDrive,
  itineraryCategoryFor,
  itineraryNoteFor,
  priceEstimate,
  recommendationOf,
  roundTrip,
  suggestedMinutes,
  type Recommendation,
} from "@/lib/recommendations";
import type { ActionState, ItineraryEntry, PlaceWithVisits, Reservation } from "@/lib/types";
import { PollsNearby } from "@/components/polls/polls-view";
import { Attribution, useTripAccess } from "@/components/trip/trip-access";
import type { PollView } from "@/lib/polls";
import { cn } from "@/lib/utils";
import { useExplore } from "./explore-workspace";
import { FavoriteButton } from "./favorite-button";
import { PlaceArt } from "./place-art";
import { PriorityBadge, placeEyebrow } from "./place-card";

export type DetailAction = "schedule" | "record" | null;

type TripContext = { start: string; end: string; timeZone: string };

type Props = {
  place: PlaceWithVisits;
  visits: ItineraryEntry[];
  days: TripDayOption[];
  /** Sensible default day: today in the trip's zone, clamped into the trip. */
  defaultDate: string;
  initialAction: DetailAction;
  /** Questions asked about this place. */
  polls: PollView[];
  pollPlaces: { id: string; name: string }[];
  closeHref: string;
  trip: TripContext;
  /** Every itinerary entry of the trip, for conflict checks. */
  items: ItineraryEntry[];
  reservations: Reservation[];
};

const linkClass =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60";

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

const reviewDate = (date: string) => format(parseDate(date), "MMM d, yyyy");

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

type ScheduleSeed = { start: string; end: string } | null;

function PlaceDetail({ place, visits, days, defaultDate, initialAction, trip, items, reservations, polls, pollPlaces }: Props) {
  const { clock: clockPref } = useDisplayPrefs();
  const { tripId, editPlace, removePlace } = useExplore();
  const { canEdit } = useTripAccess();
  const [action, setAction] = useState<DetailAction>(initialAction);
  const [seed, setSeed] = useState<ScheduleSeed>(null);
  const rec = recommendationOf(place);
  const link = mapsLink(place);
  const planned = visits.filter((v) => v.status === "planned");
  const completed = visits.filter((v) => v.status === "completed");
  const skipped = visits.filter((v) => v.status === "skipped").length;
  const rating = formatRating(place.rating_avg);

  const openSchedule = (next: ScheduleSeed) => {
    setSeed(next);
    setAction("schedule");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="gap-0 px-5 pt-5 pb-4 pr-16 sm:px-6">
        <div className="flex items-start gap-4">
          <PlaceArt category={place.category} className="size-16 rounded-2xl" iconClassName="size-7" />
          <div className="min-w-0">
            <p className="eyebrow text-muted-foreground">{placeEyebrow(place, rec)}</p>
            <SheetTitle className="font-display mt-1 text-2xl leading-tight font-semibold break-words text-ink">
              {place.name}
            </SheetTitle>
            <SheetDescription asChild>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <PriorityBadge place={place} rec={rec} className="px-2.5 text-xs" />
                {!rec && place.priority === "maybe" ? (
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-ink">Maybe</span>
                ) : null}
                {rec ? (
                  <span className="rounded-full border border-dashed border-earth/50 px-2.5 py-0.5 text-xs font-semibold text-earth-ink">
                    Suggestion · not booked
                  </span>
                ) : null}
                {rating ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 fill-gold text-gold-deep" aria-hidden="true" />
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
        {rec ? <RecommendationFacts rec={rec} /> : null}

        <div>
          <div className="flex flex-wrap gap-2">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {link.exact ? <MapPin className="size-4" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
              {link.exact ? "Open in Google Maps" : "Open in Maps"}
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            {place.website_url ? (
              <a href={place.website_url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                <Globe className="size-4" aria-hidden="true" /> Website
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
            <FavoriteButton tripId={tripId} placeId={place.id} placeName={place.name} favorite={place.is_favorite} variant="label" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Your favorite and your notes are private — only you see them.</p>
          {!link.exact ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {rec ? DRIVE_DISCLAIMER : "No exact map link saved"} — Maps searches for “{link.query}”.
            </p>
          ) : null}
        </div>

        {place.address ? (
          <dl className="rounded-2xl border border-border bg-surface p-4">
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Address</dt>
            <dd className="mt-0.5 text-[0.9375rem] break-words text-ink">{place.address}</dd>
          </dl>
        ) : null}

        {canEdit ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => (action === "schedule" ? setAction(null) : openSchedule(null))}
            aria-expanded={action === "schedule"}
            className={cn(
              "focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] font-semibold transition-colors",
              action === "schedule" ? "bg-moss-hover text-white" : "bg-moss-ink text-white hover:bg-moss-hover",
            )}
          >
            <CalendarPlus className="size-4" aria-hidden="true" /> Add to itinerary
          </button>
          <button
            type="button"
            onClick={() => setAction(action === "record" ? null : "record")}
            aria-expanded={action === "record"}
            className={cn(
              "focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] border-moss-ink px-3 text-[0.9375rem] font-semibold text-moss-ink transition-colors",
              action === "record" ? "bg-moss-soft" : "hover:bg-moss-soft",
            )}
          >
            <CircleCheckBig className="size-4" aria-hidden="true" /> Mark visited
          </button>
        </div>
        ) : null}

        {canEdit && action === "schedule" ? (
          <ScheduleForm
            key={seed ? `${seed.start}-${seed.end}` : "blank"}
            tripId={tripId}
            place={place}
            rec={rec}
            days={days}
            defaultDate={defaultDate}
            seed={seed}
            trip={trip}
            items={items}
            reservations={reservations}
            onDone={() => setAction(null)}
          />
        ) : null}
        {canEdit && action === "record" ? (
          <RecordForm tripId={tripId} place={place} planned={planned} days={days} defaultDate={defaultDate} onDone={() => setAction(null)} />
        ) : null}

        {rec?.turns ? <TakeTurnsCard turns={rec.turns} onUse={() => openSchedule({ start: rec.turns!.leave, end: rec.turns!.back })} /> : null}
        {rec && (rec.price || rec.priceNote) ? <PriceCard rec={rec} /> : null}
        {rec ? <RecommendationNotes rec={rec} /> : null}

        <PollsNearby
          tripId={tripId}
          tripTimeZone={trip.timeZone}
          polls={polls.filter((p) => p.status !== "canceled")}
          places={pollPlaces}
          heading="Ask the group about this place"
          parent={{ type: "place", place_id: place.id }}
          scopeLabel={`About ${place.name}`}
          seedPlaceId={place.id}
        />

        <NotesForm key={place.my_notes ?? ""} tripId={tripId} place={place} />

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
                      {v.local_start_time ? <span className="font-normal text-muted-foreground"> · {formatTime(v.local_start_time, clockPref)}</span> : null}
                    </p>
                    {v.local_date ? (
                      <Link
                        href={itineraryHref(tripId, v.local_date)}
                        className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
                      >
                        Open day
                      </Link>
                    ) : null}
                  </div>
                  {v.planning_notes ? (
                    <p className="mt-0.5 line-clamp-3 flex gap-1.5 text-sm whitespace-pre-line text-muted-foreground">
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
                <li key={v.id} className="rounded-xl bg-gold-soft/60 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Check className="size-4 text-moss-ink" strokeWidth={3} aria-hidden="true" />
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

        {rec ? <Sources rec={rec} /> : null}
        <Attribution createdBy={place.created_by} updatedBy={place.updated_by} />
      </div>

      {canEdit ? (
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
      ) : null}
    </div>
  );
}

/* --------------------------- recommendation --------------------------- */

function RecommendationFacts({ rec }: { rec: Recommendation }) {
  const facts: [string, string][] = [["Area", rec.area]];
  if (rec.cuisine) facts.push(["Cuisine", rec.cuisine]);
  if (rec.driveMinutes) facts.push(["Drive", `${formatRange(rec.driveMinutes)} min (est.)`]);
  if (rec.visitMinutes) facts.push(["Time there", `${durationLabel(rec.visitMinutes)}, plus travel`]);
  if (rec.treatmentMinutes) facts.push(["Treatment", `about ${rec.treatmentMinutes} min`]);
  if (rec.totalAwayMinutes) facts.push(["Time away", `about ${durationLabel({ min: rec.totalAwayMinutes, max: rec.totalAwayMinutes })} in total`]);
  if (rec.bestTime) facts.push(["Best time", rec.bestTime]);
  return (
    <div className="space-y-3">
      <p className="text-[0.9375rem] leading-relaxed text-ink">{rec.summary}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-border bg-surface p-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="mt-0.5 text-sm break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {isLongDrive(rec) && rec.driveMinutes ? (
        <p className="flex gap-2 rounded-xl bg-gold-soft/70 p-3 text-sm text-gold-ink">
          <Car className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">A longer drive:</span> about {formatRange(roundTrip(rec.driveMinutes))} min of
            round-trip driving (est.), on top of the time there. Plan it as one deliberate outing that’s back before the
            midday rest.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function NoteList({ title, notes, footnote }: { title: string; notes: string[]; footnote?: string }) {
  if (!notes.length) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink/90 marker:text-moss">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {footnote ? <p className="mt-1.5 text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}

function RecommendationNotes({ rec }: { rec: Recommendation }) {
  const practical = rec.practical.length ? rec.practical : [`Hours, prices and facilities: ${CONFIRM_DIRECTLY.toLowerCase()}.`];
  return (
    <section aria-labelledby="rec-notes-heading" className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <h3 id="rec-notes-heading" className="eyebrow text-ink">
        Planning notes
      </h3>
      <NoteList title={rec.soloParent ? "Who goes" : "For the family"} notes={rec.family} footnote={FAMILY_DISCLAIMER} />
      <NoteList title="Food to ask about" notes={rec.food} />
      <NoteList title="Vegetarian notes" notes={rec.vegetarian} />
      <NoteList title="Good to know" notes={practical} />
    </section>
  );
}

function TakeTurnsCard({ turns, onUse }: { turns: NonNullable<Recommendation["turns"]>; onUse: () => void }) {
  const { clock: clockPref } = useDisplayPrefs();
  return (
    <section aria-labelledby="turns-heading" className="rounded-2xl border border-sage/60 bg-moss-soft/50 p-4">
      <h3 id="turns-heading" className="flex items-center gap-2 font-semibold text-ink">
        <Repeat2 className="size-4 text-moss-ink" aria-hidden="true" /> Take turns
      </h3>
      <p className="mt-1 text-sm text-ink/90">{turns.text}</p>
      <ol className="mt-3 space-y-1.5 text-sm">
        {turns.steps.map((s) => (
          <li key={s.at} className="flex gap-3">
            <span className="w-32 shrink-0 font-semibold text-moss-ink tabular-nums">
              {s.approx ? "Around " : ""}
              {formatTime(s.at, clockPref)}
              {s.until ? `–${formatTime(s.until, clockPref)}` : ""}
            </span>
            <span className="text-ink">{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onUse}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-moss-ink bg-white px-3.5 text-sm font-semibold text-moss-ink hover:bg-moss-soft"
        >
          <CalendarPlus className="size-4" aria-hidden="true" /> Plan a turn at these times
        </button>
        <span className="text-xs text-muted-foreground">An editable suggestion, not a reservation.</span>
      </div>
    </section>
  );
}

function PriceCard({ rec }: { rec: Recommendation }) {
  if (!rec.price) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-ink">
        <span className="font-semibold">Price:</span> {rec.priceNote}
      </p>
    );
  }
  const est = priceEstimate(rec.price);
  return (
    <section aria-labelledby="price-heading" className="rounded-2xl border border-border bg-surface p-4 text-sm">
      <h3 id="price-heading" className="eyebrow text-ink">
        Published price
      </h3>
      <p className="mt-1.5 font-semibold text-ink">{rec.price.label}</p>
      <p className="mt-1 text-ink/90">{rec.price.caveat}</p>
      <p className="mt-2 text-muted-foreground">
        Worked out from that price with the listed {est.percent}% service charge
        {est.sundayPercent !== null ? ` (${est.sundayPercent}% on Sundays — not used here)` : ""}: {est.perPerson} per person,{" "}
        {est.forTwo} for two separate treatments. Other charges aren’t included — not a quote.
      </p>
    </section>
  );
}

function Sources({ rec }: { rec: Recommendation }) {
  return (
    <section aria-labelledby="sources-heading">
      <h3 id="sources-heading" className="eyebrow text-ink">
        Sources
      </h3>
      <ul className="mt-2 space-y-1">
        {rec.sources.map((url) => (
          <li key={url}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold break-all text-moss-ink underline-offset-2 hover:underline"
            >
              {hostOf(url)}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Researched {reviewDate(rec.reviewedOn)}. Atlas hasn’t independently verified these details — hours, menus, prices
        and facilities can change, so confirm directly.
      </p>
    </section>
  );
}

/* ------------------------------- forms ------------------------------- */

/** "Your notes" — private to the signed-in member (never the trip's shared notes). */
function NotesForm({ tripId, place }: { tripId: string; place: PlaceWithVisits }) {
  const saved = place.my_notes ?? "";
  const [value, setValue] = useState(saved);
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await savePlaceNotes(tripId, place.id, prev, formData);
    if (result.ok) toast.success(result.message);
    return result;
  });
  const dirty = value.trim() !== saved.trim();
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <TextAreaField
        idPrefix={`notes-${place.id}`}
        name="planning_notes"
        label="Your notes (private)"
        hint="Only you can see these."
        maxLength={5000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={state.fieldErrors?.planning_notes}
        placeholder="Ask for a table by the window, bring the carrier…"
        className="min-h-20"
      />
      <div className="flex items-center justify-end gap-3">
        {!dirty && saved ? <span className="text-xs text-muted-foreground">Saved</span> : null}
        <SubmitButton pending={pending} pendingLabel="Saving…" disabled={!dirty} className="min-h-11 px-4 text-sm">
          Save notes
        </SubmitButton>
      </div>
    </form>
  );
}

function dayOptions(days: TripDayOption[]) {
  return days.map((d) => ({ value: d.date, label: d.label }));
}

function NoticeList({ notices }: { notices: OutingNotice[] }) {
  if (!notices.length) return null;
  return (
    <ul className="space-y-2" aria-live="polite">
      {notices.map((n, i) => (
        <li
          key={`${n.code}-${i}`}
          className={cn(
            "flex gap-2 rounded-xl p-3 text-sm",
            n.level === "warning" ? "bg-gold-soft/70 text-gold-ink" : "bg-[#e9f6fb] text-info-ink",
          )}
        >
          {n.level === "warning" ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            <span className="font-semibold">{n.title}</span>
            {n.detail ? <span className="block">{n.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Add to itinerary": a planned visit linked to this place, through the
 * existing itinerary action. The traveler picks the day and time; the end
 * time, category and an editable note are prefilled from the
 * recommendation. Conflicts are checked as they type; warnings that need a
 * decision (rest block, airport days, both parents away) must be kept
 * explicitly before saving. Nothing else on the itinerary is moved.
 */
function ScheduleForm({
  tripId,
  place,
  rec,
  days,
  defaultDate,
  seed,
  trip,
  items,
  reservations,
  onDone,
}: {
  tripId: string;
  place: PlaceWithVisits;
  rec: Recommendation | null;
  days: TripDayOption[];
  defaultDate: string;
  seed: ScheduleSeed;
  trip: TripContext;
  items: ItineraryEntry[];
  reservations: Reservation[];
  onDone: () => void;
}) {
  const { clock: clockPref } = useDisplayPrefs();
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState(seed?.start ?? "");
  const [end, setEnd] = useState(seed?.end ?? "");
  const [endTouched, setEndTouched] = useState(Boolean(seed));
  const [keep, setKeep] = useState(false);
  const minutes = suggestedMinutes(rec);

  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveItineraryItem(tripId, null, prev, formData);
    if (result.ok) {
      const day = String(formData.get("local_date"));
      toast.success(`${place.name} is on your itinerary.`, {
        action: { label: "View day", onClick: () => router.push(itineraryHref(tripId, day)) },
      });
      onDone();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};
  const prefix = `schedule-${place.id}`;

  const notices = checkOuting(
    {
      date,
      start: start || null,
      end: end || null,
      // A spa's suggested time away already includes the drive.
      drive: rec?.totalAwayMinutes ? null : (rec?.driveMinutes ?? null),
      soloParent: rec?.soloParent ?? false,
    },
    { tripStart: trip.start, tripEnd: trip.end, timeZone: trip.timeZone, items, reservations, clock: clockPref },
  );
  const needsKeep = notices.some((n) => n.confirm);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="place_id" value={place.id} />
      <input type="hidden" name="reservation_id" value="" />
      <input type="hidden" name="title" value="" />
      <input type="hidden" name="category" value={itineraryCategoryFor(place, rec)} />
      <input type="hidden" name="timezone" value="" />
      <input type="hidden" name="local_end_date" value="" />
      <SelectField
        idPrefix={prefix}
        name="local_date"
        label="Day"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setKeep(false);
        }}
        options={dayOptions(days)}
        error={errors.local_date}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          idPrefix={prefix}
          name="local_start_time"
          label={rec?.totalAwayMinutes ? "Leave at" : "Starts"}
          type="time"
          optional
          value={start}
          onChange={(e) => {
            const next = e.target.value;
            setStart(next);
            setKeep(false);
            if (!endTouched && minutes && next) setEnd(addMinutesToTime(next, minutes) ?? "");
          }}
          error={errors.local_start_time}
        />
        <TextField
          idPrefix={prefix}
          name="local_end_time"
          label={rec?.totalAwayMinutes ? "Back by" : "Ends"}
          type="time"
          optional
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            setEndTouched(true);
            setKeep(false);
          }}
          error={errors.local_end_time ?? errors.local_end_date}
        />
      </div>
      {minutes && !endTouched ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          The end time follows the suggested {rec?.totalAwayMinutes ? "time away" : "time there"} (
          {durationLabel({ min: minutes, max: minutes })}) — change it if you like.
        </p>
      ) : null}

      <NoticeList notices={notices} />
      {needsKeep ? (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gold/60 bg-white px-3.5 py-2.5 text-sm text-ink">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-moss" />
          <span>Keep this time anyway — nothing else on the itinerary will be moved.</span>
        </label>
      ) : null}

      <TextAreaField
        idPrefix={prefix}
        name="planning_notes"
        label="Note for this visit"
        optional
        maxLength={5000}
        error={errors.planning_notes}
        defaultValue={rec ? itineraryNoteFor(rec, place.website_url) : ""}
        placeholder="Go early, book a table…"
        className="min-h-24"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={cn(secondaryButtonClass, "min-h-11 px-4 text-sm")}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Adding…" disabled={needsKeep && !keep} className="min-h-11 px-4 text-sm">
          Add to itinerary
        </SubmitButton>
      </div>
      {needsKeep && !keep ? (
        <p className="text-right text-xs text-muted-foreground">Adjust the time, or tick “Keep this time anyway”.</p>
      ) : null}
    </form>
  );
}

/**
 * "Mark visited": complete a planned visit the traveler picks, or add a
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
            <label key={v.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-white px-3.5 py-2 text-sm text-ink has-[:checked]:border-moss has-[:checked]:bg-moss-soft/60">
              <input type="radio" name="choice_ui" checked={choice === v.id} onChange={() => setChoice(v.id)} className="size-4 accent-moss" />
              <span>
                Yes — mark the visit on <span className="font-semibold">{dayLabel(days, v.local_date)}</span> as done
              </span>
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-input bg-white px-3.5 py-2 text-sm text-ink has-[:checked]:border-moss has-[:checked]:bg-moss-soft/60">
            <input type="radio" name="choice_ui" checked={choice === "new"} onChange={() => setChoice("new")} className="size-4 accent-moss" />
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
        <button type="button" onClick={onDone} className={cn(secondaryButtonClass, "min-h-11 px-4 text-sm")}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…" className="min-h-11 px-4 text-sm">
          {needsChoice && choice === "" ? "Choose above" : "Save visit"}
        </SubmitButton>
      </div>
      {needsChoice && choice === "" ? (
        <p className="text-xs text-muted-foreground">Pick an option so the right visit is updated.</p>
      ) : null}
    </form>
  );
}
