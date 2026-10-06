import { BedDouble, Bookmark, Bus, Coffee, Landmark, Sparkles, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ItineraryCategory } from "@/lib/plan-options";
import type { ReservationKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BOOKING_ICONS } from "@/components/trip/booking-icon";

/** Subtle per-category tints, matching the booking icon palette. */
export const CATEGORY_STYLE: Record<ItineraryCategory, { icon: LucideIcon; tint: string; dot: string }> = {
  activity: { icon: Sparkles, tint: "bg-gold-soft text-gold-ink", dot: "bg-gold" },
  sightseeing: { icon: Landmark, tint: "bg-moss-soft text-moss-ink", dot: "bg-moss" },
  food: { icon: UtensilsCrossed, tint: "bg-[#ffe9e4] text-[#a33a2b]", dot: "bg-coral-bright" },
  transport: { icon: Bus, tint: "bg-info-soft text-info-ink", dot: "bg-info" },
  lodging: { icon: BedDouble, tint: "bg-surface-warm text-earth-ink", dot: "bg-earth" },
  rest: { icon: Coffee, tint: "bg-[#e9f5ec] text-[#2f6b45]", dot: "bg-[#5aa877]" },
  other: { icon: Bookmark, tint: "bg-secondary text-ink", dot: "bg-[#a8ad98]" },
};

/** Category icon; bookings use their own kind's icon (plane, bed…) in the category tint. */
export function CategoryIcon({
  category,
  kind,
  icon,
  className,
}: {
  category: ItineraryCategory;
  kind?: ReservationKind | null;
  /** Overrides the category icon (e.g. a protected rest window). */
  icon?: LucideIcon;
  className?: string;
}) {
  const style = CATEGORY_STYLE[category];
  const Icon = icon ?? (kind ? BOOKING_ICONS[kind] : style.icon);
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", style.tint, className)}>
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
