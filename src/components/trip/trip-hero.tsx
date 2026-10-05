import Image from "next/image";
import Link from "next/link";
import { CalendarDays, ChevronLeft, Clock } from "lucide-react";
import { getCover } from "@/lib/covers";
import { daysUntil, formatDateRange, tripLengthDays, tripPhase } from "@/lib/dates";
import type { Trip } from "@/lib/types";
import { TripActions } from "./trip-actions";

function statusLabel(trip: Trip, today: string) {
  const phase = tripPhase(trip.start_date, trip.end_date, today);
  if (phase === "past") return "Trip complete";
  if (phase === "current") {
    const day = daysUntil(today, trip.start_date) + 1;
    return `Day ${day} of ${tripLengthDays(trip.start_date, trip.end_date)}`;
  }
  const days = daysUntil(trip.start_date, today);
  return days === 1 ? "Tomorrow!" : `${days} days to go`;
}

export function TripHero({ trip, today }: { trip: Trip; today: string }) {
  const cover = getCover(trip.cover_image);

  return (
    <section className="relative isolate overflow-hidden bg-[#0b2a3a]">
      <Image
        src={cover.image}
        alt=""
        fill
        loading="eager"
        fetchPriority="high"
        placeholder="blur"
        sizes="100vw"
        className="-z-10 object-cover"
        style={{ objectPosition: cover.position }}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#08263a]/80 via-[#08263a]/40 to-transparent" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#08263a]/45 to-transparent" />

      <div className="mx-auto flex min-h-[15rem] max-w-[1280px] flex-col justify-between gap-6 px-4 py-5 sm:min-h-[19rem] sm:px-6 sm:py-7 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/trips"
            className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl bg-white/15 px-3 text-sm font-medium text-white backdrop-blur hover:bg-white/25"
          >
            <ChevronLeft className="size-4" aria-hidden="true" /> All trips
          </Link>
          <TripActions tripId={trip.id} title={trip.title} />
        </div>

        <div className="max-w-3xl text-white">
          {trip.travelers.length > 0 ? (
            <p className="eyebrow text-white/90">{trip.travelers.join(" · ")}</p>
          ) : (
            <p className="eyebrow text-white/90">{trip.destination}</p>
          )}
          <h1 className="font-display mt-2 text-[2.5rem] leading-[1.02] font-semibold drop-shadow-sm sm:text-6xl">
            {trip.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="flex items-center gap-2 text-lg font-medium sm:text-xl">
              <CalendarDays className="size-5" aria-hidden="true" />
              {formatDateRange(trip.start_date, trip.end_date)}
            </p>
            <span className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow-sm">
              <Clock className="size-4" aria-hidden="true" />
              {statusLabel(trip, today)}
            </span>
          </div>
        </div>
      </div>
      <p className="absolute right-4 bottom-2 hidden max-w-[60%] truncate text-[0.6875rem] text-white/70 sm:block">
        Illustrative photo: {cover.credit.author} · {cover.credit.license} ·{" "}
        <a href={cover.credit.source} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Wikimedia Commons
        </a>
      </p>
    </section>
  );
}
