import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, Camera, Heart, PenLine, Sparkles } from "lucide-react";
import type { TripDayOption } from "@/components/itinerary/types";
import { Stars } from "@/components/itinerary/star-rating";
import { MascotImage } from "@/components/mascot";
import { getCover } from "@/lib/covers";
import { daysUntil, formatDateRange, formatDayDate, formatShortDay, tripLengthDays } from "@/lib/dates";
import { itineraryHref } from "@/lib/itinerary-format";
import {
  captureCandidates,
  favoriteVisits,
  groupVisitsByDay,
  memoryStats,
  visitDate,
  type JournalDay,
  type JournalPhase,
} from "@/lib/memories";
import { LABELS } from "@/lib/plan-options";
import { datesBetween, entryTitle } from "@/lib/schedule";
import type { ItineraryEntry, TripMemory, TripWithDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlbumCard } from "./album-card";
import { CaptureMomentButton } from "./capture-moment";
import { SummaryEditButton } from "./summary-editor";
import { VisitCard } from "./visit-card";

export type JournalFilter = "all" | "favorites";

const primaryButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover";
const outlineButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-moss-ink px-5 text-[0.9375rem] font-semibold text-moss-ink transition-colors hover:bg-moss-soft";
const linkButton =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60";

/**
 * The trip as a journal. Completed itinerary rows are the per-visit memories
 * (edited in place — never copied); trip_memories holds the one optional
 * trip-wide reflection and album link. Emphasis shifts with the trip:
 * before (notes, album), during (captured visits), after (reflection,
 * favorites, lessons).
 */
export function MemoriesView({
  trip,
  memory,
  visits,
  items,
  phase,
  todayInTripZone,
  filter,
  openCapture,
}: {
  trip: TripWithDetails;
  memory: TripMemory | null;
  /** Completed visits (the journal). */
  visits: ItineraryEntry[];
  /** Every itinerary row, for "Capture a moment" from the itinerary. */
  items: ItineraryEntry[];
  phase: JournalPhase;
  todayInTripZone: string;
  filter: JournalFilter;
  openCapture: boolean;
}) {
  const stats = memoryStats(visits);
  const favorites = favoriteVisits(visits);
  const shown = filter === "favorites" ? favorites : visits;
  const days = groupVisitsByDay(shown, trip.start_date, trip.end_date);

  const lastDay = todayInTripZone < trip.end_date ? todayInTripZone : trip.end_date;
  const captureDays: TripDayOption[] =
    phase === "before"
      ? []
      : datesBetween(trip.start_date, lastDay)
          .map((date, i) => ({ date, dayNumber: i + 1, label: `Day ${i + 1} · ${formatShortDay(date)}` }))
          .reverse();
  const candidates =
    phase === "before"
      ? []
      : captureCandidates({
          items,
          reservations: trip.reservations,
          tripStart: trip.start_date,
          tripEnd: trip.end_date,
          todayInTripZone,
        });
  const capture =
    phase === "before" ? null : (
      <CaptureMomentButton
        tripId={trip.id}
        candidates={candidates}
        days={captureDays}
        autoOpen={openCapture}
        className={phase === "during" ? primaryButton : outlineButton}
      >
        <Camera className="size-4" aria-hidden="true" /> Capture a moment
      </CaptureMomentButton>
    );

  const reflection = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-12">
      <ReflectionCard tripId={trip.id} memory={memory} phase={phase} className="lg:col-span-8" />
      <AlbumCard tripId={trip.id} url={memory?.photo_album_url ?? null} className="lg:col-span-4" />
    </div>
  );

  const journal = (
    <Journal
      tripId={trip.id}
      phase={phase}
      days={days}
      total={visits.length}
      favoriteCount={favorites.length}
      filter={filter}
      capture={capture}
      firstDayHref={itineraryHref(trip.id, phase === "during" ? todayInTripZone : trip.start_date)}
    />
  );

  return (
    <div className="space-y-10 sm:space-y-12">
      <h2 className="sr-only">Memories</h2>
      <Masthead trip={trip} memory={memory} phase={phase} todayInTripZone={todayInTripZone} />
      {stats.completed > 0 ? <Stats stats={stats} /> : null}

      {phase === "during" ? (
        <>
          {journal}
          {reflection}
        </>
      ) : phase === "after" ? (
        <>
          {reflection}
          {favorites.length > 0 && filter === "all" ? <FavoritesStrip tripId={trip.id} favorites={favorites} /> : null}
          {journal}
        </>
      ) : (
        <>
          {reflection}
          {journal}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Masthead({
  trip,
  memory,
  phase,
  todayInTripZone,
}: {
  trip: TripWithDetails;
  memory: TripMemory | null;
  phase: JournalPhase;
  todayInTripZone: string;
}) {
  const cover = getCover(trip.cover_image);
  const until = daysUntil(trip.start_date, todayInTripZone);
  const dayOfTrip = daysUntil(todayInTripZone, trip.start_date) + 1;
  const totalDays = tripLengthDays(trip.start_date, trip.end_date);
  const line =
    phase === "before"
      ? `The journal opens ${until === 1 ? "tomorrow" : `in ${until} days`} — ${formatDayDate(trip.start_date)}.`
      : phase === "during"
        ? `Day ${dayOfTrip} of ${totalDays}. Capture moments as they happen.`
        : "Back home. Here’s what you’ll want to remember.";

  return (
    <section className="card-surface grid overflow-hidden md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="relative h-40 bg-[#183a2f] sm:h-48 md:h-auto md:min-h-60">
        <Image
          src={cover.image}
          alt=""
          fill
          sizes="(min-width: 768px) 40vw, 100vw"
          className="object-cover"
          style={{ objectPosition: cover.position }}
          priority
        />
        <span className="absolute bottom-2 left-2 rounded-full bg-[#10251e]/70 px-2 py-0.5 text-[0.6875rem] text-white">
          Illustrative photo
        </span>
      </div>
      <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
        <p className="eyebrow text-gold-ink">Trip journal</p>
        <p className="font-display text-[2rem] leading-[1.1] font-semibold break-words text-ink sm:text-[2.5rem]">
          {trip.destination}
        </p>
        <p className="text-[0.9375rem] text-muted-foreground">
          {formatDateRange(trip.start_date, trip.end_date)}
          {trip.travelers.length ? ` · ${trip.travelers.join(", ")}` : ""}
        </p>
        {memory?.overall_rating || memory?.would_return ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {memory.overall_rating ? (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <Stars value={memory.overall_rating} className="[&_svg]:size-4.5" />
                Overall
              </span>
            ) : null}
            {memory.would_return ? (
              <span className="rounded-full bg-moss-soft px-3 py-1 text-sm font-medium text-moss-ink">
                Would go back: {LABELS.wouldReturn[memory.would_return]}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="text-[0.9375rem] text-ink">{line}</p>
      </div>
    </section>
  );
}

function Stats({ stats }: { stats: { completed: number; places: number; food: number } }) {
  // Only counts derived from rows; an album link has no photo count.
  const items = [
    { value: stats.completed, label: stats.completed === 1 ? "activity completed" : "activities completed" },
    { value: stats.places, label: stats.places === 1 ? "place visited" : "places visited" },
    { value: stats.food, label: stats.food === 1 ? "food & drink spot" : "food & drink spots" },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 sm:gap-4">
      {items.map((s) => (
        <div key={s.label} className="rounded-2xl bg-gold-soft px-3 py-3 sm:px-5 sm:py-4">
          <dt className="sr-only">{s.label}</dt>
          <dd>
            <span className="font-display block text-2xl font-semibold text-ink sm:text-3xl">{s.value}</span>
            <span className="block text-xs leading-snug text-gold-ink sm:text-sm">{s.label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReflectionCard({
  tripId,
  memory,
  phase,
  className,
}: {
  tripId: string;
  memory: TripMemory | null;
  phase: JournalPhase;
  className?: string;
}) {
  const hasWriting = Boolean(memory?.summary || memory?.favorite_moment || memory?.lessons_for_next_time);
  const editable = memory
    ? {
        overall_rating: memory.overall_rating,
        summary: memory.summary,
        favorite_moment: memory.favorite_moment,
        would_return: memory.would_return,
        lessons_for_next_time: memory.lessons_for_next_time,
      }
    : null;

  if (!hasWriting) {
    const copy = {
      before: {
        title: "Before you go",
        body: "Jot down what you’re hoping for. After the trip, this becomes your reflection — with lessons for next time.",
        action: "Write a note",
      },
      during: {
        title: "Write as you go",
        body: "A line or two each evening is plenty. You can add your rating and lessons when you’re home.",
        action: "Start your reflection",
      },
      after: {
        title: "How was the trip?",
        body: "Rate it, write what you loved, and note what you’d do differently next time.",
        action: "Write your reflection",
      },
    }[phase];
    return (
      <section aria-labelledby="reflection-heading" className={cn("card-surface flex flex-col p-6 sm:p-8", className)}>
        <p className="eyebrow text-ink">Trip reflection</p>
        <h3 id="reflection-heading" className="font-display mt-3 text-[1.75rem] leading-tight font-semibold text-ink">
          {copy.title}
        </h3>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-muted-foreground">{copy.body}</p>
        <SummaryEditButton
          tripId={tripId}
          memory={editable}
          className={cn(phase === "after" ? primaryButton : outlineButton, "mt-6 self-start")}
        >
          <PenLine className="size-4" aria-hidden="true" /> {copy.action}
        </SummaryEditButton>
      </section>
    );
  }

  return (
    <section aria-labelledby="reflection-heading" className={cn("card-surface p-6 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-3">
        <h3 id="reflection-heading" className="eyebrow text-ink">
          {phase === "before" ? "Trip notes" : "Trip reflection"}
        </h3>
        <SummaryEditButton tripId={tripId} memory={editable} className={cn(linkButton, "-mt-3 -mr-2")}>
          <PenLine className="size-4" aria-hidden="true" /> Edit
        </SummaryEditButton>
      </div>
      {memory?.summary ? (
        <p
          className={cn(
            "font-display mt-4 leading-snug font-medium whitespace-pre-line text-ink",
            phase === "after" ? "text-[1.375rem] sm:text-[1.625rem]" : "text-xl",
          )}
        >
          {memory.summary}
        </p>
      ) : null}
      {memory?.favorite_moment ? (
        <div className="mt-6">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="size-4 text-gold-deep" aria-hidden="true" /> Favorite moment
          </h4>
          <p className="mt-1.5 max-w-prose leading-relaxed whitespace-pre-line text-muted-foreground">{memory.favorite_moment}</p>
        </div>
      ) : null}
      {memory?.lessons_for_next_time ? (
        <div className="mt-6 rounded-xl bg-moss-soft/60 p-4">
          <h4 className="text-sm font-semibold text-moss-ink">Lessons for next time</h4>
          <p className="mt-1.5 max-w-prose leading-relaxed whitespace-pre-line text-ink">{memory.lessons_for_next_time}</p>
        </div>
      ) : phase === "after" ? (
        <SummaryEditButton tripId={tripId} memory={editable} className={cn(linkButton, "mt-4 -ml-2")}>
          Add lessons for next time <ArrowRight className="size-4" aria-hidden="true" />
        </SummaryEditButton>
      ) : null}
    </section>
  );
}

function FavoritesStrip({ tripId, favorites }: { tripId: string; favorites: ItineraryEntry[] }) {
  return (
    <section aria-labelledby="favorites-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id="favorites-heading" className="font-display text-2xl font-semibold text-ink sm:text-[1.75rem]">
          Favorites
        </h3>
        <Link href={`/trips/${tripId}/memories?show=favorites#journal`} className={linkButton}>
          Show only favorites <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {favorites.slice(0, 6).map((v) => (
          <li key={v.id}>
            <a
              href={`#visit-card-${v.id}`}
              className="focus-ring flex h-full items-start gap-3 rounded-2xl border border-gold/70 bg-[#fffbef] p-4 hover:border-gold"
            >
              <Heart className="mt-1 size-4 shrink-0 fill-coral text-coral" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-semibold break-words text-ink">{entryTitle(v)}</span>
                {/* Repeat visits share a name; the day tells them apart. */}
                {visitDate(v) ? (
                  <span className="block text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {formatShortDay(visitDate(v)!)}
                  </span>
                ) : null}
                {v.reflection ? (
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{v.reflection}</span>
                ) : v.rating ? (
                  <Stars value={v.rating} className="mt-1" />
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {favorites.length > 6 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          And {favorites.length - 6} more in the journal below.
        </p>
      ) : null}
    </section>
  );
}

function Journal({
  tripId,
  phase,
  days,
  total,
  favoriteCount,
  filter,
  capture,
  firstDayHref,
}: {
  tripId: string;
  phase: JournalPhase;
  days: JournalDay[];
  total: number;
  favoriteCount: number;
  filter: JournalFilter;
  capture: React.ReactNode;
  firstDayHref: string;
}) {
  const base = `/trips/${tripId}/memories`;
  const tabs: { key: JournalFilter; label: string; count: number; href: string }[] = [
    { key: "all", label: "All", count: total, href: `${base}#journal` },
    { key: "favorites", label: "Favorites", count: favoriteCount, href: `${base}?show=favorites#journal` },
  ];

  return (
    <section id="journal" aria-labelledby="journal-heading" className="scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h3 id="journal-heading" className="font-display text-2xl font-semibold text-ink sm:text-[1.75rem]">
            Day by day
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">Everything marked done on your itinerary.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {total > 0 ? (
            <nav aria-label="Filter the journal" className="flex rounded-xl bg-secondary p-1">
              {tabs.map((t) => (
                <Link
                  key={t.key}
                  href={t.href}
                  scroll={false}
                  aria-current={filter === t.key ? "page" : undefined}
                  className={cn(
                    "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-colors",
                    filter === t.key ? "bg-white text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
                  )}
                >
                  {t.key === "favorites" ? <Heart className="size-3.5" aria-hidden="true" /> : null}
                  {t.label}
                  <span className="font-normal">{t.count}</span>
                </Link>
              ))}
            </nav>
          ) : null}
          {capture}
        </div>
      </div>

      {days.length === 0 ? (
        <JournalEmpty phase={phase} favoritesOnly={filter === "favorites" && total > 0} firstDayHref={firstDayHref} />
      ) : (
        <ol className="mt-6 space-y-8">
          {days.map((day) => (
            <li key={day.date ?? "undated"} className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
              <h4 className="md:pt-4">
                <span className="eyebrow block text-gold-ink">
                  {day.dayNumber ? `Day ${day.dayNumber}` : day.date ? "Outside trip dates" : "No date"}
                </span>
                {day.date ? (
                  <span className="mt-0.5 block font-semibold text-ink">{formatShortDay(day.date)}</span>
                ) : null}
              </h4>
              <ul className="space-y-3">
                {day.visits.map((v) => (
                  <li key={v.id} id={`visit-card-${v.id}`} className="scroll-mt-6">
                    <VisitCard tripId={tripId} visit={v} inTrip={day.dayNumber !== null} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function JournalEmpty({
  phase,
  favoritesOnly,
  firstDayHref,
}: {
  phase: JournalPhase;
  favoritesOnly: boolean;
  firstDayHref: string;
}) {
  const copy = favoritesOnly
    ? {
        title: "No favorites yet",
        body: "Tap the heart on any visit to keep it here.",
      }
    : phase === "before"
      ? {
          title: "Your journal fills itself",
          body: "Once the trip starts, everything you mark as done in the itinerary appears here, day by day — with your ratings and notes.",
        }
      : phase === "during"
        ? {
            title: "Nothing captured yet",
            body: "Mark plans as done in the itinerary, or capture a moment — even something you didn’t plan.",
          }
        : {
            title: "No completed activities recorded",
            body: "Nothing was marked as done during this trip. You can still capture what you did.",
          };
  return (
    <div className="mt-6 flex flex-col items-start gap-4 rounded-2xl border border-dashed border-input bg-surface/60 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div className="flex items-center gap-4">
        <MascotImage size="sm" decorative />
        <div>
          <p className="font-display text-xl font-semibold text-ink">{copy.title}</p>
          <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">{copy.body}</p>
        </div>
      </div>
      {favoritesOnly ? null : (
        <Link href={firstDayHref} className={cn(outlineButton, "shrink-0")}>
          <CalendarDays className="size-4" aria-hidden="true" /> Open itinerary
        </Link>
      )}
    </div>
  );
}
