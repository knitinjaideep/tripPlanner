"use server";

import { revalidatePath } from "next/cache";
import { getAppearanceForUser, saveAppearanceForUser, saveDisplayNameForUser, saveSettingsSectionForUser } from "@/lib/dal";
import type { Appearance, SettingsSection, SettingsSnapshot } from "@/lib/settings";
import {
  appearanceSettingsSchema,
  displayNameSchema,
  displaySettingsSchema,
  notificationSettingsSchema,
  travelSettingsSchema,
} from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, invalid } from "./shared";
import { z } from "zod";

/**
 * Personal Settings. Each action saves ONE section for the signed-in user —
 * who that is comes only from the verified session, never from the request —
 * validates it strictly, merges only the fields sent, and returns what the
 * server actually stored so the form can show "Saved" from the confirmed
 * values (never before).
 */

export type SettingsActionState = ActionState & { settings?: SettingsSnapshot };

const SCHEMAS = {
  notifications: notificationSettingsSchema,
  travel: travelSettingsSchema,
  display: displaySettingsSchema,
} as const satisfies Record<SettingsSection, z.ZodType>;

async function saveSection(section: SettingsSection, input: unknown, message: string): Promise<SettingsActionState> {
  const parsed = SCHEMAS[section].safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return guarded(`saveSettings:${section}`, async () => {
    const settings = await saveSettingsSectionForUser(section, parsed.data as Record<string, unknown>);
    // The header, the app shell and formatted times read these on the server.
    revalidatePath("/", "layout");
    return { ok: true, message, settings } satisfies SettingsActionState;
  }) as Promise<SettingsActionState>;
}

export type AppearanceActionState = ActionState & {
  /** What the server stored (on success) or currently holds (on a conflict). */
  appearance?: Appearance;
  version?: number;
};

/**
 * Save the appearance fields that changed, based on the version this browser last
 * saw. Another device having saved since is a `conflict`: nothing is overwritten
 * and the stored appearance is returned so the person can review. The user is
 * the verified session user; there is no user id in the request. No revalidation:
 * the shell already holds the saved appearance in client state.
 */
export async function saveAppearance(input: unknown, baseVersion: unknown): Promise<AppearanceActionState> {
  const parsed = appearanceSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const version = z.number().int().min(0).max(2_000_000_000).safeParse(baseVersion);
  if (!version.success) return { ok: false, message: "That save was out of date. Reload the page and try again." };
  return guarded("saveSettings:appearance", async () => {
    const result = await saveAppearanceForUser(parsed.data as Record<string, unknown>, version.data);
    if (result.ok) return { ok: true, message: "Appearance saved.", appearance: result.appearance, version: result.version } satisfies AppearanceActionState;
    return {
      ok: false,
      conflict: { latestUpdatedAt: null },
      message: "Your appearance was changed on another device. Your preview is still here — review it before saving.",
      appearance: result.appearance,
      version: result.version,
    } satisfies AppearanceActionState;
  }) as Promise<AppearanceActionState>;
}

/** The signed-in person's saved appearance (focus refresh). Read-only. */
export async function refreshAppearance(): Promise<{ ok: boolean; appearance?: Appearance; version?: number }> {
  try {
    return { ok: true, ...(await getAppearanceForUser()) };
  } catch {
    return { ok: false };
  }
}
export async function saveNotificationSettings(input: unknown): Promise<SettingsActionState> {
  return saveSection("notifications", input, "Notification settings saved.");
}
export async function saveTravelPreferences(input: unknown): Promise<SettingsActionState> {
  return saveSection("travel", input, "Travel preferences saved.");
}
export async function saveDisplayPreferences(input: unknown): Promise<SettingsActionState> {
  return saveSection("display", input, "Display preferences saved.");
}

/** Atlas-only display name; blank goes back to the Google account's name. */
export async function saveDisplayName(input: unknown): Promise<ActionState & { displayName?: string | null }> {
  const parsed = displayNameSchema.safeParse(typeof input === "string" ? input : "");
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the name.", fieldErrors: { display_name: [parsed.error.issues[0]?.message ?? "Check the name."] } };
  return guarded("saveDisplayName", async () => {
    const displayName = await saveDisplayNameForUser(parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, message: displayName ? "Display name saved." : "Using your Google name again.", displayName } as ActionState & { displayName?: string | null };
  });
}
