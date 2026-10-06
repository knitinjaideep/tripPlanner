import {
  Baby,
  Bath,
  FileText,
  Footprints,
  Gamepad2,
  IdCard,
  Package,
  Pill,
  Plug,
  Shirt,
  TreePalm,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { normalizeName } from "@/lib/packing";
import { cn } from "@/lib/utils";

const ICONS = {
  essentials: IdCard,
  clothes: Shirt,
  toiletries: Bath,
  baby: Baby,
  beach: TreePalm,
  electronics: Plug,
  shoes: Footprints,
  food: Utensils,
  games: Gamepad2,
  health: Pill,
  papers: FileText,
  other: Package,
} satisfies Record<string, LucideIcon>;

/** Small icon guessed from the category's name; anything else gets a plain box. */
const RULES: [RegExp, keyof typeof ICONS][] = [
  [/essential|document|passport|travel doc/, "essentials"],
  [/cloth|wear|outfit/, "clothes"],
  [/toilet|bath|hygien|wash/, "toiletries"],
  [/baby|kid|child|toddler/, "baby"],
  [/beach|pool|swim|sun/, "beach"],
  [/electr|tech|gadget|charg/, "electronics"],
  [/shoe|foot/, "shoes"],
  [/snack|food|kitchen/, "food"],
  [/game|toy|entertain|play/, "games"],
  [/medic|health|first aid/, "health"],
  [/paper|print/, "papers"],
];

const iconKey = (name: string) => RULES.find(([re]) => re.test(normalizeName(name)))?.[1] ?? "other";

export function PackingCategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[iconKey(name)];
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-moss-soft text-moss-ink", className)}>
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
