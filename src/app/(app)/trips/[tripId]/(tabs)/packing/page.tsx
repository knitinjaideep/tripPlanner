import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackingView } from "@/components/packing/packing-view";
import { getPackingForUser, getPackingSourcesForUser, getTripForUser } from "@/lib/dal";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/packing">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Packing · ${trip.title}` : "Packing" };
}

export default async function PackingPage({ params }: PageProps<"/trips/[tripId]/packing">) {
  const { tripId } = await params;
  const [trip, categories, sources] = await Promise.all([
    getTripForUser(tripId),
    getPackingForUser(tripId),
    getPackingSourcesForUser(tripId),
  ]);
  if (!trip || !categories) notFound();
  return <PackingView tripId={trip.id} tripTravelers={trip.travelers} categories={categories} sources={sources} />;
}
