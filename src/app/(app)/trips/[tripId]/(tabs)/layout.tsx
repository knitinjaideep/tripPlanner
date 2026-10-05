import { notFound } from "next/navigation";
import { TripHero } from "@/components/trip/trip-hero";
import { TripTabs } from "@/components/trip/trip-tabs";
import { TripWorkspace } from "@/components/trip/trip-workspace";
import { getTrip } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { getViewerTimeZone } from "@/lib/timezone";

export default async function TripLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const [trip, timeZone] = await Promise.all([getTrip(tripId), getViewerTimeZone()]);
  if (!trip) notFound();
  const today = todayInTimeZone(timeZone);

  return (
    <TripWorkspace tripId={trip.id} bookings={trip.bookings} documents={trip.document_links}>
      <TripHero trip={trip} today={today} />
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <TripTabs tripId={trip.id} />
        <div className="pt-6 pb-16 sm:pt-8">{children}</div>
      </div>
    </TripWorkspace>
  );
}
