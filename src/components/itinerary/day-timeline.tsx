"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { Compass, Plus } from "lucide-react";
import { toast } from "sonner";
import { reorderFlexibleEntries } from "@/app/actions/itinerary";
import { findOverlaps, splitDay, type AgendaEntry } from "@/lib/schedule";
import { EntryCard } from "./entry-card";
import { AddActivityButton, useItinerary } from "./itinerary-workspace";

/** Can this flexible entry be reordered? (Not check-outs/arrivals, not cancelled bookings.) */
const movable = (e: AgendaEntry) => e.role !== "end" && !e.cancelled;

export function DayTimeline({ entries }: { entries: AgendaEntry[] }) {
  const { tripId } = useItinerary();
  const { timed, flexible } = useMemo(() => splitDay(entries), [entries]);
  const overlaps = useMemo(() => findOverlaps(timed), [timed]);

  const serverOrder = useMemo(() => flexible.filter(movable).map((e) => e.key), [flexible]);
  const [order, setOptimisticOrder] = useOptimistic(serverOrder);
  const [pending, startTransition] = useTransition();
  const byKey = new Map(flexible.map((e) => [e.key, e]));
  const ordered = order.map((k) => byKey.get(k)).filter((e): e is AgendaEntry => Boolean(e));
  const fixed = flexible.filter((e) => !movable(e));

  const move = (key: string, direction: -1 | 1) => {
    const from = order.indexOf(key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    startTransition(async () => {
      setOptimisticOrder(next);
      const result = await reorderFlexibleEntries(tripId, next);
      // On failure the optimistic order falls back to the saved one.
      if (!result.ok) toast.error(result.message ?? "Couldn’t save the new order.");
    });
    // Keep keyboard focus on the moved entry's control (or its other arrow at an end).
    requestAnimationFrame(() => {
      const atEdge = to === 0 || to === order.length - 1;
      const same = document.getElementById(`reorder-${direction === -1 ? "up" : "down"}-${key}`);
      const other = document.getElementById(`reorder-${direction === -1 ? "down" : "up"}-${key}`);
      (atEdge ? other : same)?.focus();
    });
  };

  if (entries.length === 0) return <EmptyDay />;

  return (
    <div className="space-y-8">
      {timed.length > 0 ? (
        <section aria-label="Timed plans">
          <ol className="-ml-1">
            {timed.map((e) => (
              <EntryCard key={e.key} entry={e} variant="timed" overlaps={overlaps.get(e.key)} />
            ))}
          </ol>
        </section>
      ) : null}

      {flexible.length > 0 ? (
        <section aria-labelledby="flexible-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 id="flexible-heading" className="eyebrow text-ink">
              Flexible
            </h3>
            <p className="text-sm text-muted-foreground">No set time{ordered.length > 1 ? " · in your order" : ""}</p>
          </div>
          <ul className="space-y-3">
            {ordered.map((e, i) => (
              <li key={e.key}>
                <EntryCard
                  entry={e}
                  variant="flexible"
                  reorder={
                    ordered.length > 1
                      ? {
                          canUp: i > 0,
                          canDown: i < ordered.length - 1,
                          onMove: (direction) => move(e.key, direction),
                          pending,
                        }
                      : undefined
                  }
                />
              </li>
            ))}
            {fixed.map((e) => (
              <li key={e.key}>
                <EntryCard entry={e} variant="flexible" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EmptyDay() {
  return (
    <div className="rounded-2xl border border-dashed border-input bg-surface/60 px-6 py-10 text-center">
      <p className="font-display text-2xl font-semibold text-ink">Nothing planned yet.</p>
      <p className="mx-auto mt-2 max-w-sm text-muted-foreground">
        Leave it open or add something to look forward to.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <AddActivityButton className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-teal-ink px-5 text-[0.9375rem] font-semibold text-teal-ink hover:bg-teal-soft">
          <Plus className="size-4" aria-hidden="true" /> Add activity
        </AddActivityButton>
        <AddActivityButton
          mode="place"
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[0.9375rem] font-semibold text-ink hover:bg-secondary"
        >
          <Compass className="size-4" aria-hidden="true" /> From Explore
        </AddActivityButton>
      </div>
    </div>
  );
}
