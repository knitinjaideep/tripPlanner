"use server";

import { getEveningPreviewSettingsForUser, saveEveningPrefsForUser } from "@/lib/dal";
import { SEND_TIMES } from "@/lib/evening-preview";
import { idSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { z } from "zod";
import { guarded } from "./shared";

/**
 * A person's own evening-preview settings for one trip. Both actions act for
 * the signed-in member only; nobody can read or change anyone else's, and
 * nothing here sends anything (delivery is the scheduled job's business).
 */

const prefsSchema = z
  .object({
    enabled: z.boolean(),
    send_time: z.string().refine((t) => SEND_TIMES.includes(t), "Choose a time between 4:00 PM and 10:00 PM."),
    in_app: z.boolean(),
    email: z.boolean(),
  })
  .refine((p) => p.in_app || p.email, "Keep at least one way to receive it.");

export type EveningSettings = NonNullable<Awaited<ReturnType<typeof getEveningPreviewSettingsForUser>>>;

/** Loads the settings and a sample from the saved plan (nothing is sent). */
export async function loadEveningPreview(tripId: string): Promise<{ ok: true; settings: EveningSettings } | { ok: false; message: string }> {
  if (!idSchema.safeParse(tripId).success) return { ok: false, message: "Trip not found." };
  try {
    const settings = await getEveningPreviewSettingsForUser(tripId);
    return settings ? { ok: true, settings } : { ok: false, message: "Trip not found." };
  } catch {
    return { ok: false, message: "We couldn’t load this just now. Please try again." };
  }
}

export async function saveEveningPreview(tripId: string, input: unknown): Promise<ActionState> {
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check your choices." };
  return guarded("saveEveningPreview", async () =>
    (await saveEveningPrefsForUser(tripId, parsed.data))
      ? { ok: true, message: parsed.data.enabled ? "Evening previews are on for this trip." : "Evening previews are off." }
      : { ok: false, message: "Trip not found." },
  );
}
