import Link from "next/link";
import { ArrowRight, Camera, ExternalLink, Heart, Images, PenLine } from "lucide-react";
import { Stars } from "@/components/itinerary/star-rating";
import { favoriteVisits, memoryStats, visitDate } from "@/lib/memories";
import { formatShortDay } from "@/lib/dates";
import { entryTitle } from "@/lib/schedule";
import type { ItineraryEntry, TripMemory } from "@/lib/types";
import { cn } from "@/lib/utils";

const linkButton =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 -mr-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60";
const outlineButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-moss-ink px-5 text-[0.9375rem] font-semibold text-moss-ink transition-colors hover:bg-moss-soft";

/** Overview during the trip: what's been captured, and a quick way to add a moment. */
export function MomentsCard({
  tripId,
  visits,
  className,
}: {
  tripId: string;
  /** Every itinerary row; only completed ones count. */
  visits: ItineraryEntry[];
  className?: string;
}) {
  const done = visits.filter((v) => v.status === "completed");
  const { completed } = memoryStats(done);
  const latest = [...done].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];
  const href = `/trips/${tripId}/memories`;

  return (
    <article className={cn("card-surface flex flex-col p-6 md:col-span-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2 text-ink">
          <Images className="size-4 text-moss" aria-hidden="true" /> Memories
        </p>
        <Link href={href} className={linkButton}>
          Open journal <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <p className="font-display mt-3 text-[1.75rem] leading-tight font-semibold text-ink">
        {completed === 0 ? "Nothing captured yet" : completed === 1 ? "1 moment captured" : `${completed} moments captured`}
      </p>
      {latest ? (
        <p className="mt-1 truncate text-sm text-muted-foreground">
          Latest: <span className="font-medium text-ink">{entryTitle(latest)}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Mark plans as done or capture something unplanned.</p>
      )}
      <div className="mt-auto pt-5">
        <Link href={`${href}?capture=1`} className={outlineButton}>
          <Camera className="size-4" aria-hidden="true" /> Capture a moment
        </Link>
      </div>
    </article>
  );
}

/** Overview after the trip: the reflection, favorite visits and the album link. */
export function TripMemoryCard({
  tripId,
  memory,
  visits,
  className,
}: {
  tripId: string;
  memory: TripMemory | null;
  /** Every itinerary row; favorites are completed rows flagged as favorite. */
  visits: ItineraryEntry[];
  className?: string;
}) {
  const href = `/trips/${tripId}/memories`;
  const favorites = favoriteVisits(visits).slice(0, 3);
  const { completed } = memoryStats(visits);

  return (
    <article className={cn("card-surface flex flex-col p-6 sm:p-7 md:col-span-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2 text-ink">
          <Images className="size-4 text-moss" aria-hidden="true" /> Trip memories
        </p>
        <Link href={href} className={linkButton}>
          Open memories <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {memory?.summary || memory?.overall_rating ? (
        <div className="mt-4">
          {memory.overall_rating ? <Stars value={memory.overall_rating} className="[&_svg]:size-4.5" /> : null}
          {memory.summary ? (
            <p className="font-display mt-2 line-clamp-3 text-xl leading-snug font-medium whitespace-pre-line text-ink">
              {memory.summary}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4">
          <p className="font-display text-[1.75rem] leading-tight font-semibold text-ink">How was the trip?</p>
          <Link href={href} className={cn(outlineButton, "mt-4")}>
            <PenLine className="size-4" aria-hidden="true" /> Write your reflection
          </Link>
        </div>
      )}

      {favorites.length ? (
        <ul className="mt-5 space-y-2">
          {favorites.map((v) => {
            const date = visitDate(v);
            return (
              <li key={v.id} className="flex items-center gap-2.5 text-[0.9375rem]">
                <Heart className="size-4 shrink-0 fill-coral text-coral" aria-hidden="true" />
                <span className="min-w-0 truncate font-semibold text-ink">{entryTitle(v)}</span>
                {date ? <span className="shrink-0 text-sm text-muted-foreground">{formatShortDay(date)}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : completed > 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          {completed === 1 ? "1 activity" : `${completed} activities`} in your journal — tap the heart on the ones you loved.
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
        {memory?.photo_album_url ? (
          <a
            href={memory.photo_album_url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-earth-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-[#5a462b]"
          >
            Open photo album <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <Link href={href} className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-earth-ink">
            <Images className="size-4" aria-hidden="true" /> Add your photo album link
          </Link>
        )}
      </div>
    </article>
  );
}
