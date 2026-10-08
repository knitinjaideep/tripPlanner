import "server-only";
import { access } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { BACKGROUND_IDS, backgroundFiles, type BackgroundId } from "@/lib/settings";

/**
 * Backgrounds whose picture files really exist under /public/backgrounds.
 * Plain Ivory is CSS-only and always available. A missing file makes that
 * background "unavailable" in Settings (never a broken image) and the app
 * shell falls back to Plain Ivory.
 */
export const availableBackgrounds = cache(async (): Promise<BackgroundId[]> => {
  const dir = path.join(process.cwd(), "public", "backgrounds");
  const checks = await Promise.all(
    BACKGROUND_IDS.map(async (id) => {
      try {
        await Promise.all(backgroundFiles(id).map((file) => access(path.join(dir, file))));
        return id;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((id): id is BackgroundId => id !== null);
});
