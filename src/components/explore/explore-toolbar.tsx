"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { controlClass } from "@/components/forms/fields";
import { EXPLORE_FLAGS, FLAG_LABELS, exploreHref, toggleFlag, type ExploreFilters, type ExploreFlag } from "@/lib/explore";
import { cn } from "@/lib/utils";

/**
 * One toolbar for every filter. Each change is a URL update, so filters
 * survive refresh, sharing a link and back/forward. Typing in search
 * replaces the URL (no history entry per keystroke).
 */
export function ExploreToolbar({
  tripId,
  filters,
  counts,
  flagCounts,
  placeLabel,
}: {
  tripId: string;
  filters: ExploreFilters;
  counts: Record<ExploreFilters["kind"], number>;
  /** How many places each extra filter would match on its own; chips with none are hidden unless active. */
  flagCounts: Record<ExploreFlag, number>;
  /** "Beaches & outings" on beach trips, else "Places". */
  placeLabel: string;
}) {
  const kindLabels: Record<ExploreFilters["kind"], string> = { all: "All", place: placeLabel, food: "Food", spa: "Spas" };
  // The Spas tab only appears once there is a spa (or it is the current filter).
  const kinds = (Object.keys(kindLabels) as ExploreFilters["kind"][]).filter(
    (k) => k !== "spa" || counts.spa > 0 || filters.kind === "spa",
  );
  const chips = EXPLORE_FLAGS.filter((f) => flagCounts[f] > 0 || filters.flags.includes(f));
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  // Only typing triggers this (not navigation), debounced.
  useEffect(() => {
    if (q.trim() === latest.current.q) return;
    const timer = setTimeout(() => {
      router.replace(exploreHref(tripId, { ...latest.current, q: q.trim() }), { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [q, router, tripId]);

  const go = (next: Partial<ExploreFilters>) =>
    router.push(exploreHref(tripId, { ...filters, ...next }), { scroll: false });
  const filtered =
    filters.kind !== "all" || filters.q || filters.priority !== "all" || filters.status !== "all" || filters.flags.length > 0;

  return (
    <div role="search" aria-label="Filter places" className="min-w-0 space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <nav
          aria-label="Category"
          className={cn("grid shrink-0 gap-1 rounded-xl bg-secondary p-1 sm:flex", kinds.length > 3 ? "grid-cols-2" : "grid-cols-3")}
        >
          {kinds.map((k) => (
            <Link
              key={k}
              href={exploreHref(tripId, { ...filters, kind: k })}
              scroll={false}
              aria-current={filters.kind === k ? "page" : undefined}
              className={cn(
                "focus-ring flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors lg:flex-none",
                filters.kind === k ? "bg-white text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
              )}
            >
              {kindLabels[k]}
              <span className="text-xs font-medium text-muted-foreground">{counts[k]}</span>
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">Search by name, area, cuisine or tag</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, area, cuisine…"
              maxLength={80}
              className={cn(controlClass, "w-full border pl-10")}
            />
          </label>
          <FilterSelect
            label="Priority"
            value={filters.priority}
            onChange={(v) => go({ priority: v as ExploreFilters["priority"] })}
            options={[
              ["all", "Any priority"],
              ["must_do", "Must do"],
              ["maybe", "Maybe"],
            ]}
          />
          <FilterSelect
            label="Visit status"
            value={filters.status}
            onChange={(v) => go({ status: v as ExploreFilters["status"] })}
            options={[
              ["all", "Any status"],
              ["unscheduled", "Not scheduled"],
              ["scheduled", "Scheduled"],
              ["visited", "Visited"],
            ]}
          />
          {filtered ? (
            <Link
              href={exploreHref(tripId, {})}
              scroll={false}
              onClick={() => setQ("")}
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" /> Clear
            </Link>
          ) : null}
        </div>
      </div>
      {chips.length ? (
        <div role="group" aria-label="More filters" className="flex flex-wrap gap-2">
          {chips.map((f) => {
            const on = filters.flags.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => go({ flags: toggleFlag(filters.flags, f) })}
                className={cn(
                  "focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  on
                    ? "border-moss bg-moss-soft text-moss-ink"
                    : "border-border bg-surface text-muted-foreground hover:border-moss/60 hover:text-ink",
                )}
              >
                {on ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : null}
                {FLAG_LABELS[f]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(controlClass, "w-full appearance-none border pr-9 font-medium sm:w-auto", value !== "all" && "border-moss bg-moss-soft/50 text-moss-ink")}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}
