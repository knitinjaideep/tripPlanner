/**
 * Pure Packing checks — progress, the starter template, add-missing merges,
 * filters, traveler suggestions, reordering and the checkbox save queue
 * (rapid clicks, failures). No database needed:
 *
 *   npm run test:packing
 */
import assert from "node:assert/strict";
import { createPackedSync, type SendResult } from "../src/lib/packed-sync";
import {
  STARTER_CATEGORIES,
  UNASSIGNED,
  matchesFilters,
  moveInOrder,
  planMerge,
  progressOf,
  starterSource,
  travelerSuggestions,
  type MergeTargetCategory,
} from "../src/lib/packing";
import {
  BABY_ITEMS,
  CABIN_DIAPERS_KEY,
  CHECKED_DIAPERS_KEY,
  countPlan,
  diaperSummary,
  planBabyImport,
  quantityLabel,
  type ExistingCategory,
} from "../src/lib/baby-packing";
import { babyImportSchema, packingCopySchema, packingItemSchema, packingStarterSchema } from "../src/lib/validation";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const packed = (n: number, of: number) => Array.from({ length: of }, (_, i) => ({ is_packed: i < n }));

async function main() {
  console.log("Progress");
  await check("empty list: 0 of 0, 0%, no division by zero", () => {
    assert.deepEqual(progressOf([]), { total: 0, packed: 0, remaining: 0, percent: 0 });
  });
  await check("partial list counts rows and floors the percentage", () => {
    assert.deepEqual(progressOf(packed(1, 3)), { total: 3, packed: 1, remaining: 2, percent: 33 });
    // 199 of 200 must not read as 100%.
    assert.equal(progressOf(packed(199, 200)).percent, 99);
  });
  await check("complete list is 100% with nothing remaining", () => {
    assert.deepEqual(progressOf(packed(4, 4)), { total: 4, packed: 4, remaining: 0, percent: 100 });
  });
  await check("quantity doesn't change progress (rows, not units)", () => {
    assert.equal(progressOf([{ is_packed: true, quantity: 5 }, { is_packed: false, quantity: 1 }] as never).percent, 50);
  });

  console.log("Starter checklist");
  await check("has the six family categories, each with items, quantities of 1", () => {
    assert.deepEqual(
      STARTER_CATEGORIES.map((c) => c.name),
      ["Essentials", "Clothes", "Toiletries", "Baby", "Beach", "Electronics"],
    );
    for (const c of starterSource(STARTER_CATEGORIES.map((c) => c.key))) {
      assert.ok(c.items.length >= 5, c.name);
      assert.ok(c.items.every((i) => i.quantity === 1 && i.traveler_name === null && i.notes === null));
    }
  });
  await check("makes no medical assumptions", () => {
    const all = STARTER_CATEGORIES.flatMap((c) => c.items).join(" ").toLowerCase();
    assert.ok(!/medic|prescri|inhaler|insulin|epipen|pill/.test(all));
  });
  await check("only known starter keys validate; an empty selection doesn't", () => {
    assert.ok(packingStarterSchema.safeParse(["beach", "baby"]).success);
    assert.ok(!packingStarterSchema.safeParse([]).success);
    assert.ok(!packingStarterSchema.safeParse(["weapons"]).success);
  });

  console.log("Add-missing merge");
  const target: MergeTargetCategory[] = [
    { id: "c1", name: "beach", items: [{ label: "SUNSCREEN ", traveler_name: null }] },
    { id: "c2", name: "Clothes", items: [{ label: "Swimsuit", traveler_name: "Mia" }] },
  ];
  await check("same-name categories combine (case/spacing/accents ignored); matching items are skipped", () => {
    const plan = planMerge(starterSource(["beach"]), target);
    assert.equal(plan.categories.length, 1);
    assert.equal(plan.categories[0].targetId, "c1");
    assert.equal(plan.skippedItems, 1);
    assert.equal(plan.addedItems, STARTER_CATEGORIES.find((c) => c.key === "beach")!.items.length - 1);
    assert.equal(plan.newCategories, 0);
  });
  await check("applying the starter twice adds nothing the second time", () => {
    const first = planMerge(starterSource(["essentials", "baby"]), []);
    const afterFirst: MergeTargetCategory[] = first.categories.map((c, i) => ({ id: `n${i}`, name: c.name, items: c.add }));
    const second = planMerge(starterSource(["essentials", "baby"]), afterFirst);
    assert.equal(first.newCategories, 2);
    assert.equal(second.addedItems, 0);
    assert.equal(second.newCategories, 0);
  });
  await check("same label for a different traveler is a different item", () => {
    const plan = planMerge(
      [{ name: "Clothes", items: [
        { label: "swimsuit", quantity: 2, traveler_name: "mia", notes: null },
        { label: "Swimsuit", quantity: 1, traveler_name: "Leo", notes: "blue" },
      ] }],
      target,
    );
    assert.deepEqual(plan.categories[0].add.map((i) => i.traveler_name), ["Leo"]);
    assert.equal(plan.skippedItems, 1);
  });
  await check("duplicates inside the source collapse; new categories keep source order", () => {
    const plan = planMerge(
      [
        { name: "Docs", items: [{ label: "Passport", quantity: 1, traveler_name: null, notes: null }] },
        { name: "docs", items: [{ label: "passport", quantity: 1, traveler_name: null, notes: null }] },
        { name: "Snacks", items: [{ label: "Crackers", quantity: 3, traveler_name: null, notes: "low salt" }] },
      ],
      [],
    );
    assert.deepEqual(plan.categories.map((c) => c.name), ["Docs", "Snacks"]);
    assert.equal(plan.addedItems, 2);
    assert.deepEqual(plan.categories[1].add[0], { label: "Crackers", quantity: 3, traveler_name: null, notes: "low salt" });
  });
  await check("copy input requires a trip UUID and all or at least one category", () => {
    const id = "6f1c1f43-7a3a-4b8e-9f0e-2b1b3c4d5e6f";
    assert.ok(packingCopySchema.safeParse({ source_trip_id: id, categories: "all" }).success);
    assert.ok(packingCopySchema.safeParse({ source_trip_id: id, categories: [id] }).success);
    assert.ok(!packingCopySchema.safeParse({ source_trip_id: id, categories: [] }).success);
    assert.ok(!packingCopySchema.safeParse({ source_trip_id: "../x", categories: "all" }).success);
  });

  console.log("Items, filters, travelers, order");
  await check("quantity is a positive whole number (blank = 1)", () => {
    const base = { category_id: "6f1c1f43-7a3a-4b8e-9f0e-2b1b3c4d5e6f", label: "Hat", traveler_name: "", notes: "" };
    assert.equal(packingItemSchema.parse({ ...base, quantity: "" }).quantity, 1);
    assert.equal(packingItemSchema.parse({ ...base, quantity: "3" }).quantity, 3);
    for (const bad of ["0", "-1", "1.5", "abc", "1000"]) assert.ok(!packingItemSchema.safeParse({ ...base, quantity: bad }).success, bad);
  });
  await check("All / Remaining / Packed and traveler filters combine", () => {
    const items = [
      { is_packed: true, traveler_name: "Mia" },
      { is_packed: false, traveler_name: "mia " },
      { is_packed: false, traveler_name: null },
    ];
    const n = (show: "all" | "remaining" | "packed", t: string) => items.filter((i) => matchesFilters(i, show, t)).length;
    assert.deepEqual([n("all", ""), n("remaining", ""), n("packed", "")], [3, 2, 1]);
    assert.deepEqual([n("all", "Mia"), n("remaining", "Mia"), n("all", UNASSIGNED)], [2, 1, 1]);
  });
  await check("traveler suggestions keep names no longer on the trip, without duplicates", () => {
    assert.deepEqual(travelerSuggestions(["Mia", "Leo"], ["mia", "Grandma", null, " Grandma "]), ["Mia", "Leo", "Grandma"]);
  });
  await check("moving swaps with the neighbour and refuses at the ends", () => {
    assert.deepEqual(moveInOrder(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moveInOrder(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
    assert.equal(moveInOrder(["a", "b"], "a", -1), null);
    assert.equal(moveInOrder(["a", "b"], "b", 1), null);
    assert.equal(moveInOrder(["a"], "x", 1), null);
  });

  console.log("Checkbox save queue");
  /** A fake server: records writes; each call waits until released. */
  function harness() {
    let db = false;
    const sent: boolean[] = [];
    const waiting: { packed: boolean; resolve: (r: SendResult) => void }[] = [];
    const shown: ({ packed: boolean; saving: boolean } | null)[] = [];
    const errors: string[] = [];
    const sync = createPackedSync({
      send: (_id, packed) => {
        sent.push(packed);
        return new Promise((resolve) => waiting.push({ packed, resolve }));
      },
      show: (_id, s) => shown.push(s),
      onError: (_id, m) => errors.push(m ?? ""),
    });
    const settle = async (ok = true) => {
      const next = waiting.shift()!;
      if (ok) db = next.packed;
      next.resolve(ok ? { ok: true } : { ok: false, message: "Network error." });
      await new Promise((r) => setTimeout(r, 0));
    };
    return { sync, sent, shown, errors, settle, db: () => db, inFlight: () => waiting.length };
  }

  await check("a click shows at once, stays 'saving' until the server confirms", async () => {
    const h = harness();
    void h.sync.set("i", true);
    assert.deepEqual(h.shown.at(-1), { packed: true, saving: true });
    assert.ok(h.sync.isSaving("i"));
    await h.settle();
    assert.deepEqual(h.shown.at(-1), { packed: true, saving: false });
    assert.equal(h.db(), true);
    assert.ok(!h.sync.isSaving("i"));
  });
  await check("rapid clicks: one request at a time, the last wanted value wins", async () => {
    const h = harness();
    void h.sync.set("i", true);
    void h.sync.set("i", false);
    void h.sync.set("i", true);
    void h.sync.set("i", false);
    assert.equal(h.inFlight(), 1);
    await h.settle(); // true saved; latest wanted is false → send false
    assert.deepEqual(h.sent, [true, false]);
    assert.deepEqual(h.shown.at(-1), { packed: false, saving: true });
    await h.settle();
    assert.equal(h.db(), false);
    assert.deepEqual(h.shown.at(-1), { packed: false, saving: false });
  });
  await check("clicking back to the in-flight value sends nothing extra", async () => {
    const h = harness();
    void h.sync.set("i", true);
    void h.sync.set("i", false);
    void h.sync.set("i", true);
    await h.settle();
    assert.deepEqual(h.sent, [true]);
    assert.equal(h.db(), true);
  });
  await check("a failed save rolls back to the saved value and reports it", async () => {
    const h = harness();
    void h.sync.set("i", true);
    await h.settle(false);
    assert.equal(h.shown.at(-1), null); // stop overriding → the server's value (unpacked) shows
    assert.equal(h.db(), false);
    assert.deepEqual(h.errors, ["Network error."]);
    assert.ok(!h.sync.isSaving("i"));
  });
  await check("a failure later in a rapid sequence also rolls back (no 'saved' shown)", async () => {
    const h = harness();
    void h.sync.set("i", true);
    void h.sync.set("i", false);
    await h.settle(true);
    await h.settle(false);
    assert.ok(!h.shown.some((s) => s && !s.saving && s.packed === false));
    assert.equal(h.shown.at(-1), null);
    assert.equal(h.db(), true); // server data (packed) is what shows again
  });
  await check("a thrown request (offline) is treated as a failure", async () => {
    const shown: unknown[] = [];
    const errors: string[] = [];
    const sync = createPackedSync({
      send: async () => {
        throw new Error("fetch failed");
      },
      show: (_i, s) => shown.push(s),
      onError: (_i, m) => errors.push(m ?? ""),
    });
    await sync.set("i", true);
    assert.equal(shown.at(-1), null);
    assert.equal(errors.length, 1);
  });

  const find = (label: string, section: string) => BABY_ITEMS.filter((i) => i.label === label && i.section.startsWith(section));
  // Simulates what an import stores, so a second plan sees it.
  const stored = (): ExistingCategory[] => {
    const byCat = new Map<string, ExistingCategory>();
    BABY_ITEMS.forEach((i, n) => {
      const c = byCat.get(i.category) ?? { id: i.category, name: i.category, items: [] };
      c.items.push({ id: `i${n}`, label: i.label, traveler_name: i.traveler, quantity: i.quantity, quantity_text: i.quantityText, source_key: i.key });
      byCat.set(i.category, c);
    });
    return [...byCat.values()];
  };

  await check("baby list: keys are unique and fit the database limits", () => {
    assert.equal(new Set(BABY_ITEMS.map((i) => i.key)).size, BABY_ITEMS.length);
    for (const i of BABY_ITEMS) {
      assert.ok(i.key.length <= 120 && i.category.length <= 60 && i.label.length <= 120 && (i.quantityText?.length ?? 0) <= 80);
    }
  });
  await check("baby list: cabin and checked allocations stay separate", () => {
    for (const label of ["Enfamil formula", "Diapers", "Baby spoons", "Bibs"]) {
      assert.equal(find(label, "Cabin luggage").length, 1, label);
      assert.equal(find(label, "Checked luggage").length, 1, label);
    }
  });
  await check("baby list: checked diapers 30, cabin 15, derived total 45; no 45 item", () => {
    assert.equal(BABY_ITEMS.find((i) => i.key === CHECKED_DIAPERS_KEY)?.quantity, 30);
    assert.equal(BABY_ITEMS.find((i) => i.key === CABIN_DIAPERS_KEY)?.quantity, 15);
    assert.ok(!BABY_ITEMS.some((i) => i.label === "Diapers" && i.quantity === 45));
    assert.deepEqual(diaperSummary(stored()), { cabin: 15, checked: 30, total: 45 });
    const edited = stored();
    edited.flatMap((c) => c.items).find((i) => i.source_key === CHECKED_DIAPERS_KEY)!.quantity = 20;
    assert.equal(diaperSummary(edited)?.total, 35);
  });
  await check("baby list: repeated swim items appear once, in checked luggage", () => {
    for (const label of ["Swimsuits", "UPF swim shirts", "Sun hats"]) assert.equal(BABY_ITEMS.filter((i) => i.label === label).length, 1, label);
    assert.equal(find("Sun hat", "Cabin luggage").length, 1);
  });
  await check("baby list: ranges keep their wording and the low end, never the high end", () => {
    const pouches = find("Baby food/pouches", "Cabin luggage")[0];
    assert.equal(pouches.quantityText, "4–6");
    assert.equal(pouches.quantity, 4);
    assert.equal(find("Enfamil formula", "Checked luggage")[0].quantityText, "Remaining trip supply + 2 extra days");
    assert.equal(quantityLabel({ quantity: 15, quantity_text: null }), "×15");
    assert.equal(quantityLabel({ quantity: 1, quantity_text: null }), null);
  });
  await check("baby list: one Stroller, one outfit set, no invented adult assignment fields", () => {
    assert.equal(BABY_ITEMS.filter((i) => /stroller$/i.test(i.label) && i.label === "Stroller").length, 1);
    assert.equal(find("Complete outfits", "Cabin luggage")[0].quantity, 3);
    assert.ok(BABY_ITEMS.every((i) => !("assignee_id" in i)));
    assert.deepEqual(BABY_ITEMS.filter((i) => i.label === "Spare shirt").map((i) => i.traveler).sort(), ["Nitin", "Pavani"]);
  });
  await check("baby import: an empty list is all new; re-planning after storing adds nothing", () => {
    assert.equal(countPlan(planBabyImport([])).added, BABY_ITEMS.length);
    const again = countPlan(planBabyImport(stored()));
    assert.deepEqual(again, { added: 0, matched: BABY_ITEMS.length, conflicts: 0, ambiguous: 0 });
  });
  await check("baby import: edited quantity is a reviewable conflict, never summed", () => {
    const list = stored();
    const row = list.flatMap((c) => c.items).find((i) => i.source_key === CABIN_DIAPERS_KEY)!;
    row.quantity = 12;
    const entry = planBabyImport(list).find((p) => p.item.key === CABIN_DIAPERS_KEY)!;
    assert.equal(entry.status, "conflict");
  });
  await check("baby import: same name in the same category is adopted; elsewhere is ambiguous, not duplicated", () => {
    const first = BABY_ITEMS[0];
    const adopted = planBabyImport([
      { id: "c", name: first.category.toUpperCase(), items: [{ id: "x", label: ` ${first.label} `, traveler_name: "arjun", quantity: first.quantity, quantity_text: first.quantityText, source_key: null }] },
    ]).find((p) => p.item.key === first.key)!;
    assert.equal(adopted.status, "match");
    const starter = planBabyImport([
      { id: "b", name: "Baby", items: [{ id: "y", label: "Stroller", traveler_name: null, quantity: 1, quantity_text: null, source_key: null }] },
    ]).find((p) => p.item.label === "Stroller")!;
    assert.equal(starter.status, "ambiguous");
  });
  await check("baby import: input accepts only known keys", () => {
    assert.ok(babyImportSchema.safeParse({ quantities: [CABIN_DIAPERS_KEY], addAnyway: [] }).success);
    assert.ok(!babyImportSchema.safeParse({ quantities: ["nope"], addAnyway: [] }).success);
  });

  console.log(`\n${passed} packing checks passed.`);
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
