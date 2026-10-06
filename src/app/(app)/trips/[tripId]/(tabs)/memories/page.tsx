import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoriesView } from "@/components/memories/memories-view";
import { getItineraryForUser, getMemoriesForUser, getTripForUser } from "@/lib/dal";
import { todayInTimeZone } from "@/lib/dates";
import { journalPhase } from "@/lib/memories";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/memories">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Memories · ${trip.title}` : "Memories" };
}

export default async function MemoriesPage({ params, searchParams }: PageProps<"/trips/[tripId]/memories">) {
  const { tripId } = await params;
  const query = await searchParams;
  const [trip, memories, items] = await Promise.all([
    getTripForUser(tripId),
    getMemoriesForUser(tripId),
    getItineraryForUser(tripId),
  ]);
  if (!trip || !memories || !items) notFound();
  // "During the trip" is judged where the trip happens.
  const today = todayInTimeZone(trip.time_zone);

  return (
    <MemoriesView
      trip={trip}
      memory={memories.memory}
      visits={memories.visits}
      items={items}
      phase={journalPhase(trip.start_date, trip.end_date, today)}
      todayInTripZone={today}
      filter={query.show === "favorites" ? "favorites" : "all"}
      openCapture={query.capture === "1"}
    />
  );
}
