import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PollsView } from "@/components/polls/polls-view";
import { getPlacesForUser, getPollsForUser, getTripForUser } from "@/lib/dal";
import { isUuid } from "@/lib/notifications";

export async function generateMetadata({ params }: PageProps<"/trips/[tripId]/polls">): Promise<Metadata> {
  const trip = await getTripForUser((await params).tripId);
  return { title: trip ? `Ask the group · ${trip.title}` : "Ask the group" };
}

export default async function PollsPage({ params, searchParams }: PageProps<"/trips/[tripId]/polls">) {
  const { tripId } = await params;
  const [trip, polls, places, query] = await Promise.all([getTripForUser(tripId), getPollsForUser(tripId), getPlacesForUser(tripId), searchParams]);
  if (!trip || !polls || !places) notFound();
  const focus = typeof query.poll === "string" && isUuid(query.poll) ? query.poll : undefined;
  return (
    <PollsView
      tripTimeZone={trip.time_zone}
      polls={polls}
      places={places.map((p) => ({ id: p.id, name: p.name }))}
      focus={focus}
    />
  );
}
