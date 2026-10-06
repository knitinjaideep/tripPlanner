import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createTrip } from "@/app/actions/trips";
import { TripForm } from "@/components/forms/trip-form";
import { requireUser } from "@/lib/dal";
import { getViewerTimeZone } from "@/lib/timezone";

export const metadata: Metadata = { title: "New trip" };

export default async function NewTripPage() {
  await requireUser();
  const timeZone = await getViewerTimeZone();
  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
      <Link
        href="/trips"
        className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> My trips
      </Link>
      <h1 className="font-display mt-3 text-4xl font-semibold text-ink sm:text-5xl">Plan a new trip</h1>
      <p className="mt-2 text-muted-foreground">Start with the essentials — you can add bookings next.</p>
      <div className="card-surface mt-8 p-5 sm:p-8">
        <TripForm defaultTimeZone={timeZone} action={createTrip} cancelHref="/trips" />
      </div>
    </main>
  );
}
