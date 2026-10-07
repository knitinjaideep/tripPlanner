"use client";

import type { ComponentProps } from "react";
import { useTripAccess } from "@/components/trip/trip-access";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { importExploreCollection, type ImportState } from "@/app/actions/places";
import { FormMessage } from "@/components/forms/fields";
import { formatDateRange } from "@/lib/dates";
import { exploreHref } from "@/lib/explore";
import { cn } from "@/lib/utils";

export type CollectionOffer = {
  id: string;
  label: string;
  heading: string;
  subheading: string;
  sourceKeys: string[];
  counts: { outings: number; restaurants: number; spas: number };
  otherTrips: { id: string; title: string; start_date: string; end_date: string }[];
};

const primary =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-70";

/**
 * "Add Aruba recommendations": one explicit, authenticated action that adds
 * the curated places to this trip's Explore. Nothing is written on page
 * load. Repeating it is safe (the server finds what is already there), and
 * the card disappears once everything is in — except for the result summary,
 * which stays until dismissed so flagged duplicates aren't missed.
 */
function CollectionImportCardInner({
  tripId,
  tripTitle,
  offer,
  presentKeys,
}: {
  tripId: string;
  tripTitle: string;
  offer: CollectionOffer;
  /** Source keys already on this trip's places. */
  presentKeys: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportState | null>(null);
  const busy = useRef(false);
  const present = new Set(presentKeys);
  const missing = offer.sourceKeys.filter((k) => !present.has(k)).length;
  const total = offer.sourceKeys.length;

  const run = () => {
    // Repeated clicks while a request is in flight are ignored (the server would also find nothing new).
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const outcome = await importExploreCollection(tripId, offer.id);
        setResult(outcome);
        if (outcome.ok) toast.success(outcome.message);
      } catch {
        setResult({ ok: false, message: "Couldn’t reach Atlas. Nothing was added — check your connection and try again." });
      } finally {
        busy.current = false;
      }
    });
  };

  const summary = result?.ok ? result.summary : undefined;
  if (missing === 0 && !result) return null;

  const { outings, restaurants, spas } = offer.counts;
  const button = (
    <button type="button" onClick={run} disabled={pending} aria-busy={pending} className={primary}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
      {pending ? "Adding…" : missing === total ? `Add ${offer.label}` : `Add the other ${missing}`}
    </button>
  );

  const body = (
    <>
      {missing > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-ink">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 basis-60">
            <p className="font-semibold text-ink">{offer.label}</p>
            <p className="text-sm text-muted-foreground">
              {missing === total
                ? `${total} curated ideas — ${outings} easy outings, ${restaurants} vegetarian-friendly restaurants and ${spas} spas for taking turns.`
                : `${total - missing} of ${total} are already in Explore.`}{" "}
              Suggestions, not bookings — your own places and notes stay as they are.
            </p>
            {offer.otherTrips.length ? (
              <p className="mt-1 text-sm text-muted-foreground">
                These go into “{tripTitle}” only. Planning a different trip?{" "}
                {offer.otherTrips.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 ? ", " : ""}
                    <Link href={exploreHref(t.id, {})} className="font-semibold text-moss-ink underline underline-offset-2">
                      {t.title} ({formatDateRange(t.start_date, t.end_date, "short")})
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          {button}
        </div>
      ) : null}

      {result && !result.ok ? (
        <div className="mt-3">
          <FormMessage message={result.message} signedOut={result.signedOut} />
        </div>
      ) : null}

      {summary ? (
        <div role="status" className={cn("rounded-xl bg-moss-soft/60 p-3.5 text-sm text-ink", missing > 0 && "mt-3")}>
          <div className="flex items-start gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-moss-ink" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="font-semibold">{result?.message}</p>
              {summary.linked.length ? (
                <p>
                  Matched to places you’d saved (kept your names, notes and favorites):{" "}
                  {summary.linked.map((l) => `“${l.placeName}”`).join(", ")}.
                </p>
              ) : null}
              {summary.possibleDuplicates.map((d) => (
                <p key={d.name} className="flex gap-1.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-deep" aria-hidden="true" />
                  <span>
                    Possible duplicate: “{d.name}” looks like {d.matches.map((m) => `“${m}”`).join(", ")}. Remove one if they’re the same place.
                  </span>
                </p>
              ))}
              {summary.skipped.map((d) => (
                <p key={d.name} className="flex gap-1.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-deep" aria-hidden="true" />
                  <span>
                    Skipped “{d.name}”: you have {d.matches.length} places with that name. Remove or rename the extra one, then add again.
                  </span>
                </p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="focus-ring -m-1.5 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/70 hover:text-ink"
              aria-label="Dismiss"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <section
      aria-label={offer.label}
      className="rounded-2xl border border-gold/50 bg-surface p-4 shadow-[0_10px_28px_-18px_rgba(139,111,71,0.45)]"
    >
      {body}
    </section>
  );
}

/** Editors and the owner only; viewers never see this control (the server refuses it regardless). */
export function CollectionImportCard(props: ComponentProps<typeof CollectionImportCardInner>) {
  const { canEdit } = useTripAccess();
  return canEdit ? <CollectionImportCardInner {...props} /> : null;
}
