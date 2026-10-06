import { BedDouble, Bookmark, Car, Plane, Ticket, TrainFront, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ReservationKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const BOOKING_ICONS: Record<ReservationKind, LucideIcon> = {
  flight: Plane,
  lodging: BedDouble,
  car: Car,
  train: TrainFront,
  activity: Ticket,
  restaurant: UtensilsCrossed,
  other: Bookmark,
};

const TINTS: Record<ReservationKind, string> = {
  flight: "bg-moss-soft text-moss-ink",
  lodging: "bg-surface-warm text-earth-ink",
  car: "bg-info-soft text-info-ink",
  train: "bg-info-soft text-info-ink",
  activity: "bg-gold-soft text-gold-ink",
  restaurant: "bg-[#ffe9e4] text-[#a33a2b]",
  other: "bg-secondary text-ink",
};

export function BookingIcon({ kind, className }: { kind: ReservationKind; className?: string }) {
  const Icon = BOOKING_ICONS[kind];
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", TINTS[kind], className)}>
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}
