"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Optional 1–5 rating as native radios (arrow keys work); "Clear" removes it. Submits `name` ("rating"). */
export function StarRatingInput({
  defaultValue,
  legend = "Rating (optional)",
  name = "rating",
  onChange,
}: {
  defaultValue: number | null;
  legend?: string;
  name?: string;
  onChange?: (rating: number | null) => void;
}) {
  const [rating, setRatingState] = useState(defaultValue ?? 0);
  const setRating = (n: number) => {
    setRatingState(n);
    onChange?.(n || null);
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{legend}</legend>
      <div className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
              className="peer sr-only"
            />
            <span className="grid size-10 place-items-center rounded-lg peer-focus-visible:ring-3 peer-focus-visible:ring-moss/40">
              <Star className={cn("size-6", n <= rating ? "fill-gold text-gold-deep" : "text-input")} aria-hidden="true" />
              <span className="sr-only">{n === 1 ? "1 star" : `${n} stars`}</span>
            </span>
          </label>
        ))}
      </div>
      {rating ? (
        <button
          type="button"
          onClick={() => setRating(0)}
          className="focus-ring min-h-10 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-ink"
        >
          Clear<span className="sr-only"> rating</span>
        </button>
      ) : null}
    </fieldset>
  );
}

/** Read-only stars for a visit's own rating (never shown when there is none). */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex", className)} aria-label={`${value} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-3.5", n <= value ? "fill-gold text-gold-deep" : "text-input")} aria-hidden="true" />
      ))}
    </span>
  );
}
