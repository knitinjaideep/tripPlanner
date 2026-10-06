"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { parseDate } from "@/lib/dates";
import { itineraryHref } from "@/lib/itinerary-format";
import { cn } from "@/lib/utils";

export type StripDay = { date: string; dayNumber: number; count: number };

/** Long trips also get a date field to jump straight to a day. */
const LONG_TRIP_DAYS = 10;

/**
 * Horizontal, scrollable day selector. Each day is a link (`?day=`), so
 * direct links, refresh and back/forward keep the selection. Scrolls only
 * itself — never the page — to keep the selected day in view.
 */
export function DayStrip({
  tripId,
  days,
  selected,
  today,
  showCancelled,
}: {
  tripId: string;
  days: StripDay[];
  selected: string;
  today: string;
  showCancelled: boolean;
}) {
  const scroller = useRef<HTMLOListElement>(null);
  const router = useRouter();

  useEffect(() => {
    const list = scroller.current;
    const active = list?.querySelector<HTMLElement>("[aria-current='date']");
    if (!list || !active) return;
    const target = active.offsetLeft - list.clientWidth / 2 + active.clientWidth / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, [selected]);

  return (
    <nav aria-label="Trip days" className="min-w-0">
      <ol
        ref={scroller}
        className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
      >
        {days.map((d) => {
          const active = d.date === selected;
          const date = parseDate(d.date);
          return (
            <li key={d.date} className="shrink-0">
              <Link
                href={itineraryHref(tripId, d.date, showCancelled)}
                scroll={false}
                aria-current={active ? "date" : undefined}
                aria-label={`Day ${d.dayNumber}, ${format(date, "EEEE, MMMM d")}${d.date === today ? ", today" : ""}${d.count ? `, ${d.count} planned` : ", nothing planned"}`}
                className={cn(
                  "focus-ring flex w-[4.25rem] flex-col items-center rounded-2xl border px-1 pt-2 pb-2.5 transition-colors",
                  active
                    ? "border-ink bg-ink text-white"
                    : "border-border bg-surface text-ink hover:border-teal hover:bg-teal-soft/50",
                )}
              >
                <span className={cn("text-[0.6875rem] font-semibold tracking-wide uppercase", active ? "text-white/80" : "text-muted-foreground")}>
                  {format(date, "EEE")}
                </span>
                <span className="text-xl leading-tight font-semibold">{format(date, "d")}</span>
                <span className={cn("text-[0.6875rem]", active ? "text-white/80" : "text-muted-foreground")}>
                  {d.date === today ? "Today" : format(date, "MMM")}
                </span>
                <span
                  className={cn(
                    "mt-1 size-1.5 rounded-full",
                    d.count ? (active ? "bg-coral-bright" : "bg-coral") : "bg-transparent",
                  )}
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ol>
      {days.length > LONG_TRIP_DAYS ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          Jump to
          <input
            type="date"
            min={days[0].date}
            max={days[days.length - 1].date}
            value={selected}
            onChange={(e) => {
              const value = e.target.value;
              if (days.some((d) => d.date === value)) router.push(itineraryHref(tripId, value, showCancelled), { scroll: false });
            }}
            className="focus-ring h-10 rounded-[10px] border border-input bg-white px-3 text-sm text-ink"
          />
        </label>
      ) : null}
    </nav>
  );
}
