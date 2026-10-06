import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCover } from "@/lib/covers";
import { formatDateRange } from "@/lib/dates";
import type { Trip } from "@/lib/types";
import { TripActions } from "./trip-actions";
import { statusLabel } from "./trip-hero";

/** Slim destination header for inner trip pages (the overview keeps the full hero). */
export function TripHeaderCompact({ trip, today }: { trip: Trip; today: string }) {
  const cover = getCover(trip.cover_image);

  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link
          href="/trips"
          aria-label="All trips"
          className="focus-ring -ml-2 grid size-11 shrink-0 place-items-center rounded-xl text-ink hover:bg-secondary"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <Link
          href={`/trips/${trip.id}`}
          className="focus-ring group flex min-w-0 flex-1 items-center gap-3 rounded-xl sm:gap-4"
        >
          <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-[#183a2f] sm:size-14">
            <Image
              src={cover.image}
              alt=""
              fill
              sizes="56px"
              className="object-cover"
              style={{ objectPosition: cover.position }}
            />
          </span>
          <span className="min-w-0">
            <span className="eyebrow block truncate text-muted-foreground">{trip.destination}</span>
            <span className="font-display block truncate text-xl leading-tight font-semibold text-ink group-hover:text-moss-ink sm:text-2xl">
              {trip.title}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {formatDateRange(trip.start_date, trip.end_date, "short")}
              <span aria-hidden="true">·</span>
              <span className="font-medium text-coral">{statusLabel(trip, today)}</span>
            </span>
          </span>
        </Link>
        <TripActions tripId={trip.id} title={trip.title} className="border border-border bg-white shadow-none" />
      </div>
    </section>
  );
}
