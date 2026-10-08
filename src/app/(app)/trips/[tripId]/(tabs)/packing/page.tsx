import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackingView } from "@/components/packing/packing-view";
import { getPackingForUser, getPackingSourcesForUser, getTripForUser, getTripPeopleForUser } from "@/lib/dal";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/packing">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Packing · ${trip.title}` : "Packing" };
}

export default async function PackingPage({ params }: PageProps<"/trips/[tripId]/packing">) {
  const { tripId } = await params;
  const [trip, categories, sources, people] = await Promise.all([
    getTripForUser(tripId),
    getPackingForUser(tripId),
    getPackingSourcesForUser(tripId),
    getTripPeopleForUser(tripId),
  ]);
  if (!trip || !categories) notFound();
  return (
    <PackingView
      tripId={trip.id}
      tripTimeZone={trip.time_zone}
      tripTravelers={trip.travelers}
      categories={categories}
      sources={sources}
      people={people ?? []}
    />
  );
}
