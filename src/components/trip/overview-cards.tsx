import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BedDouble, FileText, Luggage, MapPin, Plane, Plus } from "lucide-react";
import { BOOKING_KIND_META } from "@/lib/booking-kinds";
import { formatMoment, formatZonedTime, looksLikeCode, placeSummary, stayNights, upcomingFirst } from "@/lib/booking-format";
import { entryClock, entryLabel, itineraryHref } from "@/lib/itinerary-format";
import { agendaCategory, agendaTitle, buildAgenda, previewDay, splitDay } from "@/lib/schedule";
import { CategoryIcon } from "@/components/itinerary/category-icon";
import { getCover } from "@/lib/covers";
import { formatDayDate, tripLengthDays } from "@/lib/dates";
import { detailValue } from "@/lib/reservation-details";
import { progressOf } from "@/lib/packing";
import type { ItineraryEntry, PackingCategoryWithItems, Reservation, TripDocument, TripWithDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BookingIcon } from "./booking-icon";
import { CopyButton } from "./copy-button";
import { DocumentRow } from "./document-row";
import { AddBookingButton, AddDocumentButton, ViewBookingButton } from "./trip-workspace";

const linkButton =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 -mr-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60";

const outlineButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-moss-ink px-5 text-[0.9375rem] font-semibold text-moss-ink transition-colors hover:bg-moss-soft";

function CardEyebrow({ icon: Icon, children }: { icon: typeof Plane; children: React.ReactNode }) {
  return (
    <p className="eyebrow flex items-center gap-2 text-ink">
      <Icon className="size-4 text-moss" aria-hidden="true" />
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Flight — boarding-pass card                                         */
/* ------------------------------------------------------------------ */

function Airport({ value, align }: { value: string | null; align: "left" | "right" }) {
  if (!value) return <p className="font-display text-2xl text-muted-foreground">—</p>;
  return looksLikeCode(value) ? (
    <p className={cn("text-[2.75rem] leading-none font-medium tracking-tight text-ink", align === "right" && "text-right")}>
      {value}
    </p>
  ) : (
    <p
      className={cn(
        "font-display line-clamp-2 text-2xl leading-tight font-semibold text-ink",
        align === "right" && "text-right",
      )}
    >
      {value}
    </p>
  );
}

function FlightMoment({
  date,
  time,
  timeZone,
  align = "left",
  fallback,
}: {
  date: string | null;
  time: string | null;
  timeZone: string | null;
  align?: "left" | "right";
  fallback?: string;
}) {
  return (
    <p className={cn("text-[0.9375rem] leading-relaxed text-muted-foreground", align === "right" && "text-right")}>
      {date ? (
        <>
          {formatDayDate(date)}
          {time ? <span className="block font-medium text-ink">{formatZonedTime(date, time, timeZone)}</span> : null}
        </>
      ) : (
        fallback
      )}
    </p>
  );
}

export function FlightCard({ trip, today, className }: { trip: TripWithDetails; today: string; className?: string }) {
  const flights = trip.reservations.filter((b) => b.kind === "flight" && b.status !== "cancelled");
  const flight = upcomingFirst(flights, today);

  if (!flight) {
    return (
      <article className={cn("card-surface flex flex-col p-6 md:col-span-1 lg:col-span-5", className)}>
        <CardEyebrow icon={Plane}>Flights</CardEyebrow>
        <div className="flex flex-1 flex-col items-start justify-center gap-3 py-6">
          <h2 className="font-display text-2xl font-semibold text-ink">No flights saved yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add your flight to keep the times, flight number and confirmation code at hand.
          </p>
        </div>
        <AddBookingButton kind="flight" className={cn(outlineButton, "self-start")}>
          <Plus className="size-4" aria-hidden="true" /> Add flight details
        </AddBookingButton>
      </article>
    );
  }

  const departs = formatMoment(flight.start_date, flight.start_time, false, flight.start_time_zone);
  const hasRoute = Boolean(flight.origin || flight.destination);
  const flightNumber = detailValue("flight", flight.details, "flight_number");

  return (
    <article className={cn("card-surface relative flex flex-col p-6 md:col-span-1 lg:col-span-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <CardEyebrow icon={Plane}>
          Flight{flights.length > 1 ? ` · ${flights.indexOf(flight) + 1} of ${flights.length}` : ""}
        </CardEyebrow>
        <ViewBookingButton bookingId={flight.id} className={linkButton}>
          View details <ArrowRight className="size-4" aria-hidden="true" />
        </ViewBookingButton>
      </div>

      {hasRoute ? (
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          <div className="min-w-0">
            <Airport value={flight.origin} align="left" />
          </div>
          <div className="flex items-center gap-2 pt-4 text-moss-ink" aria-hidden="true">
            <span className="hidden w-10 border-t-2 border-dotted border-input sm:block lg:w-6 xl:w-12" />
            <Plane className="size-6" />
            <span className="hidden w-10 border-t-2 border-dotted border-input sm:block lg:w-6 xl:w-12" />
          </div>
          <div className="min-w-0">
            <Airport value={flight.destination} align="right" />
          </div>
          <FlightMoment
            date={flight.start_date}
            time={flight.start_time}
            timeZone={flight.start_time_zone}
            fallback="Departure not set"
          />
          <span aria-hidden="true" />
          <FlightMoment date={flight.end_date} time={flight.end_time} timeZone={flight.end_time_zone} align="right" />
          <p className="sr-only">
            From {flight.origin ?? "unknown"} to {flight.destination ?? "unknown"}
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <h2 className="font-display text-3xl font-semibold text-ink">{flight.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{departs ?? "Departure not set"}</p>
        </div>
      )}

      {/* Boarding-pass tear line */}
      <div className="relative -mx-6 my-6" aria-hidden="true">
        <div className="mx-6 border-t-2 border-dashed border-border" />
        <span className="absolute top-1/2 -left-2.5 size-5 -translate-y-1/2 rounded-full border border-border bg-background" />
        <span className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full border border-border bg-background" />
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">
            {[flight.provider, flightNumber].filter(Boolean).join(" ") || flight.title}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {flight.provider || flightNumber ? flight.title : BOOKING_KIND_META.flight.label}
          </p>
        </div>
        {flight.confirmation_code ? (
          <div className="flex items-center gap-1 rounded-xl bg-gold-soft py-1 pr-1 pl-3.5">
            <div>
              <p className="text-[0.6875rem] font-semibold tracking-wider text-gold-ink uppercase">Confirmation</p>
              <p className="font-mono text-[0.9375rem] font-semibold tracking-wider text-ink">{flight.confirmation_code}</p>
            </div>
            <CopyButton value={flight.confirmation_code} label="Confirmation number" />
          </div>
        ) : (
          <ViewBookingButton bookingId={flight.id} className={outlineButton}>
            Add confirmation
          </ViewBookingButton>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Stay — photographic card (illustrative destination photo)          */
/* ------------------------------------------------------------------ */

export function StayCard({ trip, today, className }: { trip: TripWithDetails; today: string; className?: string }) {
  const stays = trip.reservations.filter((b) => b.kind === "lodging" && b.status !== "cancelled");
  const stay = upcomingFirst(stays, today);

  if (!stay) {
    return (
      <article className={cn("card-surface flex flex-col bg-[#f5f9ee] p-6 md:col-span-1 lg:col-span-4", className)}>
        <CardEyebrow icon={BedDouble}>Accommodation</CardEyebrow>
        <div className="flex flex-1 flex-col items-start justify-center gap-3 py-6">
          <h2 className="font-display text-2xl font-semibold text-ink">Where are you staying?</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Save your hotel or rental with check-in times and the confirmation number.
          </p>
        </div>
        <AddBookingButton kind="lodging" className={cn(outlineButton, "self-start")}>
          <Plus className="size-4" aria-hidden="true" /> Add a stay
        </AddBookingButton>
      </article>
    );
  }

  const cover = getCover(trip.cover_image);
  const nights = stayNights(stay);
  const sub = [nights ? (nights === 1 ? "1 night" : `${nights} nights`) : null, stay.location].filter(Boolean).join(" · ");

  return (
    <article className={cn("group relative isolate flex min-h-[19rem] flex-col justify-between overflow-hidden rounded-2xl bg-[#183a2f] p-5 text-white md:col-span-1 lg:col-span-4", className)}>
      <Image src={cover.image} alt="" fill sizes="(min-width: 1024px) 420px, (min-width: 768px) 50vw, 100vw" className="-z-10 object-cover" style={{ objectPosition: cover.position }} />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#10251e]/85 via-[#10251e]/20 to-[#10251e]/10" />

      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-ink">
          <BedDouble className="size-4 text-moss-ink" aria-hidden="true" />
          Stay{stays.length > 1 ? ` · ${stays.length}` : ""}
        </p>
        <ViewBookingButton
          bookingId={stay.id}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-sm font-semibold text-moss-ink hover:bg-white"
        >
          View stay <ArrowRight className="size-4" aria-hidden="true" />
        </ViewBookingButton>
      </div>

      <div>
        <h2 className="font-display text-[1.75rem] leading-tight font-semibold drop-shadow-sm">{stay.title}</h2>
        {sub ? <p className="mt-1 text-[0.9375rem] text-white/90">{sub}</p> : null}
        {stay.start_date ? (
          <p className="mt-1 text-sm text-white/80">Check-in {formatMoment(stay.start_date, stay.start_time, true, stay.start_time_zone)}</p>
        ) : null}
        <p className="mt-3 text-[0.6875rem] text-white/65">Illustrative destination photo</p>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* At a glance — pale yellow                                           */
/* ------------------------------------------------------------------ */

export function GlanceCard({ trip, className }: { trip: TripWithDetails; className?: string }) {
  const bookings = trip.reservations.length;
  const docs = trip.documents.length;
  const days = tripLengthDays(trip.start_date, trip.end_date);
  const missingCodes = trip.reservations.filter((b) => !b.confirmation_code && b.status !== "cancelled").length;

  const headline =
    bookings === 0 ? "Let’s gather the details." : missingCodes > 0 ? "Nearly organized." : "All booked and noted.";

  return (
    <article className={cn("flex flex-col rounded-2xl bg-gold-soft p-6 md:col-span-2 lg:col-span-3", className)}>
      <p className="eyebrow text-gold-ink">At a glance</p>
      <h2 className="font-display mt-3 text-[1.75rem] leading-tight font-semibold text-ink">{headline}</h2>
      <dl className="mt-5 grid grid-cols-3 gap-2 md:max-w-md lg:max-w-none">
        {[
          { label: bookings === 1 ? "booking" : "bookings", value: bookings },
          { label: docs === 1 ? "document" : "documents", value: docs },
          { label: days === 1 ? "day" : "days", value: days },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-white/70 px-3 py-2.5">
            <dt className="sr-only">{s.label}</dt>
            <dd>
              <span className="block text-2xl font-semibold text-ink">{s.value}</span>
              <span className="text-xs text-gold-ink">{s.label}</span>
            </dd>
          </div>
        ))}
      </dl>
      {bookings > 0 && missingCodes > 0 ? (
        <p className="mt-4 text-sm text-gold-ink">
          {missingCodes === 1 ? "1 booking is" : `${missingCodes} bookings are`} missing a confirmation number.
        </p>
      ) : null}
      <div className="mt-auto pt-6">
        <AddBookingButton className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover">
          <Plus className="size-4" aria-hidden="true" /> Add a booking
        </AddBookingButton>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Day plan — preview of the merged itinerary                          */
/* ------------------------------------------------------------------ */

const PREVIEW_LIMIT = 4;

export function DayPlanCard({
  trip,
  items,
  todayInTripZone,
  className,
}: {
  trip: TripWithDetails;
  items: ItineraryEntry[];
  todayInTripZone: string;
  className?: string;
}) {
  // Same merge as the Itinerary tab: a booking shows once, cancelled ones are left out.
  const agenda = buildAgenda({ items, reservations: trip.reservations, tripStart: trip.start_date, tripEnd: trip.end_date });
  const date = previewDay(trip.start_date, trip.end_date, todayInTripZone);
  const day = agenda.days.find((d) => d.date === date) ?? agenda.days[0];
  const { timed, flexible } = splitDay(day.entries);
  const entries = [...timed, ...flexible];
  const shown = entries.slice(0, PREVIEW_LIMIT);
  const more = entries.length - shown.length;
  const href = itineraryHref(trip.id, day.date);
  const heading =
    todayInTripZone < trip.start_date ? "First day" : todayInTripZone > trip.end_date ? "Last day" : "Today’s plan";

  return (
    <article className={cn("card-surface p-6 md:col-span-2 lg:col-span-8", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-ink">{heading}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Day {day.dayNumber} · {formatDayDate(day.date)}
          </p>
        </div>
        <Link href={href} className={linkButton}>
          Open itinerary <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className="mt-5 flex flex-col items-start gap-4 rounded-xl border border-dashed border-input p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Nothing planned yet. Leave it open or add something to look forward to.</p>
          <Link href={href} className={outlineButton}>
            <Plus className="size-4" aria-hidden="true" /> Plan this day
          </Link>
        </div>
      ) : (
        <ol className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 md:grid-cols-2">
          {shown.map((e) => {
            const clock = entryClock(e);
            const label = entryLabel(e);
            const done = e.item?.status === "completed";
            return (
              <li key={e.key}>
                <Link href={href} className="focus-ring group flex items-start gap-3 rounded-xl p-1.5 hover:bg-secondary/60">
                  <CategoryIcon category={agendaCategory(e)} kind={e.reservation?.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">
                      {clock ? (
                        <>
                          {clock.time}
                          {clock.zone ? <span className="font-normal text-muted-foreground"> {clock.zone}</span> : null}
                        </>
                      ) : (
                        <span className="font-normal text-muted-foreground">Flexible</span>
                      )}
                      {done ? <span className="ml-2 text-xs font-semibold text-moss-ink">Done</span> : null}
                    </span>
                    <span className="block truncate font-semibold text-ink group-hover:text-moss-ink">
                      {label ? <span className="font-medium text-muted-foreground">{label} · </span> : null}
                      {agendaTitle(e)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {more > 0 ? (
        <Link href={href} className={cn(linkButton, "mt-2")}>
          {more} more on this day <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Travel documents — warm stone                                       */
/* ------------------------------------------------------------------ */

export function DocumentsCard({ trip, limit = 4, className }: { trip: TripWithDetails; limit?: number; className?: string }) {
  const titles = new Map(trip.reservations.map((b) => [b.id, b.title]));
  const docs: TripDocument[] = trip.documents.slice(0, limit);
  const more = trip.documents.length - docs.length;

  return (
    <article className={cn("rounded-2xl bg-surface-warm p-5 sm:p-6 md:col-span-2 lg:col-span-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2 text-earth-ink">
          <FileText className="size-4" aria-hidden="true" /> Travel documents
        </p>
        <AddDocumentButton className="focus-ring -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-earth-ink hover:bg-white/60">
          <Plus className="size-4" aria-hidden="true" /> Add link
        </AddDocumentButton>
      </div>
      {docs.length === 0 ? (
        <div className="mt-4 rounded-xl bg-white/70 p-4 text-sm text-earth-ink">
          Link your Google Drive folder, passports, tickets and confirmations so they’re one tap away.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {docs.map((d) => (
            <DocumentRow key={d.id} doc={d} context={d.reservation_id ? titles.get(d.reservation_id) : null} />
          ))}
        </ul>
      )}
      {more > 0 ? (
        <Link
          href={`/trips/${trip.id}/bookings#documents`}
          className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-earth-ink"
        >
          {more} more <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Packing — progress from the saved checklist                         */
/* ------------------------------------------------------------------ */

export function PackingCard({
  tripId,
  categories,
  wide,
  className,
}: {
  tripId: string;
  categories: PackingCategoryWithItems[];
  /** Full row (no notes card beside it). */
  wide: boolean;
  className?: string;
}) {
  const p = progressOf(categories.flatMap((c) => c.items));
  const href = `/trips/${tripId}/packing`;
  const left = categories
    .map((c) => ({ name: c.name, n: c.items.filter((i) => !i.is_packed).length }))
    .filter((c) => c.n > 0)
    .slice(0, 3);

  return (
    <article className={cn("card-surface relative p-6 md:col-span-2", wide ? "lg:col-span-12" : "lg:col-span-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <CardEyebrow icon={Luggage}>Packing</CardEyebrow>
        {p.total > 0 ? <ArrowRight className="size-4 text-moss-ink" aria-hidden="true" /> : null}
      </div>
      {p.total === 0 ? (
        <div className={cn("mt-4 flex flex-col items-start gap-4", wide && "sm:flex-row sm:items-center sm:justify-between")}>
          <p className="text-sm text-muted-foreground">
            {categories.length ? "Your categories are ready — add what to bring." : "One checklist for everyone, ticked off as you go."}
          </p>
          <Link href={href} className={cn(outlineButton, "after:absolute after:inset-0 after:rounded-2xl")}>
            <Plus className="size-4" aria-hidden="true" /> Start packing list
          </Link>
        </div>
      ) : (
        <div className={cn("mt-4", wide && "sm:flex sm:items-end sm:justify-between sm:gap-8")}>
          <div className={cn(wide && "sm:max-w-md sm:flex-1")}>
            <p className="font-display text-[1.75rem] leading-tight font-semibold text-ink">
              {p.remaining === 0 ? "All packed" : `${p.packed} of ${p.total} packed`}
            </p>
            <span className="mt-3 block h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
              <span className="block h-full rounded-full bg-moss-ink" style={{ width: `${p.percent}%` }} />
            </span>
            <p className="mt-2 text-sm text-muted-foreground">
              {p.percent}%{p.remaining ? ` · ${p.remaining} still to pack` : " · every item checked off"}
            </p>
          </div>
          {left.length ? (
            <p className="mt-3 truncate text-sm text-ink sm:mt-0">
              {left.map((c) => `${c.name} ${c.n}`).join(" · ")}
            </p>
          ) : null}
          <Link href={href} className="after:absolute after:inset-0 after:rounded-2xl focus-ring rounded-sm">
            <span className="sr-only">
              Open packing list — {p.packed} of {p.total} packed
            </span>
          </Link>
        </div>
      )}
    </article>
  );
}

export function NotesCard({ notes, beside, className }: { notes: string; beside?: boolean; className?: string }) {
  return (
    <article className={cn("card-surface p-6 md:col-span-2", beside ? "lg:col-span-8" : "lg:col-span-12", className)}>
      <p className="eyebrow text-ink">Trip notes</p>
      <p className="mt-3 max-w-3xl leading-relaxed whitespace-pre-line text-muted-foreground">{notes}</p>
    </article>
  );
}

export function BookingSummaryRow({ booking: b }: { booking: Reservation }) {
  const place = placeSummary(b);
  return (
    <div className="card-surface flex items-center gap-2 p-2 pr-2 sm:pr-3">
      <ViewBookingButton
        bookingId={b.id}
        className="focus-ring group flex min-h-16 min-w-0 flex-1 items-center gap-3.5 rounded-xl p-2 text-left"
      >
        <BookingIcon kind={b.kind} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {BOOKING_KIND_META[b.kind].label}
            {b.start_time ? ` · ${formatMoment(b.start_date, b.start_time, true, b.start_time_zone)?.split(" · ")[1]}` : ""}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("min-w-0 font-semibold break-words text-ink group-hover:text-moss-ink", b.status === "cancelled" && "text-muted-foreground line-through")}>
              {b.title}
            </span>
            {b.status === "cancelled" ? (
              <span className="shrink-0 rounded-full bg-[#fff1ee] px-2 py-0.5 text-xs font-semibold text-[#8c2b1f]">Cancelled</span>
            ) : null}
          </span>
          {place || b.provider ? (
            <span className="flex items-center gap-1 truncate text-sm text-muted-foreground">
              {place ? <MapPin className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{[place, b.provider].filter(Boolean).join(" · ")}</span>
            </span>
          ) : null}
          {b.confirmation_code ? (
            <span className="mt-0.5 block font-mono text-xs font-semibold tracking-wider text-ink sm:hidden">
              Conf. {b.confirmation_code}
            </span>
          ) : null}
        </span>
      </ViewBookingButton>
      {b.confirmation_code ? (
        <div className="hidden items-center gap-1 sm:flex">
          <span className="rounded-lg bg-gold-soft px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-ink">
            {b.confirmation_code}
          </span>
          <CopyButton value={b.confirmation_code} label="Confirmation number" />
        </div>
      ) : (
        <span className="hidden text-xs text-muted-foreground sm:block">No confirmation #</span>
      )}
    </div>
  );
}
