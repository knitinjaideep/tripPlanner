import Link from "next/link";
import { CalendarCheck, CalendarPlus, Car, Check, CircleCheckBig, Star } from "lucide-react";
import { formatShortDay } from "@/lib/dates";
import { formatRating, visitState } from "@/lib/explore";
import { LABELS } from "@/lib/plan-options";
import { TIER_LABELS, driveLabel, durationLabel, recommendationOf, type Recommendation } from "@/lib/recommendations";
import { daysBetweenDates } from "@/lib/schedule";
import type { PlaceWithVisits } from "@/lib/types";
import { FavoriteButton } from "./favorite-button";
import { PlaceArt } from "./place-art";

/** Priority badge: gold for a top pick, forest for must do, quiet for optional; none for recommended / maybe. */
export function PriorityBadge({ place, rec, className }: { place: PlaceWithVisits; rec: Recommendation | null; className?: string }) {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold";
  if (place.priority === "must_do") {
    return rec?.tier === "top_pick" ? (
      <span className={`${base} bg-gold text-ink ${className ?? ""}`}>{TIER_LABELS.top_pick}</span>
    ) : (
      <span className={`${base} bg-moss-ink text-white ${className ?? ""}`}>Must do</span>
    );
  }
  if (rec?.tier === "optional") {
    return <span className={`${base} border border-border text-muted-foreground ${className ?? ""}`}>Optional</span>;
  }
  return null;
}

/** "Beach · Palm Beach", "Food · Italian", or the plain kind · category for the traveler's own places. */
export function placeEyebrow(place: PlaceWithVisits, rec: Recommendation | null) {
  const category = LABELS.placeCategory[place.category as keyof typeof LABELS.placeCategory] ?? "Other";
  if (rec?.cuisine) return `Food · ${rec.cuisine}`;
  if (rec) return `${category} · ${rec.area}`;
  return `${place.kind === "food" ? "Food" : "Place"} · ${category}`;
}

/** Up to three tags, skipping ones the eyebrow already says. */
function cardTags(place: PlaceWithVisits, rec: Recommendation) {
  const category = (LABELS.placeCategory[place.category as keyof typeof LABELS.placeCategory] ?? "").toLowerCase();
  return rec.tags.filter((t) => t.toLowerCase() !== category).slice(0, 3);
}

/**
 * Compact Explore card: category art, name, kind / category or cuisine,
 * priority, one short line (the recommendation's summary or the traveler's
 * note), the estimated drive, a few tags, visit status, a favorite heart and
 * one clear next step. Details and sources live in the detail panel.
 */
export function PlaceCard({
  tripId,
  place,
  detailHref,
  actionHref,
  tripStart,
}: {
  tripId: string;
  place: PlaceWithVisits;
  detailHref: string;
  /** Opens the detail with the primary action's form ready. */
  actionHref: (action: "schedule" | "record") => string;
  tripStart: string;
}) {
  const state = visitState(place);
  const rating = formatRating(place.rating_avg);
  const rec = recommendationOf(place);
  const line = rec?.summary ?? place.planning_notes;
  const dayOf = (date: string) => {
    const n = daysBetweenDates(tripStart, date) + 1;
    return n >= 1 ? `Day ${n} · ${formatShortDay(date)}` : formatShortDay(date);
  };

  return (
    <article className="card-surface flex w-full flex-col overflow-hidden">
      <Link href={detailHref} scroll={false} className="focus-ring group flex flex-1 gap-3.5 rounded-2xl p-4">
        <PlaceArt category={place.category} className="size-14 rounded-xl" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {placeEyebrow(place, rec)}
            </span>
            <PriorityBadge place={place} rec={rec} />
          </span>
          <span className="mt-0.5 line-clamp-2 block font-semibold break-words text-ink group-hover:text-moss-ink">
            {place.name}
          </span>
          {line ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{line}</span> : null}
          {rec?.driveMinutes ? (
            <span className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-earth-ink">
              <Car className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {driveLabel(rec.driveMinutes)}
                {rec.visitMinutes ? ` · ${durationLabel(rec.visitMinutes)} there` : ""}
              </span>
            </span>
          ) : null}
          {rec ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {cardTags(place, rec).map((t) => (
                <span key={t} className="rounded-full bg-surface-warm px-2.5 py-0.5 text-xs font-medium text-ink/80">
                  {t}
                </span>
              ))}
            </span>
          ) : null}
          {state.visited || state.scheduled || !rec ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {state.visited ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-moss-soft px-2.5 py-0.5 text-xs font-semibold text-moss-ink">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  Visited{place.completed_count > 1 ? ` ×${place.completed_count}` : ""}
                  {rating ? (
                    <span className="ml-0.5 inline-flex items-center gap-0.5" aria-label={`your average rating ${rating} out of 5`}>
                      · <Star className="size-3 fill-gold text-gold-deep" aria-hidden="true" />
                      {rating}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {state.scheduled && place.next_planned_date ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2.5 py-0.5 text-xs font-semibold text-gold-ink">
                  <CalendarCheck className="size-3" aria-hidden="true" />
                  {dayOf(place.next_planned_date)}
                  {place.planned_count > 1 ? ` +${place.planned_count - 1}` : ""}
                </span>
              ) : null}
              {state.unscheduled ? (
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  Not scheduled
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="sr-only">View details</span>
        </span>
      </Link>
      <div className="flex items-center gap-1 border-t border-border/70 px-2 py-1.5">
        <FavoriteButton tripId={tripId} placeId={place.id} placeName={place.name} favorite={place.is_favorite} />
        {state.scheduled ? (
          <Link
            href={actionHref("record")}
            scroll={false}
            className="focus-ring flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
          >
            <CircleCheckBig className="size-4" aria-hidden="true" /> Mark visited
            <span className="sr-only"> — {place.name}</span>
          </Link>
        ) : (
          <Link
            href={actionHref("schedule")}
            scroll={false}
            className="focus-ring flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-coral hover:bg-[#fff1ee]"
          >
            <CalendarPlus className="size-4" aria-hidden="true" /> {state.visited ? "Plan another visit" : "Add to itinerary"}
            <span className="sr-only"> — {place.name}</span>
          </Link>
        )}
      </div>
    </article>
  );
}
