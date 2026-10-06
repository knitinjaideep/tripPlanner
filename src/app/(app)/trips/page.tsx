import type { Metadata } from "next";
import Image from "next/image";
import { NewTripButton } from "@/components/new-trip-button";
import { FlashToast } from "@/components/flash-toast";
import { TripCard } from "@/components/trip-card";
import { listTripsForUser } from "@/lib/dal";
import { getCover } from "@/lib/covers";
import { hourInTimeZone, todayInTimeZone, tripPhase } from "@/lib/dates";
import { getViewerTimeZone } from "@/lib/timezone";
import { requireUser } from "@/lib/dal";
import type { Trip } from "@/lib/types";

export const metadata: Metadata = { title: "My trips" };

function greeting(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function TripGroup({
  title,
  description,
  trips,
  today,
  priorityFirst = false,
}: {
  title: string;
  description: string;
  trips: { trip: Trip; phase: ReturnType<typeof tripPhase> }[];
  today: string;
  priorityFirst?: boolean;
}) {
  if (trips.length === 0) return null;
  const id = `group-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 id={id} className="font-display text-2xl font-semibold text-ink sm:text-[1.75rem]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {trips.map(({ trip, phase }, i) => (
          <TripCard key={trip.id} trip={trip} phase={phase} today={today} priority={priorityFirst && i === 0} />
        ))}
      </div>
    </section>
  );
}

export default async function TripsPage({ searchParams }: PageProps<"/trips">) {
  const [user, trips, timeZone, params] = await Promise.all([
    requireUser(),
    listTripsForUser(),
    getViewerTimeZone(),
    searchParams,
  ]);
  const today = todayInTimeZone(timeZone);
  const withPhase = trips.map((trip) => ({ trip, phase: tripPhase(trip.start_date, trip.end_date, today) }));
  const current = withPhase.filter((t) => t.phase === "current");
  const upcoming = withPhase.filter((t) => t.phase === "upcoming");
  const past = withPhase.filter((t) => t.phase === "past").reverse();

  const summary =
    trips.length === 0
      ? "Let’s plan something to look forward to."
      : current.length > 0
        ? "You’re on the road — everything you need is right here."
        : upcoming.length > 0
          ? `${upcoming.length} ${upcoming.length === 1 ? "trip" : "trips"} on the horizon.`
          : "All caught up. Where to next?";

  return (
    <main className="mx-auto max-w-[1280px] px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:px-8">
      {params.deleted ? <FlashToast message="Trip deleted." /> : null}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-teal-ink">My trips</p>
          <h1 className="font-display mt-2 text-4xl leading-[1.05] font-semibold text-ink sm:text-5xl">
            {greeting(hourInTimeZone(timeZone))}, {user.firstName}.
          </h1>
          <p className="mt-3 text-[1.0625rem] text-muted-foreground">{summary}</p>
        </div>
        {trips.length > 0 ? <NewTripButton /> : null}
      </div>

      {trips.length === 0 ? (
        <EmptyTrips />
      ) : (
        <div className="mt-10 space-y-14">
          <TripGroup
            title="Happening now"
            description="Enjoy it. Your bookings are a tap away."
            trips={current}
            today={today}
            priorityFirst
          />
          <TripGroup
            title="Upcoming"
            description="Soonest first."
            trips={upcoming}
            today={today}
            priorityFirst={current.length === 0}
          />
          <TripGroup title="Past trips" description="Most recent first." trips={past} today={today} />
        </div>
      )}
    </main>
  );
}

function EmptyTrips() {
  const cover = getCover("coast");
  return (
    <section className="card-surface mt-10 grid overflow-hidden md:grid-cols-[1.1fr_1fr]">
      <div className="relative min-h-56 md:min-h-[22rem]">
        <Image
          src={cover.image}
          alt={cover.alt}
          fill
          loading="eager"
          fetchPriority="high"
          placeholder="blur"
          sizes="(min-width: 768px) 640px, 100vw"
          className="object-cover"
          style={{ objectPosition: cover.position }}
        />
      </div>
      <div className="flex flex-col justify-center gap-4 p-6 sm:p-10">
        <p className="eyebrow text-teal-ink">Your first trip</p>
        <h2 className="font-display text-3xl leading-tight font-semibold text-ink">Where are you headed?</h2>
        <p className="text-muted-foreground">
          Create a trip, then add the flights, stays and reservations you’ve booked — with confirmation numbers
          and Drive links kept right beside them.
        </p>
        <div>
          <NewTripButton label="Create your first trip" />
        </div>
      </div>
    </section>
  );
}
