import { BedDouble, Bookmark, Car, Plane, Ticket, TrainFront, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { BookingKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const BOOKING_ICONS: Record<BookingKind, LucideIcon> = {
  flight: Plane,
  lodging: BedDouble,
  car: Car,
  train: TrainFront,
  activity: Ticket,
  restaurant: UtensilsCrossed,
  other: Bookmark,
};

const TINTS: Record<BookingKind, string> = {
  flight: "bg-teal-soft text-teal-ink",
  lodging: "bg-lavender text-lavender-ink",
  car: "bg-[#e8f0fb] text-[#2d5a96]",
  train: "bg-[#e8f0fb] text-[#2d5a96]",
  activity: "bg-sun text-[#7a5a00]",
  restaurant: "bg-[#ffe9e4] text-[#a33a2b]",
  other: "bg-secondary text-ink",
};

export function BookingIcon({ kind, className }: { kind: BookingKind; className?: string }) {
  const Icon = BOOKING_ICONS[kind];
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", TINTS[kind], className)}>
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}
