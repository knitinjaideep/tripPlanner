"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setPackingItemPacked } from "@/app/actions/packing";
import { createPackedSync } from "@/lib/packed-sync";
import type { PackingCategoryWithItems } from "@/lib/types";

type Shown = { packed: boolean; saving: boolean };

/**
 * Optimistic checkboxes that end up agreeing with the database (see
 * `createPackedSync`). Returns the values to show over the server data.
 */
export function usePackedToggles(tripId: string, categories: PackingCategoryWithItems[]) {
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const latest = useRef(categories);
  useEffect(() => {
    latest.current = categories;
  }, [categories]);

  // Once fresh server data carries a saved value, stop overriding it.
  const [seen, setSeen] = useState(categories);
  if (seen !== categories) {
    setSeen(categories);
    setShown((current) => prune(current, categories));
  }

  // Created on the first click (event time), so it never runs during render.
  const sync = useRef<ReturnType<typeof createPackedSync> | null>(null);
  const getSync = () =>
    (sync.current ??= createPackedSync({
      send: async (itemId, packed) => {
        const result = await setPackingItemPacked(tripId, itemId, packed);
        // The shared signed-out text promises kept form input; here the tick is undone instead.
        return result.signedOut ? { ok: false, message: "Your session has ended — sign in again, then tick it." } : result;
      },
      show: (itemId, state) =>
        setShown((current) => {
          if (state === null) return without(current, itemId);
          const next = { ...current, [itemId]: state };
          return state.saving ? next : prune(next, latest.current);
        }),
      onError: (itemId, message) => {
        const label = latest.current.flatMap((c) => c.items).find((i) => i.id === itemId)?.label ?? "that item";
        toast.error(`Couldn’t save “${label}”, so it’s back to how it was.`, { description: message });
      },
    }));

  return { shown, setPacked: (itemId: string, packed: boolean) => void getSync().set(itemId, packed) };
}

function without(shown: Record<string, Shown>, id: string) {
  const next = { ...shown };
  delete next[id];
  return next;
}

/** Drop settled overrides the server data already agrees with (or whose item is gone). */
function prune(shown: Record<string, Shown>, categories: PackingCategoryWithItems[]) {
  const saved = new Map(categories.flatMap((c) => c.items.map((i) => [i.id, i.is_packed] as const)));
  const next: Record<string, Shown> = {};
  let changed = false;
  for (const [id, s] of Object.entries(shown)) {
    if (!s.saving && (!saved.has(id) || saved.get(id) === s.packed)) changed = true;
    else next[id] = s;
  }
  return changed ? next : shown;
}
