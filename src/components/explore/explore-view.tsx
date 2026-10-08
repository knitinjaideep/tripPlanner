import Link from "next/link";
import { Plus } from "lucide-react";
import { MascotEmptyState } from "@/components/mascot";
import type { TripDayOption } from "@/components/itinerary/types";
import { formatShortDay, todayInTimeZone } from "@/lib/dates";
import {
  EXPLORE_FLAGS,
  exploreHref,
  filterPlaces,
  matchesFlag,
  parseExploreFilters,
  sortPlaces,
  type ExploreFlag,
} from "@/lib/explore";
import { datesBetween, previewDay } from "@/lib/schedule";
import type { ItineraryEntry, PlaceWithVisits, TripWithDetails } from "@/lib/types";
import { CollectionImportCard, type CollectionOffer } from "./collection-import";
import { AddPlaceButton, ExploreWorkspace } from "./explore-workspace";
import { ExploreToolbar } from "./explore-toolbar";
import { PlaceCard } from "./place-card";
import type { PollView } from "@/lib/polls";
import { PlaceDetailSheet, type DetailAction } from "./place-detail";

type Query = Record<string, string | string[] | undefined>;

const addButton =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover";

/**
 * The Explore tab: the traveler's own list of places and food for this
 * trip, plus any curated collection that fits it (added only on request).
 */
export function ExploreView({
  trip,
  places,
  items,
  collections,
  polls,
  query,
}: {
  trip: TripWithDetails;
  places: PlaceWithVisits[];
  items: ItineraryEntry[];
  collections: CollectionOffer[];
  polls: PollView[];
  query: Query;
}) {
  const filters = parseExploreFilters(query);
  const shown = sortPlaces(filterPlaces(places, filters));
  const counts = {
    all: filterPlaces(places, { ...filters, kind: "all" }).length,
    place: filterPlaces(places, { ...filters, kind: "place" }).length,
    food: filterPlaces(places, { ...filters, kind: "food" }).length,
    spa: filterPlaces(places, { ...filters, kind: "spa" }).length,
  };
  const flagCounts = Object.fromEntries(
    EXPLORE_FLAGS.map((f) => [f, places.filter((p) => matchesFlag(p, f)).length]),
  ) as Record<ExploreFlag, number>;
  const placeLabel = places.some((p) => p.category === "beach") ? "Beaches & outings" : "Places";
  const collection = collections[0] ?? null;
  const presentKeys = places.map((p) => p.source_key).filter((k): k is string => Boolean(k));
  const open = typeof query.place === "string" ? places.find((p) => p.id === query.place) : undefined;
  const action: DetailAction = query.action === "schedule" || query.action === "record" ? query.action : null;
  const days: TripDayOption[] = datesBetween(trip.start_date, trip.end_date).map((date, i) => ({
    date,
    dayNumber: i + 1,
    label: `Day ${i + 1} · ${formatShortDay(date)}`,
  }));
  // Today where the trip happens, kept inside the trip's dates.
  // `?day=` (from "Use this choice" on a poll) pre-selects that trip day; anything else falls back to today.
  const requestedDay = typeof query.day === "string" && days.some((d) => d.date === query.day) ? query.day : null;
  const defaultDate = requestedDay ?? previewDay(trip.start_date, trip.end_date, todayInTimeZone(trip.time_zone));

  return (
    <ExploreWorkspace tripId={trip.id} places={places} filters={filters}>
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink">{collection?.heading ?? "Explore"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {collection
                ? collection.subheading
                : places.length === 0
                  ? "Your own list of places and food to try."
                  : `${places.length} saved — your own finds, from friends, articles and maps.`}
            </p>
          </div>
          <AddPlaceButton className={addButton}>
            <Plus className="size-4" aria-hidden="true" /> Add place
          </AddPlaceButton>
        </div>

        {collection ? (
          <CollectionImportCard tripId={trip.id} tripTitle={trip.title} offer={collection} presentKeys={presentKeys} />
        ) : null}

        {places.length === 0 ? (
          <MascotEmptyState
            title="Start your list"
            description={
              collection
                ? `Add the ${collection.label.toLowerCase()} above, or save your own finds — the beach a friend raved about, the bakery from that article.`
                : "The beach a friend raved about, the bakery from that article, the viewpoint you pinned months ago — save them here, then drop them into a day when you’re ready."
            }
            action={
              <AddPlaceButton className={addButton}>
                <Plus className="size-4" aria-hidden="true" /> Add your first place
              </AddPlaceButton>
            }
          />
        ) : (
          <>
            <ExploreToolbar
              tripId={trip.id}
              filters={filters}
              counts={counts}
              flagCounts={flagCounts}
              placeLabel={placeLabel}
            />
            {shown.length === 0 ? (
              <MascotEmptyState
                tone="quiet"
                title="No matching places found"
                description="Try a different search or filter — or clear them to see everything you’ve saved."
                action={
                  <Link
                    href={exploreHref(trip.id, {})}
                    scroll={false}
                    className="focus-ring inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
                  >
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${shown.length} places`}>
                {shown.map((p) => (
                  <li key={p.id} className="flex">
                    <PlaceCard
                      tripId={trip.id}
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
          trip={{ start: trip.start_date, end: trip.end_date, timeZone: trip.time_zone }}
          items={items}
          reservations={trip.reservations}
          days={days}
          defaultDate={defaultDate}
          polls={polls.filter((p) => p.parent.type === "place" && p.parent.place?.id === open.id)}
          pollPlaces={places.map((p) => ({ id: p.id, name: p.name }))}
          initialAction={action}
          closeHref={exploreHref(trip.id, filters)}
        />
      ) : null}
    </ExploreWorkspace>
  );
}
