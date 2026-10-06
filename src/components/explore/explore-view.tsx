import Link from "next/link";
import { Compass, Plus } from "lucide-react";
import type { TripDayOption } from "@/components/itinerary/types";
import { formatShortDay, todayInTimeZone } from "@/lib/dates";
import { exploreHref, filterPlaces, parseExploreFilters } from "@/lib/explore";
import { datesBetween, previewDay } from "@/lib/schedule";
import type { ItineraryEntry, PlaceWithVisits, Trip } from "@/lib/types";
import { AddPlaceButton, ExploreWorkspace } from "./explore-workspace";
import { ExploreToolbar } from "./explore-toolbar";
import { PlaceCard } from "./place-card";
import { PlaceDetailSheet, type DetailAction } from "./place-detail";

type Query = Record<string, string | string[] | undefined>;

const addButton =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(204,69,51,0.7)] transition-colors hover:bg-coral-hover";

/** The Explore tab: the traveler's own list of places and food for this trip. */
export function ExploreView({
  trip,
  places,
  items,
  query,
}: {
  trip: Trip;
  places: PlaceWithVisits[];
  items: ItineraryEntry[];
  query: Query;
}) {
  const filters = parseExploreFilters(query);
  const shown = filterPlaces(places, filters);
  const counts = {
    all: filterPlaces(places, { ...filters, kind: "all" }).length,
    place: filterPlaces(places, { ...filters, kind: "place" }).length,
    food: filterPlaces(places, { ...filters, kind: "food" }).length,
  };
  const open = typeof query.place === "string" ? places.find((p) => p.id === query.place) : undefined;
  const action: DetailAction = query.action === "schedule" || query.action === "record" ? query.action : null;
  const days: TripDayOption[] = datesBetween(trip.start_date, trip.end_date).map((date, i) => ({
    date,
    dayNumber: i + 1,
    label: `Day ${i + 1} · ${formatShortDay(date)}`,
  }));
  // Today where the trip happens, kept inside the trip's dates.
  const defaultDate = previewDay(trip.start_date, trip.end_date, todayInTimeZone(trip.time_zone));

  return (
    <ExploreWorkspace tripId={trip.id} places={places} filters={filters}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink">Explore</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {places.length === 0
                ? "Your own list of places and food to try."
                : `${places.length} saved — your own finds, from friends, articles and maps.`}
            </p>
          </div>
          <AddPlaceButton className={addButton}>
            <Plus className="size-4" aria-hidden="true" /> Add place
          </AddPlaceButton>
        </div>

        {places.length === 0 ? (
          <div className="card-surface px-6 py-12 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-[#d9f1f3] to-[#fff3ca] text-teal-ink">
              <Compass className="size-7" aria-hidden="true" />
            </span>
            <h3 className="font-display mt-4 text-2xl font-semibold text-ink">Start your list</h3>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              The beach a friend raved about, the bakery from that article, the viewpoint you pinned months ago —
              save them here, then drop them into a day when you’re ready.
            </p>
            <AddPlaceButton className={`${addButton} mt-6`}>
              <Plus className="size-4" aria-hidden="true" /> Add your first place
            </AddPlaceButton>
          </div>
        ) : (
          <>
            <ExploreToolbar tripId={trip.id} filters={filters} counts={counts} />
            {shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-input px-6 py-10 text-center">
                <p className="font-semibold text-ink">No places match these filters.</p>
                <Link
                  href={exploreHref(trip.id, {})}
                  scroll={false}
                  className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-teal-ink hover:bg-teal-soft/60"
                >
                  Clear filters
                </Link>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${shown.length} places`}>
                {shown.map((p) => (
                  <li key={p.id} className="flex">
                    <PlaceCard
                      place={p}
                      tripStart={trip.start_date}
                      detailHref={exploreHref(trip.id, filters, p.id)}
                      actionHref={(a) => `${exploreHref(trip.id, filters, p.id)}&action=${a}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {open ? (
        <PlaceDetailSheet
          place={open}
          visits={items.filter((i) => i.place_id === open.id)}
          days={days}
          defaultDate={defaultDate}
          initialAction={action}
          closeHref={exploreHref(trip.id, filters)}
        />
      ) : null}
    </ExploreWorkspace>
  );
}
