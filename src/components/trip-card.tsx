import Image from "next/image";
import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { TravelerStack } from "@/components/user-avatar";
import { getCover } from "@/lib/covers";
import { daysUntil, formatDateRange, type TripPhase } from "@/lib/dates";
import type { TripListItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export function countdownLabel(trip: Pick<TripListItem, "start_date">, phase: TripPhase, today: string) {
  if (phase === "current") return "Happening now";
  if (phase === "past") return null;
  const days = daysUntil(trip.start_date, today);
  if (days === 1) return "Tomorrow";
  return `${days} days to go`;
}

export function TripCard({
  trip,
  phase,
  today,
  priority = false,
}: {
  trip: TripListItem;
  phase: TripPhase;
  today: string;
  priority?: boolean;
}) {
  const cover = getCover(trip.cover_image);
  const badge = countdownLabel(trip, phase, today);

  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group card-surface focus-ring block overflow-hidden transition-shadow hover:shadow-[0_2px_4px_rgba(24,58,47,0.06),0_16px_32px_-16px_rgba(24,58,47,0.18)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-moss-soft">
        <Image
          src={cover.image}
          alt=""
          fill
          loading={priority ? "eager" : undefined}
          fetchPriority={priority ? "high" : undefined}
          placeholder="blur"
          sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"
          style={{ objectPosition: cover.position }}
          className={cn(
            "object-cover transition-transform duration-500 group-hover:scale-[1.03]",
            phase === "past" && "saturate-[.8]",
          )}
        />
        {badge ? (
          <span
            className={cn(
              "absolute top-3 left-3 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm",
              phase === "current" ? "bg-moss-ink text-white" : "bg-gold text-forest",
            )}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="space-y-3 p-5">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-moss-ink">
            <MapPin className="size-3.5" aria-hidden="true" />
            <span className="truncate">{trip.destination}</span>
          </p>
          <h3 className="font-display mt-1.5 truncate text-2xl leading-tight font-semibold text-ink">{trip.title}</h3>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
          {formatDateRange(trip.start_date, trip.end_date)}
        </p>
        {trip.role !== "owner" ? (
          <p className="flex items-center gap-2 text-sm font-medium text-moss-ink">
            <Users className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              Shared with you
              <span className="font-normal text-muted-foreground">
                {" "}
                · {trip.role === "editor" ? "Editor" : "Viewer"}
                {trip.owner_name ? ` · from ${trip.owner_name}` : ""}
              </span>
            </span>
          </p>
        ) : null}
        {trip.travelers.length > 0 ? (
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <TravelerStack travelers={trip.travelers} />
            <p className="truncate text-sm text-ink">{trip.travelers.join(" · ")}</p>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
