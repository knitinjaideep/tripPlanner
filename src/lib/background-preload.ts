"use client";

import { backgroundUrl, type BackgroundId } from "@/lib/backgrounds";

/**
 * Browser-side picture loading for the background layer. One request per
 * picture (the promise is shared), a failed picture is forgotten so a retry
 * really asks again, and nothing is fetched until a person's interaction (or
 * the active appearance) asks for it.
 */
const loads = new Map<BackgroundId, Promise<boolean>>();

export function preloadBackground(id: BackgroundId): Promise<boolean> {
  const url = backgroundUrl(id);
  if (!url) return Promise.resolve(true);
  const existing = loads.get(id);
  if (existing) return existing;
  const promise = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(true);
    img.onerror = () => {
      loads.delete(id);
      resolve(false);
    };
    img.src = url;
  });
  loads.set(id, promise);
  return promise;
}
