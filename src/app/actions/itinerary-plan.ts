"use server";

import { revalidatePath } from "next/cache";
import {
  applyItineraryPlanForUser,
  previewItineraryPlanForUser,
  type PlanApplySummary,
  type PlanPreviewResult,
} from "@/lib/dal";
import { idSchema, planApplySchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, notFound } from "./shared";

export type { PlanApplySummary, PlanPreviewResult };

export type PlanOtherTrip = { id: string; title: string; start_date: string; end_date: string };

export type PlanPreviewState = ActionState & { preview?: PlanPreviewResult; otherTrips?: PlanOtherTrip[] };
export type PlanApplyState = ActionState & { summary?: PlanApplySummary; preview?: PlanPreviewResult };

/** Read-only preview of a saved plan against this trip. Writes nothing. */
export async function previewItineraryPlan(tripId: string, planId: string): Promise<PlanPreviewState> {
  if (!idSchema.safeParse(tripId).success) return notFound("Trip");
  let data = null as Awaited<ReturnType<typeof previewItineraryPlanForUser>>;
  const result = await guarded("previewItineraryPlan", async () => {
    data = await previewItineraryPlanForUser(tripId, planId);
    return data ? { ok: true } : notFound("Trip");
  });
  return result.ok && data ? { ...result, preview: data.preview, otherTrips: data.otherTrips } : result;
}

function summaryMessage(s: PlanApplySummary) {
  const parts = [
    s.added && `${s.added} added`,
    s.updated && `${s.updated} updated`,
    s.removed && `${s.removed} removed`,
    s.kept && `${s.kept} kept as you had them`,
  ].filter(Boolean);
  if (parts.length === 0 && !s.tripTimeZone) return "Already up to date — nothing changed.";
  return `Itinerary updated: ${parts.join(", ") || "no entry changes"}${s.tripTimeZone ? `; trip zone set to ${s.tripTimeZone}` : ""}.`;
}

/** Apply exactly what was previewed (token-checked, one transaction). */
export async function applyItineraryPlan(tripId: string, input: unknown): Promise<PlanApplyState> {
  if (!idSchema.safeParse(tripId).success) return notFound("Trip");
  const parsed = planApplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Couldn’t read that update. Please review it again." };
  const { plan_id, token, choices, set_trip_time_zone } = parsed.data;

  let extra: Pick<PlanApplyState, "summary" | "preview"> = {};
  const result = await guarded("applyItineraryPlan", async () => {
    const outcome = await applyItineraryPlanForUser(tripId, plan_id, { token, choices, setTripTimeZone: set_trip_time_zone });
    if (outcome.ok) {
      extra = { summary: outcome.summary };
      return { ok: true, message: summaryMessage(outcome.summary) };
    }
    if (outcome.reason === "stale") {
      extra = { preview: outcome.preview };
      return { ok: false, message: "The itinerary changed since this preview. Here’s the updated preview — nothing was saved yet." };
    }
    if (outcome.reason === "blocked") return { ok: false, message: "This plan can’t be applied to this trip yet — see the notes above." };
    return notFound("Trip");
  });
  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return { ...result, ...extra };
}
