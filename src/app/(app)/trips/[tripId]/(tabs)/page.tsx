import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DocumentsCard,
  FlightCard,
  GlanceCard,
  NotesCard,
  ReservationsCard,
  StayCard,
} from "@/components/trip/overview-cards";
import { getTrip } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { getViewerTimeZone } from "@/lib/timezone";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]">): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip?.title ?? "Trip" };
}

export default async function TripOverviewPage({ params }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const [trip, timeZone] = await Promise.all([getTrip(tripId), getViewerTimeZone()]);
  if (!trip) notFound();
  const today = todayInTimeZone(timeZone);

  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-12">
      <h2 className="sr-only">Overview</h2>
      <FlightCard trip={trip} today={today} />
      <StayCard trip={trip} today={today} />
      <GlanceCard trip={trip} />
      <ReservationsCard trip={trip} today={today} />
      <DocumentsCard trip={trip} />
      {trip.notes ? <NotesCard notes={trip.notes} /> : null}
    </div>
  );
}
