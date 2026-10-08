import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExploreView } from "@/components/explore/explore-view";
import { getExploreCollectionsForUser, getItineraryForUser, getPlacesForUser, getPollsForUser, getTripForUser } from "@/lib/dal";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/explore">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Explore · ${trip.title}` : "Explore" };
}

/** Read-only: curated collections are only offered here; importing is an explicit Server Action. */
export default async function ExplorePage({ params, searchParams }: PageProps<"/trips/[tripId]/explore">) {
  const { tripId } = await params;
  const [trip, places, items, collections, polls, query] = await Promise.all([
    getTripForUser(tripId),
    getPlacesForUser(tripId),
    getItineraryForUser(tripId),
    getExploreCollectionsForUser(tripId),
    getPollsForUser(tripId),
    searchParams,
  ]);
  if (!trip || !places || !items || !polls) notFound();
  return <ExploreView trip={trip} places={places} items={items} collections={collections ?? []} polls={polls} query={query} />;
}
