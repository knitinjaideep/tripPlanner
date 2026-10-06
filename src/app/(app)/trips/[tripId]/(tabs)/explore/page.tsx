import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExploreView } from "@/components/explore/explore-view";
import { getItineraryForUser, getPlacesForUser, getTripForUser } from "@/lib/dal";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/explore">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Explore · ${trip.title}` : "Explore" };
}

export default async function ExplorePage({ params, searchParams }: PageProps<"/trips/[tripId]/explore">) {
  const { tripId } = await params;
  const [trip, places, items, query] = await Promise.all([
    getTripForUser(tripId),
    getPlacesForUser(tripId),
    getItineraryForUser(tripId),
    searchParams,
  ]);
  if (!trip || !places || !items) notFound();
  return <ExploreView trip={trip} places={places} items={items} query={query} />;
}
