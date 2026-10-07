"use client";

import { useOptimistic, useTransition } from "react";
import { Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setPlaceFavorite } from "@/app/actions/places";
import { cn } from "@/lib/utils";

/**
 * Heart for an Explore place. Shows the change at once, sends "set to X"
 * (never "toggle"), ignores clicks while a save is in flight, and returns to
 * the saved value with an explanation if the server refuses.
 */
export function FavoriteButton({
  tripId,
  placeId,
  placeName,
  favorite,
  variant = "icon",
  className,
}: {
  tripId: string;
  placeId: string;
  placeName: string;
  favorite: boolean;
  /** "icon": a 44 px heart (cards). "label": heart + text (detail panel). */
  variant?: "icon" | "label";
  className?: string;
}) {
  // The saved value comes from the server (revalidated after each save);
  // the optimistic one falls back to it when a save fails.
  const [value, setOptimistic] = useOptimistic(favorite);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (pending) return;
    const next = !value;
    startTransition(async () => {
      setOptimistic(next);
      const result = await setPlaceFavorite(tripId, placeId, next);
      if (!result.ok) toast.error(result.message ?? "Couldn’t save that favorite.");
    });
  };

  const label = value ? `Remove ${placeName} from your favorites` : `Save ${placeName} to your favorites (private)`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={value}
      aria-label={variant === "icon" ? label : undefined}
      aria-busy={pending}
      title={variant === "icon" ? label : undefined}
      className={cn(
        "focus-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors",
        variant === "icon" ? "min-w-11" : "border border-border bg-surface px-3.5",
        value ? "text-[#a33a2b] hover:bg-[#fff1ee]" : "text-muted-foreground hover:bg-secondary hover:text-ink",
        className,
      )}
    >
      {pending && variant === "label" ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Heart className={cn("size-[1.125rem]", value && "fill-current")} aria-hidden="true" />
      )}
      {variant === "label" ? (value ? "Favorite" : "Add to favorites") : null}
    </button>
  );
}
