"use server";

import { revalidatePath } from "next/cache";
import {
  applyPackingStarterForUser,
  copyPackingFromTripForUser,
  createPackingCategoryForUser,
  createPackingItemForUser,
  deletePackingCategoryForUser,
  deletePackingItemForUser,
  movePackingItemForUser,
  reorderPackingCategoriesForUser,
  reorderPackingItemsForUser,
  setPackingItemPackedForUser,
  unpackAllPackingItemsForUser,
  updatePackingCategoryForUser,
  updatePackingItemForUser,
  type PackingCategoryDeleteChoice,
} from "@/lib/dal";
import {
  deletePackingCategorySchema,
  expectedUpdatedAtSchema,
  formFields,
  packingCategorySchema,
  packingCopySchema,
  packingItemSchema,
  packingOrderSchema,
  packingStarterSchema,
  requestIdSchema,
} from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { conflictState, guarded, invalid, notFound } from "./shared";

const ITEM_FIELDS = ["category_id", "label", "quantity", "traveler_name", "notes"] as const;

const refresh = (tripId: string) => revalidatePath(`/trips/${tripId}`, "layout");

const BAD_REQUEST: ActionState = { ok: false, message: "Something went wrong saving that. Nothing was changed — please try again." };
const STALE: ActionState = {
  ok: false,
  message: "Your list changed in another window. We’ve refreshed it — please try that again.",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Create (no categoryId) or rename a packing category. */
export async function savePackingCategory(
  tripId: string,
  categoryId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { categoryId?: string }> {
  const parsed = packingCategorySchema.safeParse(formFields(formData, ["name"]));
  if (!parsed.success) return invalid(parsed.error);

  let id: string | undefined;
  const result = await guarded(categoryId ? "updatePackingCategory" : "createPackingCategory", async () => {
    const outcome = categoryId
      ? await updatePackingCategoryForUser(tripId, categoryId, parsed.data)
      : await createPackingCategoryForUser(tripId, parsed.data);
    if (outcome.ok) {
      id = outcome.id;
      return { ok: true, message: categoryId ? "Category renamed." : "Category added." };
    }
    if (outcome.reason === "duplicate_name") {
      return {
        ok: false,
        message: "Please check the highlighted fields.",
        fieldErrors: { name: [`You already have a “${parsed.data.name}” category.`] },
      };
    }
    return notFound(categoryId ? "Category" : "Trip");
  });

  if (result.ok) refresh(tripId);
  return id ? { ...result, categoryId: id } : result;
}

/**
 * Delete a category. If it has items the caller must choose: move them to
 * another category of this trip, or delete them. Without a choice the
 * category is kept and the item count is returned.
 */
export async function deletePackingCategory(
  tripId: string,
  categoryId: string,
  choice: PackingCategoryDeleteChoice = { items: "none" },
): Promise<ActionState & { items?: number }> {
  const parsed = deletePackingCategorySchema.safeParse(choice);
  if (!parsed.success) return invalid(parsed.error);

  let items: number | undefined;
  const result = await guarded("deletePackingCategory", async () => {
    const outcome = await deletePackingCategoryForUser(tripId, categoryId, parsed.data);
    if (outcome.ok) {
      if (!outcome.affectedItems) return { ok: true, message: "Category removed." };
      return {
        ok: true,
        message:
          parsed.data.items === "move"
            ? `Category removed; ${plural(outcome.affectedItems, "item")} moved.`
            : `Category and ${plural(outcome.affectedItems, "item")} removed.`,
      };
    }
    if (outcome.reason === "has_items") {
      items = outcome.items;
      return { ok: false, message: "This category has items now. Choose whether to move them or delete them too." };
    }
    if (outcome.reason === "target_not_found") {
      return {
        ok: false,
        message: "Please check the highlighted fields.",
        fieldErrors: { target_category_id: ["Choose another category from this trip."] },
      };
    }
    return notFound("Category");
  });

  if (result.ok) refresh(tripId);
  return items ? { ...result, items } : result;
}

/** Create (no itemId) or update a packing item. Packed state is never changed here. */
export async function savePackingItem(
  tripId: string,
  itemId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = packingItemSchema.safeParse(formFields(formData, ITEM_FIELDS));
  if (!parsed.success) return invalid(parsed.error);
  const requestId = requestIdSchema.safeParse(formData.get("request_id") ?? "");

  const result = await guarded(itemId ? "updatePackingItem" : "createPackingItem", async () => {
    const outcome = itemId
      ? await updatePackingItemForUser(
          tripId,
          itemId,
          parsed.data,
          expectedUpdatedAtSchema.parse(formData.get("expected_updated_at") ?? undefined),
        )
      : await createPackingItemForUser(tripId, parsed.data, requestId.success ? requestId.data : undefined);
    if (outcome.ok) return { ok: true, message: itemId ? "Item updated." : `Added “${parsed.data.label}”.` };
    if (outcome.reason === "conflict" && itemId) return conflictState(tripId, "packing", itemId, "item");
    if (outcome.reason === "category_not_in_trip") {
      return {
        ok: false,
        message: "Please check the highlighted fields.",
        fieldErrors: { category_id: ["Choose a category from this trip."] },
      };
    }
    return notFound(itemId ? "Item" : "Trip");
  });

  if (result.ok) refresh(tripId);
  return result;
}

export async function movePackingItem(tripId: string, itemId: string, categoryId: string): Promise<ActionState> {
  const result = await guarded("movePackingItem", async () => {
    const outcome = await movePackingItemForUser(tripId, itemId, categoryId);
    if (outcome.ok) return { ok: true, message: "Item moved." };
    return outcome.reason === "category_not_in_trip" ? notFound("Category") : notFound("Item");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/**
 * Store exactly `packed` — the caller sends the value it wants, never
 * "flip it", so a retried or repeated request can't land on the opposite.
 */
export async function setPackingItemPacked(tripId: string, itemId: string, packed: boolean): Promise<ActionState> {
  if (typeof packed !== "boolean") return BAD_REQUEST;
  const result = await guarded("setPackingItemPacked", async () =>
    (await setPackingItemPackedForUser(tripId, itemId, packed)) ? { ok: true } : notFound("Item"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

/** "Mark everything unpacked" — every item of this trip, none deleted. */
export async function unpackAllPackingItems(tripId: string): Promise<ActionState> {
  const result = await guarded("unpackAllPackingItems", async () => {
    const n = await unpackAllPackingItemsForUser(tripId);
    if (n === null) return notFound("Trip");
    return { ok: true, message: n === 0 ? "Nothing was packed yet." : `${plural(n, "item")} marked unpacked.` };
  });
  if (result.ok) refresh(tripId);
  return result;
}

export async function deletePackingItem(tripId: string, itemId: string): Promise<ActionState> {
  const result = await guarded("deletePackingItem", async () =>
    (await deletePackingItemForUser(tripId, itemId)) ? { ok: true, message: "Item removed." } : notFound("Item"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

export async function reorderPackingCategories(tripId: string, ids: string[]): Promise<ActionState> {
  const parsed = packingOrderSchema.safeParse(ids);
  if (!parsed.success) return BAD_REQUEST;
  const result = await guarded("reorderPackingCategories", async () => {
    const outcome = await reorderPackingCategoriesForUser(tripId, parsed.data);
    if (outcome.ok) return { ok: true };
    return outcome.reason === "stale" ? STALE : notFound("Trip");
  });
  // Refresh on "stale" too, so the screen shows the current list.
  if (result.ok || result === STALE) refresh(tripId);
  return result;
}

export async function reorderPackingItems(tripId: string, categoryId: string, ids: string[]): Promise<ActionState> {
  const parsed = packingOrderSchema.safeParse(ids);
  if (!parsed.success) return BAD_REQUEST;
  const result = await guarded("reorderPackingItems", async () => {
    const outcome = await reorderPackingItemsForUser(tripId, categoryId, parsed.data);
    if (outcome.ok) return { ok: true };
    return outcome.reason === "stale" ? STALE : notFound("Category");
  });
  if (result.ok || result === STALE) refresh(tripId);
  return result;
}

function mergeMessage(added: number, skipped: number, newCategories: number) {
  if (added === 0) return "Everything selected is already on your list — nothing was added.";
  const parts = [`Added ${plural(added, "item")}`];
  if (newCategories) parts.push(`in ${plural(newCategories, "new category", "new categories")}`);
  return `${parts.join(" ")}.${skipped ? ` Skipped ${skipped} already on your list.` : ""}`;
}

/** Copy chosen starter categories into the trip (adds only what's missing). */
export async function applyPackingStarter(tripId: string, keys: string[]): Promise<ActionState> {
  const parsed = packingStarterSchema.safeParse(keys);
  if (!parsed.success) return { ok: false, message: "Choose at least one category." };
  const result = await guarded("applyPackingStarter", async () => {
    const outcome = await applyPackingStarterForUser(tripId, parsed.data);
    if (outcome.ok) return { ok: true, message: mergeMessage(outcome.addedItems, outcome.skippedItems, outcome.newCategories) };
    if (outcome.reason === "nothing_selected") return { ok: false, message: "Choose at least one category." };
    return notFound("Trip");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/**
 * Copy categories from another of the signed-in traveler's trips. The
 * source trip ID comes from the browser and is not trusted: the query
 * re-checks that it (and each category) belongs to the verified owner.
 */
export async function copyPackingFromTrip(
  tripId: string,
  input: { source_trip_id: string; categories: string[] | "all" },
): Promise<ActionState> {
  const parsed = packingCopySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await guarded("copyPackingFromTrip", async () => {
    const outcome = await copyPackingFromTripForUser(tripId, parsed.data.source_trip_id, parsed.data.categories);
    if (outcome.ok) return { ok: true, message: mergeMessage(outcome.addedItems, outcome.skippedItems, outcome.newCategories) };
    if (outcome.reason === "nothing_selected") return { ok: false, message: "Choose at least one category with items." };
    if (outcome.reason === "source_not_found") {
      return { ok: false, message: "That trip’s list isn’t available. Choose one of your other trips." };
    }
    return notFound("Trip");
  });
  if (result.ok) refresh(tripId);
  return result;
}
