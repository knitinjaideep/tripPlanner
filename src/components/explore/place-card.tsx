import Link from "next/link";
import { CalendarCheck, CalendarPlus, Check, CircleCheckBig, Star } from "lucide-react";
import { formatShortDay } from "@/lib/dates";
import { formatRating, visitState } from "@/lib/explore";
import { LABELS } from "@/lib/plan-options";
import { daysBetweenDates } from "@/lib/schedule";
import type { PlaceWithVisits } from "@/lib/types";
import { PlaceArt } from "./place-art";

/**
 * Compact Explore card: category art, name, kind/category, priority, a
 * short planning note, visit status, and one clear next step.
 */
export function PlaceCard({
  place,
  detailHref,
  actionHref,
  tripStart,
}: {
  place: PlaceWithVisits;
  detailHref: string;
  /** Opens the detail with the primary action's form ready. */
  actionHref: (action: "schedule" | "record") => string;
  tripStart: string;
}) {
  const state = visitState(place);
  const rating = formatRating(place.rating_avg);
  const category = LABELS.placeCategory[place.category as keyof typeof LABELS.placeCategory] ?? "Other";
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
              {place.kind === "food" ? "Food" : "Place"} · {category}
            </span>
            {place.priority === "must_do" ? (
              <span className="shrink-0 rounded-full bg-coral px-2 py-0.5 text-[0.6875rem] font-semibold text-white">Must do</span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-2 block font-semibold break-words text-ink group-hover:text-teal-ink">
            {place.name}
          </span>
          {place.planning_notes ? (
            <span className="mt-0.5 line-clamp-1 block text-sm text-muted-foreground">{place.planning_notes}</span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-1.5">
            {state.visited ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-0.5 text-xs font-semibold text-teal-ink">
                <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                Visited{place.completed_count > 1 ? ` ×${place.completed_count}` : ""}
                {rating ? (
                  <span className="ml-0.5 inline-flex items-center gap-0.5" aria-label={`your average rating ${rating} out of 5`}>
                    · <Star className="size-3 fill-[#e8a600] text-[#e8a600]" aria-hidden="true" />
                    {rating}
                  </span>
                ) : null}
              </span>
            ) : null}
            {state.scheduled && place.next_planned_date ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sun px-2.5 py-0.5 text-xs font-semibold text-[#6b5200]">
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
        </span>
      </Link>
      <div className="border-t border-border/70 px-2 py-1.5">
        {state.scheduled ? (
          <Link
            href={actionHref("record")}
            scroll={false}
            className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-teal-ink hover:bg-teal-soft/60"
          >
            <CircleCheckBig className="size-4" aria-hidden="true" /> Record a visit
            <span className="sr-only"> to {place.name}</span>
          </Link>
        ) : (
          <Link
            href={actionHref("schedule")}
            scroll={false}
            className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-coral hover:bg-[#fff1ee]"
          >
            <CalendarPlus className="size-4" aria-hidden="true" /> {state.visited ? "Plan another visit" : "Add to itinerary"}
            <span className="sr-only"> — {place.name}</span>
          </Link>
        )}
      </div>
    </article>
  );
}
