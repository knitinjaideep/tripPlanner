import Image from "next/image";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, Eye, EyeOff, Plus } from "lucide-react";
import { MascotImage } from "@/components/mascot";
import { getCover } from "@/lib/covers";
import { formatDayDate, formatShortDay, parseDate, todayInTimeZone } from "@/lib/dates";
import { itineraryHref } from "@/lib/itinerary-format";
import { PLANS } from "@/lib/plans/aruba-2026";
import { planApplied, planDayTheme, planMatchesTrip, planPreview } from "@/lib/plans/itinerary-plan";
import { buildAgenda, defaultItineraryDay } from "@/lib/schedule";
import type { ItineraryEntry, PlaceWithVisits, TripWithDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DayStrip } from "./day-strip";
import { DayTimeline } from "./day-timeline";
import { EntryCard } from "./entry-card";
import { ExplorePanel } from "./explore-panel";
import { AddActivityButton, ItineraryWorkspace } from "./itinerary-workspace";
import { PlanUpdateCard } from "./plan-update";
import type { TripDayOption } from "./types";

const navButton =
  "focus-ring grid size-11 place-items-center rounded-xl border border-border bg-surface text-ink hover:bg-secondary";

/** The Itinerary tab for one trip; the selected day comes from `?day=`. */
export function ItineraryView({
  trip,
  items,
  places,
  query,
}: {
  trip: TripWithDetails;
  items: ItineraryEntry[];
  places: PlaceWithVisits[];
  query: { day?: string | string[]; cancelled?: string | string[] };
}) {
  const showCancelled = query.cancelled === "1";
  // "Today" is where the trip happens, not where the viewer is.
  const today = todayInTimeZone(trip.time_zone);
  const agenda = buildAgenda({
    items,
    reservations: trip.reservations,
    tripStart: trip.start_date,
    tripEnd: trip.end_date,
    includeCancelled: showCancelled,
  });
  // ?day= must be a trip day; anything else falls back to today / day 1.
  const requested = agenda.days.findIndex((d) => d.date === query.day);
  const fallback = defaultItineraryDay(trip.start_date, trip.end_date, today);
  const selectedIndex = requested >= 0 ? requested : agenda.days.findIndex((d) => d.date === fallback);
  const day = agenda.days[selectedIndex];
  const prev = agenda.days[selectedIndex - 1];
  const next = agenda.days[selectedIndex + 1];

  const dayOptions: TripDayOption[] = agenda.days.map((d) => ({
    date: d.date,
    dayNumber: d.dayNumber!,
    label: `Day ${d.dayNumber} · ${formatShortDay(d.date)}`,
  }));
  const outsideCount = agenda.outside.reduce((n, d) => n + d.entries.length, 0) + agenda.unscheduled.length;
  const dayLabel = `Day ${day.dayNumber}`;
  const cover = getCover(trip.cover_image);
  // A saved plan that fits this trip (by destination). The preview here is
  // read-only and only decides how prominent the "Update" card is.
  const plan = PLANS.find((p) => planMatchesTrip(p, trip)) ?? null;
  const planCounts = plan
    ? planPreview({ plan, trip, rows: items, places, reservations: trip.reservations }).counts
    : null;
  const theme = plan && planApplied(plan, items) ? planDayTheme(plan, day.date) : null;
  const explorePlaces = places.map(
    ({ id, name, kind, category, priority, address, maps_url, visit_count, planned_count, completed_count }) => ({
      id, name, kind, category, priority, address, maps_url, visit_count, planned_count, completed_count,
    }),
  );

  return (
    <ItineraryWorkspace
      tripId={trip.id}
      tripTimeZone={trip.time_zone}
      selectedDate={day.date}
      showCancelled={showCancelled}
      days={dayOptions}
      places={explorePlaces}
      bookings={trip.reservations}
      linkedBookingIds={items.flatMap((i) => (i.reservation_id ? [i.reservation_id] : []))}
    >
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {outsideCount > 0 ? (
            <details open className="group rounded-2xl border border-gold/60 bg-gold-soft/50 p-4 sm:p-5">
              <summary className="focus-ring flex cursor-pointer list-none items-start gap-3 rounded-lg [&::-webkit-details-marker]:hidden">
                <CalendarClock className="mt-0.5 size-5 shrink-0 text-gold-ink" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">
                    Outside trip dates · {outsideCount} {outsideCount === 1 ? "plan" : "plans"}
                  </span>
                  <span className="block text-sm text-gold-ink">
                    These fall before or after the trip — nothing was removed. Move them onto a trip day, or adjust the dates.
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-5 shrink-0 text-gold-ink transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <div className="mt-4 space-y-5">
                {agenda.outside.map((d) => (
                  <section key={d.date} aria-label={formatDayDate(d.date)}>
                    <h3 className="mb-2 text-sm font-semibold text-ink">
                      {formatDayDate(d.date)}
                      <span className="font-normal text-muted-foreground">
                        {" "}· {d.date < trip.start_date ? "before the trip" : "after the trip"}
                      </span>
                    </h3>
                    <ul className="space-y-3">
                      {d.entries.map((e) => (
                        <li key={e.key}>
                          <EntryCard entry={e} variant="outside" />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {agenda.unscheduled.length > 0 ? (
                  <section aria-label="No date">
                    <h3 className="mb-2 text-sm font-semibold text-ink">No date</h3>
                    <ul className="space-y-3">
                      {agenda.unscheduled.map((e) => (
                        <li key={e.key}>
                          <EntryCard entry={e} variant="outside" />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </details>
          ) : null}

          {plan && planCounts ? (
            <PlanUpdateCard tripId={trip.id} planId={plan.id} label={plan.label} pending={planCounts} />
          ) : null}

          {/* Scenic backdrop (the trip's cover) behind an ivory panel; text never sits on the photo. */}
          <section aria-label="Choose a day" className="relative isolate overflow-hidden rounded-3xl bg-forest">
            <Image
              src={cover.image}
              alt=""
              fill
              sizes="(min-width: 1024px) 860px, 100vw"
              className="-z-20 object-cover"
              style={{ objectPosition: cover.position }}
            />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-[#183a2f]/5 via-[#183a2f]/20 to-[#183a2f]/45" />
            <div className="px-2.5 pt-14 pb-2.5 sm:px-4 sm:pt-20 sm:pb-4">
              <div className="space-y-5 rounded-2xl border border-white/60 bg-background/95 p-3.5 shadow-[0_18px_40px_-24px_rgba(24,58,47,0.55)] backdrop-blur-sm sm:p-5">
                <DayStrip
                  tripId={trip.id}
                  days={agenda.days.map((d) => ({
                    date: d.date,
                    dayNumber: d.dayNumber!,
                    count: d.entries.filter((e) => !e.cancelled).length,
                  }))}
                  selected={day.date}
                  today={today}
                  showCancelled={showCancelled}
                />

                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <MascotImage size="sm" decorative className="size-16 sm:size-20" />
                    <div className="min-w-0">
                      <p className="eyebrow text-muted-foreground">
                        Day {day.dayNumber} of {agenda.days.length}
                        {day.date === today ? <span className="text-coral"> · Today</span> : null}
                      </p>
                      <h2 className="font-display mt-1 text-[1.75rem] leading-tight font-semibold text-ink sm:text-3xl">
                        {format(parseDate(day.date), "EEEE, MMMM d")}
                      </h2>
                      {theme ? <p className="mt-0.5 font-medium text-gold-ink">{theme}</p> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {prev ? (
                      <Link href={itineraryHref(trip.id, prev.date, showCancelled)} scroll={false} aria-label={`Previous day, Day ${prev.dayNumber}`} className={navButton}>
                        <ChevronLeft className="size-5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-hidden="true" className={cn(navButton, "pointer-events-none opacity-40")}>
                        <ChevronLeft className="size-5" />
                      </span>
                    )}
                    {next ? (
                      <Link href={itineraryHref(trip.id, next.date, showCancelled)} scroll={false} aria-label={`Next day, Day ${next.dayNumber}`} className={navButton}>
                        <ChevronRight className="size-5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-hidden="true" className={cn(navButton, "pointer-events-none opacity-40")}>
                        <ChevronRight className="size-5" />
                      </span>
                    )}
                    <AddActivityButton className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-moss-ink px-4 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover sm:px-5">
                      <Plus className="size-4" aria-hidden="true" /> Add activity
                    </AddActivityButton>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {agenda.hiddenCancelled > 0 || showCancelled ? (
            <Link
              href={itineraryHref(trip.id, day.date, !showCancelled)}
              scroll={false}
              className="focus-ring -mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-muted-foreground hover:text-ink"
            >
              {showCancelled ? (
                <>
                  <EyeOff className="size-4" aria-hidden="true" /> Hide cancelled bookings
                </>
              ) : (
                <>
                  <Eye className="size-4" aria-hidden="true" /> Show {agenda.hiddenCancelled} cancelled{" "}
                  {agenda.hiddenCancelled === 1 ? "booking" : "bookings"}
                </>
              )}
            </Link>
          ) : null}

          <DayTimeline entries={day.entries} />
        </div>

        <aside className="lg:col-span-4">
          <div className="space-y-5 lg:sticky lg:top-24">
            <ExplorePanel places={explorePlaces} dayLabel={dayLabel} />
          </div>
        </aside>
      </div>
    </ItineraryWorkspace>
  );
}
