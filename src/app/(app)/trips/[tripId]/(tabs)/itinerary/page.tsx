import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItineraryView } from "@/components/itinerary/itinerary-view";
import { getItineraryForUser, getPlacesForUser, getPollsForUser, getTripForUser } from "@/lib/dal";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/itinerary">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Itinerary · ${trip.title}` : "Itinerary" };
}

export default async function ItineraryPage({ params, searchParams }: PageProps<"/trips/[tripId]/itinerary">) {
  const { tripId } = await params;
  const [trip, items, places, polls, query] = await Promise.all([
    getTripForUser(tripId),
    getItineraryForUser(tripId),
    getPlacesForUser(tripId),
    getPollsForUser(tripId),
    searchParams,
  ]);
  if (!trip || !items || !places || !polls) notFound();
  return <ItineraryView trip={trip} items={items} places={places} polls={polls} query={query} />;
}
