import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BedDouble, FileText, MapPin, Plane, Plus } from "lucide-react";
import { BOOKING_KIND_META } from "@/lib/booking-kinds";
import { formatMoment, looksLikeCode, placeSummary, stayNights, upcomingFirst } from "@/lib/booking-format";
import { getCover } from "@/lib/covers";
import { formatDayDate, formatTime, tripLengthDays } from "@/lib/dates";
import type { Booking, DocumentLink, TripWithDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BookingIcon } from "./booking-icon";
import { CopyButton } from "./copy-button";
import { DocumentRow } from "./document-row";
import { AddBookingButton, AddDocumentButton, ViewBookingButton } from "./trip-workspace";

const linkButton =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 -mr-2 text-sm font-semibold text-teal-ink hover:bg-teal-soft/60";

const outlineButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-teal-ink px-5 text-[0.9375rem] font-semibold text-teal-ink transition-colors hover:bg-teal-soft";

function CardEyebrow({ icon: Icon, children }: { icon: typeof Plane; children: React.ReactNode }) {
  return (
    <p className="eyebrow flex items-center gap-2 text-ink">
      <Icon className="size-4 text-teal" aria-hidden="true" />
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
  align = "left",
  fallback,
}: {
  date: string | null;
  time: string | null;
  align?: "left" | "right";
  fallback?: string;
}) {
  return (
    <p className={cn("text-[0.9375rem] leading-relaxed text-muted-foreground", align === "right" && "text-right")}>
      {date ? (
        <>
          {formatDayDate(date)}
          {time ? <span className="block font-medium text-ink">{formatTime(time)}</span> : null}
        </>
      ) : (
        fallback
      )}
    </p>
  );
}

export function FlightCard({ trip, today }: { trip: TripWithDetails; today: string }) {
  const flights = trip.bookings.filter((b) => b.kind === "flight");
  const flight = upcomingFirst(flights, today);

  if (!flight) {
    return (
      <article className="card-surface flex flex-col p-6 md:col-span-1 lg:col-span-5">
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

  const departs = formatMoment(flight.start_date, flight.start_time);
  const hasRoute = Boolean(flight.origin || flight.destination);

  return (
    <article className="card-surface relative flex flex-col p-6 md:col-span-1 lg:col-span-5">
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
          <div className="flex items-center gap-2 pt-4 text-teal-ink" aria-hidden="true">
            <span className="hidden w-10 border-t-2 border-dotted border-[#b7c4c9] sm:block lg:w-6 xl:w-12" />
            <Plane className="size-6" />
            <span className="hidden w-10 border-t-2 border-dotted border-[#b7c4c9] sm:block lg:w-6 xl:w-12" />
          </div>
          <div className="min-w-0">
            <Airport value={flight.destination} align="right" />
          </div>
          <FlightMoment date={flight.start_date} time={flight.start_time} fallback="Departure not set" />
          <span aria-hidden="true" />
          <FlightMoment date={flight.end_date} time={flight.end_time} align="right" />
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
          <p className="truncate font-semibold text-ink">{flight.provider ?? flight.title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {flight.provider ? flight.title : BOOKING_KIND_META.flight.label}
          </p>
        </div>
        {flight.confirmation_code ? (
          <div className="flex items-center gap-1 rounded-xl bg-sun py-1 pr-1 pl-3.5">
            <div>
              <p className="text-[0.6875rem] font-semibold tracking-wider text-[#6b5200] uppercase">Confirmation</p>
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

export function StayCard({ trip, today }: { trip: TripWithDetails; today: string }) {
  const stays = trip.bookings.filter((b) => b.kind === "lodging");
  const stay = upcomingFirst(stays, today);

  if (!stay) {
    return (
      <article className="card-surface flex flex-col bg-[#f2f8f8] p-6 md:col-span-1 lg:col-span-4">
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
    <article className="group relative isolate flex min-h-[19rem] flex-col justify-between overflow-hidden rounded-2xl bg-[#0b2a3a] p-5 text-white md:col-span-1 lg:col-span-4">
      <Image src={cover.image} alt="" fill sizes="(min-width: 1024px) 420px, (min-width: 768px) 50vw, 100vw" className="-z-10 object-cover" style={{ objectPosition: cover.position }} />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#08263a]/85 via-[#08263a]/20 to-[#08263a]/10" />

      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-ink">
          <BedDouble className="size-4 text-teal-ink" aria-hidden="true" />
          Stay{stays.length > 1 ? ` · ${stays.length}` : ""}
        </p>
        <ViewBookingButton
          bookingId={stay.id}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-sm font-semibold text-teal-ink hover:bg-white"
        >
          View stay <ArrowRight className="size-4" aria-hidden="true" />
        </ViewBookingButton>
      </div>

      <div>
        <h2 className="font-display text-[1.75rem] leading-tight font-semibold drop-shadow-sm">{stay.title}</h2>
        {sub ? <p className="mt-1 text-[0.9375rem] text-white/90">{sub}</p> : null}
        {stay.start_date ? (
          <p className="mt-1 text-sm text-white/80">Check-in {formatMoment(stay.start_date, stay.start_time, true)}</p>
        ) : null}
        <p className="mt-3 text-[0.6875rem] text-white/65">Illustrative destination photo</p>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* At a glance — pale yellow                                           */
/* ------------------------------------------------------------------ */

export function GlanceCard({ trip }: { trip: TripWithDetails }) {
  const bookings = trip.bookings.length;
  const docs = trip.document_links.length;
  const days = tripLengthDays(trip.start_date, trip.end_date);
  const missingCodes = trip.bookings.filter((b) => !b.confirmation_code).length;

  const headline =
    bookings === 0 ? "Let’s gather the details." : missingCodes > 0 ? "Nearly organized." : "All booked and noted.";

  return (
    <article className="flex flex-col rounded-2xl bg-sun p-6 md:col-span-2 lg:col-span-3">
      <p className="eyebrow text-[#6b5200]">At a glance</p>
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
              <span className="text-xs text-[#5a4a10]">{s.label}</span>
            </dd>
          </div>
        ))}
      </dl>
      {bookings > 0 && missingCodes > 0 ? (
        <p className="mt-4 text-sm text-[#5a4a10]">
          {missingCodes === 1 ? "1 booking is" : `${missingCodes} bookings are`} missing a confirmation number.
        </p>
      ) : null}
      <div className="mt-auto pt-6">
        <AddBookingButton className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-coral px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(204,69,51,0.7)] transition-colors hover:bg-coral-hover">
          <Plus className="size-4" aria-hidden="true" /> Add a booking
        </AddBookingButton>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Reservations timeline                                               */
/* ------------------------------------------------------------------ */

export function ReservationsCard({ trip, today }: { trip: TripWithDetails; today: string }) {
  const dated = trip.bookings.filter((b) => b.start_date);
  const upcoming = dated.filter((b) => (b.end_date ?? b.start_date)! >= today);
  const list: Booking[] = (upcoming.length > 0 ? upcoming : dated).slice(0, 3);
  const title = upcoming.length > 0 ? "Coming up" : dated.length > 0 ? "Your reservations" : "Reservations";

  return (
    <article className="card-surface p-6 md:col-span-2 lg:col-span-8">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-ink">{title}</p>
        <Link href={`/trips/${trip.id}/bookings`} className={linkButton}>
          View all bookings <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="mt-5 flex flex-col items-start gap-4 rounded-xl border border-dashed border-input p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {trip.bookings.length > 0
              ? "Add dates to your bookings to see them in order here."
              : "Restaurants, tours, car rentals — anything with a confirmation belongs here."}
          </p>
          <AddBookingButton kind="activity" className={outlineButton}>
            <Plus className="size-4" aria-hidden="true" /> Add a booking
          </AddBookingButton>
        </div>
      ) : (
        <ol className="mt-5 grid gap-x-6 gap-y-5 md:grid-cols-3">
          {list.map((b, i) => (
            <li key={b.id} className="relative">
              <ViewBookingButton
                bookingId={b.id}
                className="focus-ring group flex w-full items-start gap-3 rounded-xl p-1 text-left hover:bg-secondary/60"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-teal-ink text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink group-hover:text-teal-ink">{b.title}</span>
                  <span className="mt-0.5 block text-sm text-ink">{formatMoment(b.start_date, b.start_time, true)}</span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {BOOKING_KIND_META[b.kind].label}
                    {placeSummary(b) ? ` · ${placeSummary(b)}` : ""}
                  </span>
                </span>
              </ViewBookingButton>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Travel documents — pale lavender                                    */
/* ------------------------------------------------------------------ */

export function DocumentsCard({ trip, limit = 4 }: { trip: TripWithDetails; limit?: number }) {
  const titles = new Map(trip.bookings.map((b) => [b.id, b.title]));
  const docs: DocumentLink[] = trip.document_links.slice(0, limit);
  const more = trip.document_links.length - docs.length;

  return (
    <article className="rounded-2xl bg-lavender p-5 sm:p-6 md:col-span-2 lg:col-span-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2 text-lavender-ink">
          <FileText className="size-4" aria-hidden="true" /> Travel documents
        </p>
        <AddDocumentButton className="focus-ring -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-lavender-ink hover:bg-white/60">
          <Plus className="size-4" aria-hidden="true" /> Add link
        </AddDocumentButton>
      </div>
      {docs.length === 0 ? (
        <div className="mt-4 rounded-xl bg-white/70 p-4 text-sm text-[#4f4a63]">
          Link your Google Drive folder, passports, tickets and confirmations so they’re one tap away.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {docs.map((d) => (
            <DocumentRow key={d.id} doc={d} context={d.booking_id ? titles.get(d.booking_id) : null} />
          ))}
        </ul>
      )}
      {more > 0 ? (
        <Link
          href={`/trips/${trip.id}/bookings#documents`}
          className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-lavender-ink"
        >
          {more} more <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}

export function NotesCard({ notes }: { notes: string }) {
  return (
    <article className="card-surface p-6 md:col-span-2 lg:col-span-12">
      <p className="eyebrow text-ink">Trip notes</p>
      <p className="mt-3 max-w-3xl leading-relaxed whitespace-pre-line text-muted-foreground">{notes}</p>
    </article>
  );
}

export function BookingSummaryRow({ booking: b }: { booking: Booking }) {
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
            {b.start_time ? ` · ${formatMoment(b.start_date, b.start_time, true)?.split(" · ")[1]}` : ""}
          </span>
          <span className="block truncate font-semibold text-ink group-hover:text-teal-ink">{b.title}</span>
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
          <span className="rounded-lg bg-sun px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-ink">
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
