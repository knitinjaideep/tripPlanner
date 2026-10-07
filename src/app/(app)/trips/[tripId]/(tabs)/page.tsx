import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DayPlanCard,
  DocumentsCard,
  FlightCard,
  GlanceCard,
  NotesCard,
  PackingCard,
  StayCard,
} from "@/components/trip/overview-cards";
import { FlashToast } from "@/components/flash-toast";
import { MomentsCard, TripMemoryCard } from "@/components/trip/memory-cards";
import { getItineraryForUser, getMemoriesForUser, getPackingForUser, getTripForUser } from "@/lib/dal";
import { todayInTimeZone } from "@/lib/dates";
import { journalPhase } from "@/lib/memories";
import { getViewerTimeZone } from "@/lib/timezone";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip?.title ?? "Trip" };
}

/**
 * The same cards in every phase — bookings, documents, the day plan and
 * packing are always here — only their order and weight change:
 * before → reservations and preparation; during → today's plan and quick
 * access to bookings / documents; after → the reflection, favorites, album.
 */
export default async function TripOverviewPage({ params, searchParams }: PageProps<"/trips/[tripId]">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const [trip, items, packing, memories, timeZone] = await Promise.all([
    getTripForUser(tripId),
    getItineraryForUser(tripId),
    getPackingForUser(tripId),
    getMemoriesForUser(tripId),
    getViewerTimeZone(),
  ]);
  if (!trip || !items || !packing || !memories) notFound();
  const joined = query.joined ? <FlashToast message="You joined the trip." /> : null;
  const today = todayInTimeZone(timeZone);
  const todayInTripZone = todayInTimeZone(trip.time_zone);
  const phase = journalPhase(trip.start_date, trip.end_date, todayInTripZone);

  if (phase === "during") {
    return (
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-12 *:min-w-0">
        <h2 className="sr-only">Overview</h2>
        {joined}
        <DayPlanCard trip={trip} items={items} todayInTripZone={todayInTripZone} />
        <DocumentsCard trip={trip} />
        <FlightCard trip={trip} today={today} />
        <StayCard trip={trip} today={today} />
        <GlanceCard trip={trip} />
        <MomentsCard tripId={trip.id} visits={items} className="lg:col-span-5" />
        <PackingCard tripId={trip.id} categories={packing} wide={false} className="lg:col-span-7" />
        {trip.notes ? <NotesCard notes={trip.notes} /> : null}
      </div>
    );
  }

  if (phase === "after") {
    return (
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-12 *:min-w-0">
        <h2 className="sr-only">Overview</h2>
        {joined}
        <TripMemoryCard tripId={trip.id} memory={memories.memory} visits={items} className="lg:col-span-8" />
        <DocumentsCard trip={trip} />
        <FlightCard trip={trip} today={today} />
        <StayCard trip={trip} today={today} />
        <GlanceCard trip={trip} />
        <DayPlanCard trip={trip} items={items} todayInTripZone={todayInTripZone} className="lg:col-span-12" />
        <PackingCard tripId={trip.id} categories={packing} wide={!trip.notes} />
        {trip.notes ? <NotesCard notes={trip.notes} beside /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-12 *:min-w-0">
      <h2 className="sr-only">Overview</h2>
        {joined}
      <FlightCard trip={trip} today={today} />
      <StayCard trip={trip} today={today} />
      <GlanceCard trip={trip} />
      <DayPlanCard trip={trip} items={items} todayInTripZone={todayInTripZone} />
      <DocumentsCard trip={trip} />
      <PackingCard tripId={trip.id} categories={packing} wide={!trip.notes} />
      {trip.notes ? <NotesCard notes={trip.notes} beside /> : null}
    </div>
  );
}
