"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

export default function ItineraryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="card-surface mx-auto max-w-xl px-6 py-10 text-center">
      <p className="eyebrow text-coral">Itinerary unavailable</p>
      <h2 className="font-display mt-3 text-3xl font-semibold text-ink">We couldn’t load your plans</h2>
      <p className="mt-2 text-muted-foreground">Nothing was changed. This is usually temporary — try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="focus-ring mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-moss-ink px-5 font-semibold text-white hover:bg-moss-hover"
      >
        <RotateCcw className="size-4" aria-hidden="true" /> Try again
      </button>
    </div>
  );
}
