/**
 * Arjun's Aruba packing list: user-supplied targets, imported on request into
 * the ordinary packing tables. Pure — no database imports — so the dialog can
 * preview against the list already on screen and the server can re-plan inside
 * its transaction with the same code.
 *
 * Quantities are kept as supplied. `quantity` is the number the packing row
 * needs (an exact count, or the low end of a range — never the high end);
 * `quantityText` is the exact wording whenever the number alone would be wrong.
 */
import { itemKey, normalizeName } from "@/lib/packing";

export type BabyItem = {
  /** Stable identity: section + category + label. Cabin and checked copies of an item are separate allocations. */
  key: string;
  section: string;
  category: string;
  label: string;
  traveler: string;
  quantity: number;
  quantityText: string | null;
  notes: string | null;
};

const CABIN = "Cabin luggage — Arjun";
const CHECKED = "Checked luggage — Arjun";
const AIRPORT = "Airport / gate-check gear";
const PARENTS = "Cabin essentials — Parents";

export const BABY_SECTION_NOTES: { section: string; note: string }[] = [
  { section: CABIN, note: "Supplies for the flight plus approximately 24 hours of delay." },
  { section: CHECKED, note: "Bulk supplies and the rest of the trip’s clothing." },
];

/** Informational only — shown in the preview, never stored as tasks. */
export const BABY_BAG_NOTES: { bag: string; note: string }[] = [
  { bag: "Cabin diaper bag", note: "Immediate feeding, changing, clothing, medication, and comfort essentials." },
  { bag: "Cabin carry-on", note: "Backup supplies from the cabin allocation." },
  { bag: "Checked suitcase", note: "Bulk supplies, rest-of-trip clothing, swim gear, and toiletries." },
  { bag: "Airport", note: "Stroller, car seat, and carrier logistics." },
];

const slug = (value: string) =>
  normalizeName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A row is [label, quantity, wording?, notes?]. Wording is only given when the bare number isn't the whole story. */
type Row = [label: string, quantity: number, wording?: string | null, notes?: string];

// Everything lives in the two baby categories: gate-checked gear travels with the checked bags, parents' items stay in the cabin.
const CATEGORY_OF: Record<string, string> = {
  [CABIN]: "Baby - Cabin",
  [CHECKED]: "Baby - Check in",
  [AIRPORT]: "Baby - Check in",
  [PARENTS]: "Baby - Cabin",
};

function build(section: string, category: string, traveler: string, rows: Row[]): BabyItem[] {
  // Arjun's luggage is two categories (cabin, check-in); the sub-groups below only order the rows.
  void category;
  const categoryName = CATEGORY_OF[section] ?? section;
  return rows.map(([label, quantity, wording, notes]) => ({
    key: `baby:${slug(section)}:${slug(label)}`,
    section,
    category: categoryName,
    label,
    traveler,
    quantity,
    quantityText: wording ?? null,
    notes: notes ?? null,
  }));
}

const PLANNING_TARGET = "Your own planning target — not a verified airline/security allowance or preparation instruction.";

export const BABY_ITEMS: BabyItem[] = [
  ...build(CABIN, "Feeding", "Arjun", [
    ["Enfamil formula", 1, "24–36 hours’ worth", PLANNING_TARGET],
    ["Formula dispenser", 1, "Capacity for 3–4 servings", "The 3–4 is the dispenser’s capacity, not a count of dispensers."],
    ["Baby bottles", 3],
    ["Water for formula", 1, "Enough for flight + 1 day", PLANNING_TARGET],
    ["Baby food/pouches", 4, "4–6"],
    ["Baby spoons", 2],
    ["Bibs", 3],
    ["Burp/muslin cloths", 2],
    ["Bottle cleaning brush", 1],
    ["Small wet/dry bags", 2],
  ]),
  ...build(CABIN, "Diapering", "Arjun", [
    ["Diapers", 15],
    ["Wipes", 1, "1 large pack"],
    ["Changing pad", 1],
    ["Diaper cream", 1, "1 small tube"],
    ["Disposable diaper bags", 15, "15–20"],
    ["Hand sanitizer", 1],
    ["Disposable changing liners", 5],
  ]),
  ...build(CABIN, "Clothing", "Arjun", [
    ["Complete outfits", 3, null, "Keep one of the three complete outfits easily accessible."],
    ["Extra shirts", 2],
    ["Pajamas", 1],
    ["Socks", 2, "2 pairs"],
    ["Lightweight sweater/cardigan", 1],
    ["Sun hat", 1],
    ["Muslin blanket", 1],
  ]),
  ...build(CABIN, "Comfort & entertainment", "Arjun", [
    ["Pacifiers", 3],
    ["Favorite comfort toy", 1],
    ["Small toys", 4, "4–5"],
    ["Teethers", 1, "1–2"],
    ["Small books", 1, "1–2"],
    ["Small blanket/lovey", 1],
  ]),
  ...build(CABIN, "Health & toiletries", "Arjun", [
    ["Baby sunscreen", 1],
    ["Saline drops", 1],
    ["Nasal aspirator", 1],
    ["Thermometer", 1],
    ["Usual infant medications", 1, "1 each", "Bring the medications you normally use."],
    ["Small first-aid kit", 1],
    ["Baby-safe hand wipes", 1, "1 pack"],
  ]),

  ...build(CHECKED, "Feeding", "Arjun", [
    [
      "Enfamil formula",
      1,
      "Remaining trip supply + 2 extra days",
      "Bring the full required supply from home, with 2–3 extra days overall. Split between cabin and checked luggage. Calculate checked supply after accounting for the cabin allocation. This item already includes a default 2-day reserve.",
    ],
    ["Extra bottles", 2, "2–3"],
    ["Bottle brush", 1],
    ["Extra formula dispenser", 1],
    ["Baby food/pouches", 10, "10–15"],
    ["Baby snacks", 5, "5–7 servings"],
    ["Baby spoons", 2, "2–3"],
    ["Bibs", 5],
    ["Food containers", 2, "2–3"],
  ]),
  ...build(CHECKED, "Clothing", "Arjun", [
    ["Short-sleeve outfits", 7],
    ["Shorts", 5, "5–6"],
    ["T-shirts", 7],
    ["Lightweight long-sleeve shirts", 2],
    ["Pajamas", 3],
    ["Socks", 4, "4 pairs"],
    ["Lightweight sweater", 1],
    ["Nice outfit", 1],
  ]),
  ...build(CHECKED, "Diapering & toiletries", "Arjun", [
    ["Diapers", 30, null, "Buy more locally if needed."],
    ["Wipes", 2, "2–3 large packs"],
    ["Diaper cream", 2, "2 tubes"],
    ["Disposable diaper bags", 40, "40–50"],
    ["Baby shampoo/body wash", 1],
    ["Baby lotion", 1],
    ["Baby sunscreen", 2],
    ["Baby laundry detergent", 1, "1 small bottle"],
    ["Baby nail clippers", 1],
    ["Baby toothbrush", 1],
  ]),
  // The source repeated swimsuits, UPF shirts and sun hats under clothing and Aruba gear: each is listed once.
  ...build(CHECKED, "Beach & sun", "Arjun", [
    ["Swimsuits", 2, "2–3", "Listed under both clothing and Aruba gear in the source — counted once."],
    ["UPF swim shirts", 2, null, "Listed under both clothing and Aruba gear in the source — counted once."],
    ["Sun hats", 2, null, "Listed under both clothing and Aruba gear in the source — counted once."],
    ["Swim diapers", 8, "8–10"],
    ["Baby sunglasses", 1],
    ["Lightweight beach blanket", 1],
    ["Small beach toys", 3, "3–4"],
    ["Portable shade/UV cover", 1],
  ]),

  ...build(AIRPORT, "", "Arjun", [
    ["Baby carrier", 1],
    ["Stroller", 1, null, "Confirm which stroller to bring: travel stroller or Uppababy Vista."],
    ["Car seat", 1, null, "Decide stroller/car-seat check-in arrangements and confirm the airline’s rules."],
    ["Stroller rain cover", 1],
    ["Stroller fan", 1],
    ["Small stroller organizer", 1],
  ]),

  ...build(PARENTS, "", "Nitin", [["Spare shirt", 1, null, "Keep easily accessible."]]),
  ...build(PARENTS, "", "Pavani", [["Spare shirt", 1, null, "Keep easily accessible."]]),
  ...build(PARENTS, "", "Family", [
    ["Sony A7 V camera", 1, null, "Keep camera equipment in cabin luggage."],
    ["Sony 24–70mm GM II lens", 1, null, "Keep camera equipment in cabin luggage."],
  ]),
];

// Parents' spare shirts share a label, so their keys carry the traveler.
for (const item of BABY_ITEMS) {
  if (item.section === PARENTS && item.label === "Spare shirt") item.key += `:${slug(item.traveler)}`;
}

export const BABY_CATEGORY_NAMES = [...new Set(BABY_ITEMS.map((i) => i.category))];

export const CABIN_DIAPERS_KEY = `baby:${slug(CABIN)}:diapers`;
export const CHECKED_DIAPERS_KEY = `baby:${slug(CHECKED)}:diapers`;

/* ------------------------------ planning ----------------------------- */

export type ExistingCategory = {
  id: string;
  name: string;
  items: {
    id: string;
    label: string;
    traveler_name: string | null;
    quantity: number;
    quantity_text: string | null;
    source_key: string | null;
  }[];
};

export type PlanEntry =
  | { status: "new"; item: BabyItem }
  /** Already on the list; `adopt` = matched by name, so the stable key is recorded on it. */
  | { status: "match"; item: BabyItem; existingId: string; adopt: boolean }
  /** Matched, but the supplied quantity differs from the stored one: only changed if the traveler accepts. */
  | { status: "conflict"; item: BabyItem; existingId: string; adopt: boolean; current: { quantity: number; quantity_text: string | null } }
  /** Something similar sits in a different category: not added unless the traveler says so. */
  | { status: "ambiguous"; item: BabyItem; elsewhere: string };

const sameQuantity = (item: BabyItem, e: { quantity: number; quantity_text: string | null }) =>
  e.quantity === item.quantity && (e.quantity_text ?? null) === item.quantityText;

export function planBabyImport(categories: readonly ExistingCategory[]): PlanEntry[] {
  const all = categories.flatMap((c) => c.items.map((i) => ({ ...i, category: c.name })));
  const byKey = new Map(all.filter((i) => i.source_key).map((i) => [i.source_key as string, i]));

  return BABY_ITEMS.map((item): PlanEntry => {
    let found = byKey.get(item.key);
    let adopt = false;

    if (!found) {
      const inCategory = all.filter(
        (i) =>
          !i.source_key &&
          normalizeName(i.category) === normalizeName(item.category) &&
          itemKey(i.label, i.traveler_name) === itemKey(item.label, item.traveler),
      );
      if (inCategory.length === 1) {
        found = inCategory[0];
        adopt = true;
      } else if (inCategory.length > 1) {
        return { status: "ambiguous", item, elsewhere: item.category };
      }
    }

    if (found) {
      return sameQuantity(item, found)
        ? { status: "match", item, existingId: found.id, adopt }
        : { status: "conflict", item, existingId: found.id, adopt, current: { quantity: found.quantity, quantity_text: found.quantity_text } };
    }

    const similar = all.find(
      (i) =>
        !i.source_key &&
        normalizeName(i.category) !== normalizeName(item.category) &&
        normalizeName(i.label) === normalizeName(item.label) &&
        (!i.traveler_name || normalizeName(i.traveler_name) === normalizeName(item.traveler)),
    );
    return similar ? { status: "ambiguous", item, elsewhere: similar.category } : { status: "new", item };
  });
}

export type PlanCounts = { added: number; matched: number; conflicts: number; ambiguous: number };

export function countPlan(plan: readonly PlanEntry[]): PlanCounts {
  const n = (s: PlanEntry["status"]) => plan.filter((p) => p.status === s).length;
  return { added: n("new"), matched: n("match"), conflicts: n("conflict"), ambiguous: n("ambiguous") };
}

/* ------------------------------ display ------------------------------ */

/** What to show as the quantity: the supplied wording, else ×N for more than one, else nothing. */
export function quantityLabel(item: { quantity: number; quantity_text?: string | null }) {
  if (item.quantity_text) return item.quantity_text;
  return item.quantity > 1 ? `×${item.quantity}` : null;
}

/** Cabin + checked diapers, derived from the rows so edits are reflected. Null unless both are plain numbers. */
export function diaperSummary(categories: readonly { items: readonly { source_key?: string | null; quantity: number; quantity_text?: string | null }[] }[]) {
  const items = categories.flatMap((c) => c.items);
  const cabin = items.find((i) => i.source_key === CABIN_DIAPERS_KEY);
  const checked = items.find((i) => i.source_key === CHECKED_DIAPERS_KEY);
  if (!cabin || !checked || cabin.quantity_text || checked.quantity_text) return null;
  return { cabin: cabin.quantity, checked: checked.quantity, total: cabin.quantity + checked.quantity };
}
