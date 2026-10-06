import { BedDouble, Bookmark, Bus, Coffee, Landmark, Sparkles, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ItineraryCategory } from "@/lib/plan-options";
import type { ReservationKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BOOKING_ICONS } from "@/components/trip/booking-icon";

/** Subtle per-category tints, matching the booking icon palette. */
export const CATEGORY_STYLE: Record<ItineraryCategory, { icon: LucideIcon; tint: string; dot: string }> = {
  activity: { icon: Sparkles, tint: "bg-sun text-[#7a5a00]", dot: "bg-[#d9a400]" },
  sightseeing: { icon: Landmark, tint: "bg-teal-soft text-teal-ink", dot: "bg-teal" },
  food: { icon: UtensilsCrossed, tint: "bg-[#ffe9e4] text-[#a33a2b]", dot: "bg-coral-bright" },
  transport: { icon: Bus, tint: "bg-[#e8f0fb] text-[#2d5a96]", dot: "bg-[#5b86c4]" },
  lodging: { icon: BedDouble, tint: "bg-lavender text-lavender-ink", dot: "bg-[#8a78d1]" },
  rest: { icon: Coffee, tint: "bg-[#e9f5ec] text-[#2f6b45]", dot: "bg-[#5aa877]" },
  other: { icon: Bookmark, tint: "bg-secondary text-ink", dot: "bg-[#9aa8b0]" },
};

/** Category icon; bookings use their own kind's icon (plane, bed…) in the category tint. */
export function CategoryIcon({
  category,
  kind,
  className,
}: {
  category: ItineraryCategory;
  kind?: ReservationKind | null;
  className?: string;
}) {
  const style = CATEGORY_STYLE[category];
  const Icon = kind ? BOOKING_ICONS[kind] : style.icon;
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", style.tint, className)}>
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
