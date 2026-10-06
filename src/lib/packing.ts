/**
 * Pure packing helpers shared by the server (queries) and the UI: the
 * starter checklist, name matching, merge planning and progress. No
 * imports from the database layer, so Client Components can use it.
 */

/* --------------------------- starter list --------------------------- */

/**
 * A generic family-trip starter. It is a local template: nothing is stored
 * until the traveler picks categories and applies it, and every copied row
 * is an ordinary, editable item. Quantities stay at 1 — the app doesn't
 * guess how many people are going or what anyone needs medically.
 */
export const STARTER_CATEGORIES = [
  {
    key: "essentials",
    name: "Essentials",
    items: ["Passports / IDs", "Wallet and cards", "Phones", "Travel documents", "House keys", "Reusable water bottles"],
  },
  {
    key: "clothes",
    name: "Clothes",
    items: ["T-shirts", "Shorts", "Pants", "Underwear", "Socks", "Pajamas", "Light jacket", "Walking shoes", "Sandals"],
  },
  {
    key: "toiletries",
    name: "Toiletries",
    items: ["Toothbrushes", "Toothpaste", "Shampoo", "Deodorant", "Hairbrush", "Lip balm", "Toiletry bag"],
  },
  {
    key: "baby",
    name: "Baby",
    items: ["Diapers", "Wipes", "Baby clothes", "Bottles", "Snacks", "Stroller", "Baby carrier", "Favorite toy", "Blanket"],
  },
  {
    key: "beach",
    name: "Beach",
    items: ["Swimsuits", "Sunscreen", "Hats", "Sunglasses", "Beach towels", "Beach bag", "Sand toys"],
  },
  {
    key: "electronics",
    name: "Electronics",
    items: ["Phone chargers", "Power bank", "Headphones", "Plug adapters", "Tablet", "Camera"],
  },
] as const;

export type StarterKey = (typeof STARTER_CATEGORIES)[number]["key"];
export const STARTER_KEYS = STARTER_CATEGORIES.map((c) => c.key) as [StarterKey, ...StarterKey[]];

/* ------------------------------ matching ---------------------------- */

/** Case-, accent- and spacing-insensitive name used to match categories and items. */
export function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Items match when the label matches and so does the traveler (blank =
 * nobody): "Swimsuit · Mia" and "Swimsuit · Leo" are different rows.
 */
export const itemKey = (label: string, traveler: string | null) =>
  `${normalizeName(label)}\u0000${normalizeName(traveler ?? "")}`;

export type MergeSourceCategory = {
  name: string;
  items: { label: string; quantity: number; traveler_name: string | null; notes: string | null }[];
};

export type MergeTargetCategory = {
  id: string;
  name: string;
  items: { label: string; traveler_name: string | null }[];
};

export type MergePlan = {
  categories: {
    /** Existing destination category, or null to create one with `name`. */
    targetId: string | null;
    name: string;
    add: MergeSourceCategory["items"];
    skipped: number;
  }[];
  addedItems: number;
  skippedItems: number;
  newCategories: number;
};

/**
 * Add-missing merge used by the starter and by "copy from another trip":
 * categories with the same name are combined; an item already in that
 * category (same name and traveler) is skipped. Nothing existing changes.
 * Repeats inside the source collapse too, so applying twice adds nothing.
 */
export function planMerge(source: MergeSourceCategory[], target: MergeTargetCategory[]): MergePlan {
  const byName = new Map(target.map((c) => [normalizeName(c.name), c]));
  const groups = new Map<string, MergePlan["categories"][number] & { seen: Set<string> }>();

  for (const category of source) {
    const nameKey = normalizeName(category.name);
    let group = groups.get(nameKey);
    if (!group) {
      const existing = byName.get(nameKey);
      group = {
        targetId: existing?.id ?? null,
        name: existing?.name ?? category.name.trim(),
        add: [],
        skipped: 0,
        seen: new Set(existing?.items.map((i) => itemKey(i.label, i.traveler_name)) ?? []),
      };
      groups.set(nameKey, group);
    }
    for (const item of category.items) {
      const key = itemKey(item.label, item.traveler_name);
      if (group.seen.has(key)) {
        group.skipped++;
      } else {
        group.seen.add(key);
        group.add.push(item);
      }
    }
  }

  const categories = [...groups.values()].map((g) => ({ targetId: g.targetId, name: g.name, add: g.add, skipped: g.skipped }));
  return {
    categories,
    addedItems: categories.reduce((n, c) => n + c.add.length, 0),
    skippedItems: categories.reduce((n, c) => n + c.skipped, 0),
    newCategories: categories.filter((c) => c.targetId === null && c.add.length > 0).length,
  };
}

/** The starter's chosen categories in merge form. */
export function starterSource(keys: readonly StarterKey[]): MergeSourceCategory[] {
  return STARTER_CATEGORIES.filter((c) => keys.includes(c.key)).map((c) => ({
    name: c.name,
    items: c.items.map((label) => ({ label, quantity: 1, traveler_name: null, notes: null })),
  }));
}

/* ------------------------------ progress ---------------------------- */

type ProgressItem = { is_packed: boolean };

export type Progress = { total: number; packed: number; remaining: number; percent: number };

/** Rows, not units: an item with quantity 3 counts once. Safe for empty lists. */
export function progressOf(items: readonly ProgressItem[]): Progress {
  const total = items.length;
  const packed = items.filter((i) => i.is_packed).length;
  // Floor so 99.6% never reads as "100%" while something is still unpacked.
  const percent = total === 0 ? 0 : Math.floor((packed / total) * 100);
  return { total, packed, remaining: total - packed, percent };
}

/* ------------------------------- filters ---------------------------- */

export type PackedFilter = "all" | "remaining" | "packed";
/** "" = everyone; UNASSIGNED = items without a traveler; otherwise a name. */
export const UNASSIGNED = "\u0000unassigned";

type FilterItem = ProgressItem & { traveler_name: string | null };

export function matchesFilters(item: FilterItem, show: PackedFilter, traveler: string) {
  if (show === "remaining" && item.is_packed) return false;
  if (show === "packed" && !item.is_packed) return false;
  if (traveler === UNASSIGNED) return !item.traveler_name;
  if (traveler) return normalizeName(item.traveler_name ?? "") === normalizeName(traveler);
  return true;
}

/**
 * Traveler suggestions: the trip's current travelers, then any other names
 * already assigned on this list (kept even after the trip's list changes).
 */
export function travelerSuggestions(tripTravelers: readonly string[], assigned: readonly (string | null)[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...tripTravelers, ...assigned]) {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(normalizeName(trimmed))) continue;
    seen.add(normalizeName(trimmed));
    out.push(trimmed);
  }
  return out;
}

/** Swap an id with its neighbour; returns null when it can't move that way. */
export function moveInOrder(ids: readonly string[], id: string, direction: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
