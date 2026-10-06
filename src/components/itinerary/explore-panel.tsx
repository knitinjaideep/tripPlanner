"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Compass, Landmark, Loader2, Plus, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { schedulePlace } from "@/app/actions/itinerary";
import { secondaryButtonClass } from "@/components/forms/fields";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { visitState } from "@/lib/explore";
import { LABELS } from "@/lib/plan-options";
import { cn } from "@/lib/utils";
import { useItinerary } from "./itinerary-workspace";
import type { ExplorePlace } from "./types";

const VISIBLE = 6;

const categoryFor = (p: ExplorePlace) => (p.kind === "food" ? "food" : "sightseeing");

/** This trip's Explore places that aren't on the itinerary yet, with one-tap scheduling. */
export function ExplorePanel({ places, dayLabel }: { places: ExplorePlace[]; dayLabel: string }) {
  const { tripId, selectedDate } = useItinerary();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [showScheduled, setShowScheduled] = useState(false);
  const [repeat, setRepeat] = useState<ExplorePlace | null>(null);
  const [showAll, setShowAll] = useState(false);

  const unscheduled = places.filter((p) => visitState(p).unscheduled);
  const scheduled = places.filter((p) => !visitState(p).unscheduled);
  const visible = showAll ? unscheduled : unscheduled.slice(0, VISIBLE);

  const schedule = (place: ExplorePlace, again: boolean) =>
    new Promise<void>((resolve) => {
      setBusyId(place.id);
      startTransition(async () => {
        const result = await schedulePlace(tripId, place.id, selectedDate, categoryFor(place), again);
        setBusyId(null);
        if (result.ok) toast.success(`${place.name} added to ${dayLabel}.`);
        else toast.error(result.message ?? "Couldn’t add that place.");
        resolve();
      });
    });

  return (
    <section aria-labelledby="explore-heading" className="rounded-2xl bg-moss-soft/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="explore-heading" className="eyebrow flex items-center gap-2 text-moss-ink">
          <Compass className="size-4" aria-hidden="true" /> From Explore
        </h2>
        {unscheduled.length > 0 ? (
          <span className="text-xs font-medium text-moss-ink/80">{unscheduled.length} not scheduled</span>
        ) : null}
      </div>

      {places.length === 0 ? (
        <p className="mt-3 rounded-xl bg-white/80 p-4 text-sm text-muted-foreground">
          Places you save in{" "}
          <Link href={`/trips/${tripId}/explore`} className="font-semibold text-moss-ink underline-offset-2 hover:underline">
            Explore
          </Link>{" "}
          show up here, ready to drop into a day.
        </p>
      ) : unscheduled.length === 0 ? (
        <p className="mt-3 rounded-xl bg-white/80 p-4 text-sm text-muted-foreground">
          Every saved place is on your itinerary.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((p) => (
            <PlaceRow key={p.id} place={p}>
              <button
                type="button"
                onClick={() => schedule(p, false)}
                disabled={busyId === p.id}
                aria-busy={busyId === p.id}
                aria-label={`Add ${p.name} to ${dayLabel}`}
                className="focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-moss-ink hover:bg-moss-soft disabled:opacity-60"
              >
                {busyId === p.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Add to this day
              </button>
            </PlaceRow>
          ))}
        </ul>
      )}
      {unscheduled.length > VISIBLE ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="focus-ring mt-2 min-h-11 rounded-lg px-1 text-sm font-semibold text-moss-ink"
        >
          {showAll ? "Show fewer" : `Show all ${unscheduled.length}`}
        </button>
      ) : null}

      {places.length > 0 ? (
        <Link
          href={`/trips/${tripId}/explore`}
          className="focus-ring mt-1 inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-moss-ink"
        >
          Open Explore
        </Link>
      ) : null}
      {scheduled.length > 0 ? (
        <div className="mt-1 border-t border-moss/15 pt-2">
          <button
            type="button"
            onClick={() => setShowScheduled((v) => !v)}
            aria-expanded={showScheduled}
            className="focus-ring min-h-11 rounded-lg px-1 text-sm font-semibold text-moss-ink"
          >
            {showScheduled ? "Hide scheduled places" : `Already scheduled (${scheduled.length})`}
          </button>
          {showScheduled ? (
            <ul className="mt-1 space-y-2">
              {scheduled.map((p) => (
                <PlaceRow key={p.id} place={p} note={[p.planned_count ? `${p.planned_count} planned` : null, p.completed_count ? `${p.completed_count} done` : null].filter(Boolean).join(" · ")}>
                  <button
                    type="button"
                    onClick={() => setRepeat(p)}
                    disabled={busyId === p.id}
                    aria-label={`Schedule ${p.name} again on ${dayLabel}`}
                    className="focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-secondary disabled:opacity-60"
                  >
                    Add again
                  </button>
                </PlaceRow>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <RepeatDialog
        place={repeat}
        dayLabel={dayLabel}
        busy={repeat !== null && busyId === repeat.id}
        onCancel={() => setRepeat(null)}
        onConfirm={async () => {
          if (!repeat) return;
          await schedule(repeat, true);
          setRepeat(null);
        }}
      />
    </section>
  );
}

function PlaceRow({ place, note, children }: { place: ExplorePlace; note?: string; children: React.ReactNode }) {
  const Icon = place.kind === "food" ? UtensilsCrossed : Landmark;
  const category = LABELS.placeCategory[place.category as keyof typeof LABELS.placeCategory];
  return (
    <li className="flex items-center gap-3 rounded-xl bg-white/90 py-2 pr-1.5 pl-3 ring-1 ring-border/60">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full",
          place.kind === "food" ? "bg-[#ffe9e4] text-[#a33a2b]" : "bg-moss-soft text-moss-ink",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-sm font-semibold break-words text-ink">{place.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[note ?? category, place.priority === "must_do" ? "Must do" : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      {children}
    </li>
  );
}

function RepeatDialog({
  place,
  dayLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  place: ExplorePlace | null;
  dayLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog open={place !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent className="rounded-2xl p-6 sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl font-semibold text-ink">Visit again?</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] text-muted-foreground">
            {place
              ? `${place.name} is already on your itinerary${place.completed_count ? " (and you’ve been)" : ""}. This adds another visit on ${dayLabel}.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-3">
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={onConfirm}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:opacity-70"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Adding…" : "Add another visit"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
