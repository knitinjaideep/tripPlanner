import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { updateTrip } from "@/app/actions/trips";
import { TripForm } from "@/components/forms/trip-form";
import { getTripForUser } from "@/lib/dal";

export const metadata: Metadata = { title: "Edit trip" };

export default async function EditTripPage({ params }: PageProps<"/trips/[tripId]/edit">) {
  const { tripId } = await params;
  const trip = await getTripForUser(tripId);
  if (!trip) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
      <Link
        href={`/trips/${trip.id}`}
        className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> {trip.title}
      </Link>
      <h1 className="font-display mt-3 text-4xl font-semibold text-ink sm:text-5xl">Edit trip</h1>
      <div className="card-surface mt-8 p-5 sm:p-8">
        <TripForm trip={trip} defaultTimeZone={trip.time_zone} action={updateTrip.bind(null, trip.id)} cancelHref={`/trips/${trip.id}`} />
      </div>
    </main>
  );
}
