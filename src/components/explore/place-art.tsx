import {
  Bookmark,
  Building,
  Coffee,
  Croissant,
  IceCreamCone,
  Landmark,
  Moon,
  Mountain,
  ShoppingBag,
  Sparkles,
  Store,
  Trees,
  UtensilsCrossed,
  WavesHorizontal,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { PlaceCategory } from "@/lib/plan-options";
import { cn } from "@/lib/utils";

/**
 * Category artwork for places without a real photo: a soft gradient tile
 * with an icon. Deliberately illustrative — never a stock photo that could
 * be mistaken for the actual place.
 */
export const PLACE_ART: Record<PlaceCategory, { icon: LucideIcon; tile: string; ink: string }> = {
  sight: { icon: Landmark, tile: "from-[#d9f1f3] to-[#bfe6ea]", ink: "text-teal-ink" },
  museum: { icon: Building, tile: "from-[#eee8ff] to-[#ddd3ff]", ink: "text-lavender-ink" },
  nature: { icon: Mountain, tile: "from-[#e4f4e7] to-[#cbe9d2]", ink: "text-[#2f6b45]" },
  beach: { icon: WavesHorizontal, tile: "from-[#dff3f6] to-[#fff3ca]", ink: "text-[#0f6b7a]" },
  park: { icon: Trees, tile: "from-[#e9f5ec] to-[#d4ecd9]", ink: "text-[#2f6b45]" },
  shopping: { icon: ShoppingBag, tile: "from-[#ffece7] to-[#ffd9cf]", ink: "text-[#a33a2b]" },
  nightlife: { icon: Moon, tile: "from-[#e3e4f7] to-[#cfd1f0]", ink: "text-[#3b3f8f]" },
  experience: { icon: Sparkles, tile: "from-[#fff6d8] to-[#ffe9a8]", ink: "text-[#7a5a00]" },
  restaurant: { icon: UtensilsCrossed, tile: "from-[#ffe9e4] to-[#ffd4cb]", ink: "text-[#a33a2b]" },
  cafe: { icon: Coffee, tile: "from-[#f6ece3] to-[#ecd9c6]", ink: "text-[#7a4a22]" },
  bar: { icon: Wine, tile: "from-[#f8e6ee] to-[#efcfdc]", ink: "text-[#8a2c55]" },
  bakery: { icon: Croissant, tile: "from-[#fff3dc] to-[#fde2b3]", ink: "text-[#8a5a10]" },
  dessert: { icon: IceCreamCone, tile: "from-[#ffeef4] to-[#ffd9e6]", ink: "text-[#a33a63]" },
  market: { icon: Store, tile: "from-[#eef6e4] to-[#dcedc8]", ink: "text-[#4a6b1f]" },
  other: { icon: Bookmark, tile: "from-[#f3f6f7] to-[#e3eaed]", ink: "text-ink" },
};

export function placeArt(category: string) {
  return PLACE_ART[(category in PLACE_ART ? category : "other") as PlaceCategory];
}

export function PlaceArt({ category, className, iconClassName }: { category: string; className?: string; iconClassName?: string }) {
  const art = placeArt(category);
  const Icon = art.icon;
  return (
    <span className={cn("grid shrink-0 place-items-center bg-gradient-to-br", art.tile, art.ink, className)} aria-hidden="true">
      <Icon className={cn("size-6", iconClassName)} strokeWidth={1.75} />
    </span>
  );
}
