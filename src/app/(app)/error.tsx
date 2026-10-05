"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="eyebrow text-coral">Something went wrong</p>
      <h1 className="font-display mt-3 text-4xl font-semibold text-ink">We hit a bit of turbulence</h1>
      <p className="mt-3 text-muted-foreground">
        Your trips are safe. This is usually temporary — try again in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="focus-ring mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral px-5 font-semibold text-white hover:bg-coral-hover"
      >
        <RotateCcw className="size-4" aria-hidden="true" /> Try again
      </button>
    </main>
  );
}
