"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { controlClass } from "@/components/forms/fields";
import { exploreHref, type ExploreFilters } from "@/lib/explore";
import { cn } from "@/lib/utils";

const KIND_LABELS = { all: "All", place: "Places", food: "Food" } as const;

/**
 * One toolbar for every filter. Each change is a URL update, so filters
 * survive refresh, sharing a link and back/forward. Typing in search
 * replaces the URL (no history entry per keystroke).
 */
export function ExploreToolbar({
  tripId,
  filters,
  counts,
}: {
  tripId: string;
  filters: ExploreFilters;
  counts: Record<ExploreFilters["kind"], number>;
}) {
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
  const filtered = filters.kind !== "all" || filters.q || filters.priority !== "all" || filters.status !== "all";

  return (
    <div role="search" aria-label="Filter places" className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <nav aria-label="Kind" className="flex shrink-0 gap-1 rounded-xl bg-secondary p-1">
        {(Object.keys(KIND_LABELS) as ExploreFilters["kind"][]).map((k) => (
          <Link
            key={k}
            href={exploreHref(tripId, { ...filters, kind: k })}
            scroll={false}
            aria-current={filters.kind === k ? "page" : undefined}
            className={cn(
              "focus-ring flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-colors lg:flex-none",
              filters.kind === k ? "bg-white text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
            )}
          >
            {KIND_LABELS[k]}
            <span className="text-xs font-medium text-muted-foreground">{counts[k]}</span>
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search by name</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name"
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
        className={cn(controlClass, "w-full appearance-none border pr-9 font-medium sm:w-auto", value !== "all" && "border-teal bg-teal-soft/50 text-teal-ink")}
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
