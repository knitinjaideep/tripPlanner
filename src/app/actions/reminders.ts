"use server";

import { revalidatePath } from "next/cache";
import {
  allowQuietReminderForUser,
  getReminderOverviewForUser,
  getReminderPanelForUser,
  getReminderPrefsForUser,
  muteReminderForUser,
  previewRemindersForUser,
  saveReminderPrefsForUser,
  setRemindersForUser,
  snoozeReminderForUser,
  type OverviewRow,
  type ReminderPanel,
} from "@/lib/dal";
import { idSchema, reminderPrefsSchema, reminderRuleSchema, reminderTargetSchema, snoozeSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

/**
 * Reminder mutations. Every one is an authenticated Server Action that the DAL
 * re-authorizes (session, role on THIS trip, and — for the recipient actions —
 * that the reminder is the caller's own). Nothing here is reachable through a
 * GET link, and nothing takes a recipient, owner or URL as a trusted value.
 */

type Data<T> = ActionState & { data?: T };

/** Runs a read/write that returns data, in the same calm error handling as every other action. */
async function withData<T>(context: string, run: () => Promise<{ data: T } | ActionState>): Promise<Data<T>> {
  let data: T | undefined;
  const state = await guarded(context, async () => {
    const out = await run();
    if ("data" in out) {
      data = out.data;
      return { ok: true };
    }
    return out;
  });
  return data === undefined ? state : { ...state, data };
}

const refresh = (tripId: string) => revalidatePath(`/trips/${tripId}`, "layout");
const BAD: ActionState = { ok: false, message: "Something went wrong. Nothing was changed — please try again." };

/** The reminder control's data for one booking or task. */
export async function loadReminderPanel(tripId: string, subject: "booking" | "task", id: string): Promise<Data<ReminderPanel>> {
  const target = reminderTargetSchema.safeParse({ subject, id });
  if (!target.success) return BAD;
  return withData<ReminderPanel>("loadReminderPanel", async () => {
    const panel = await getReminderPanelForUser(tripId, target.data.subject, target.data.id);
    return panel ? { data: panel } : notFound("This item");
  });
}

/** The "Set up reminders" review list for a trip. */
export async function loadReminderOverview(tripId: string): Promise<Data<OverviewRow[]>> {
  return withData<OverviewRow[]>("loadReminderOverview", async () => {
    const rows = await getReminderOverviewForUser(tripId);
    return rows ? { data: rows } : notFound("Trip");
  });
}

const ruleFrom = (v: ReturnType<typeof reminderRuleSchema.parse>) => ({
  customAmount: v.custom_amount,
  customUnit: v.custom_unit,
  customDays: v.custom_days,
  localTime: v.local_time ?? null,
});

export type PreviewRow = { recipientId: string; name: string; text: string | null; note: string | null; problem: string | null };
export type PreviewData = { zoneName: string; zoneNote: string | null; rows: PreviewRow[]; problem: string | null };

/** What setting this up would do, per person, in the right zone. Writes nothing. Owners and editors. */
export async function previewReminder(tripId: string, subject: "booking" | "task", id: string, input: unknown): Promise<Data<PreviewData>> {
  const target = reminderTargetSchema.safeParse({ subject, id });
  const rule = reminderRuleSchema.safeParse(input);
  if (!target.success || !rule.success) return BAD;
  return withData<PreviewData>("previewReminder", async () => {
    const out = await previewRemindersForUser(tripId, target.data.subject, target.data.id, { preset: rule.data.preset, rule: ruleFrom(rule.data), recipientIds: rule.data.recipient_ids });
    if (!out) return notFound("This item");
    if (!out.ok) return { data: { zoneName: "", zoneNote: null, rows: [], problem: out.detail ?? "That can’t have a reminder." } };
    return { data: { zoneName: out.zoneName, zoneNote: out.zoneSource === "trip" ? "No time zone is saved on this booking, so the trip’s zone is used." : null, rows: out.rows, problem: null } };
  });
}

const SETUP_MESSAGE: Record<string, string> = {
  ineligible: "This can’t have a reminder right now.",
  no_recipients: "Choose who should get the reminder.",
  not_member: "Reminders can only go to people who are on this trip.",
  unassigned: "Assign this task to someone first — reminders go only to the assignee.",
  past: "That reminder time has already passed. Pick a later one.",
  started: "This booking has already started.",
  invalid: "Please check the reminder time.",
};

/** Set up, change or turn off a booking's or task's reminder. Owners and editors. */
export async function saveReminder(tripId: string, subject: "booking" | "task", id: string, input: unknown): Promise<Data<{ summary: { recipientId: string; status: string; reason: string | null; fireAt: string | null; note: string | null }[] }>> {
  const target = reminderTargetSchema.safeParse({ subject, id });
  const rule = reminderRuleSchema.safeParse(input);
  if (!target.success) return BAD;
  if (!rule.success) return invalid(rule.error);
  const result = await withData("saveReminder", async () => {
    const out = await setRemindersForUser(tripId, target.data.subject, target.data.id, { preset: rule.data.preset, rule: ruleFrom(rule.data), recipientIds: rule.data.recipient_ids });
    if (out.ok) return { data: { summary: out.summary } };
    if (out.reason === "not_found") return notFound("This item");
    return { ok: false, message: out.detail && out.reason === "invalid" ? out.detail : (SETUP_MESSAGE[out.reason] ?? BAD.message!) };
  });
  if (result.ok) refresh(tripId);
  return result;
}

const OWN_MESSAGE: Record<string, string> = {
  not_found: "That reminder isn’t available.",
  unavailable: "That reminder isn’t active any more.",
  too_late: "That’s after the booking starts, so a reminder then would be too late. Pick an earlier time.",
  invalid: "Pick a time that’s a few minutes from now.",
};

/** Snooze the caller's OWN reminder to an explicit time (replaces the pending one; never duplicates). */
export async function snoozeReminder(tripId: string, reminderId: string, atMs: number): Promise<Data<{ fireAt: string }>> {
  const id = idSchema.safeParse(reminderId);
  const at = snoozeSchema.safeParse({ atMs });
  if (!id.success || !at.success) return BAD;
  const result = await withData("snoozeReminder", async () => {
    const out = await snoozeReminderForUser(tripId, id.data, at.data.atMs);
    if (out.ok) return { data: { fireAt: out.fireAt! } };
    return { ok: false, message: out.detail ?? OWN_MESSAGE[out.reason] ?? BAD.message! };
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** Turn off just the caller's own reminder for this booking or task. */
export async function muteReminder(tripId: string, reminderId: string): Promise<ActionState> {
  const id = idSchema.safeParse(reminderId);
  if (!id.success) return BAD;
  const result = await guarded("muteReminder", async () => {
    const out = await muteReminderForUser(tripId, id.data);
    return out.ok ? { ok: true, message: "Reminder turned off." } : { ok: false, message: OWN_MESSAGE[out.reason] ?? BAD.message! };
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** The caller chooses to receive a reminder that quiet hours had stopped. */
export async function allowQuietReminder(tripId: string, reminderId: string): Promise<ActionState> {
  const id = idSchema.safeParse(reminderId);
  if (!id.success) return BAD;
  const result = await guarded("allowQuietReminder", async () => {
    const out = await allowQuietReminderForUser(tripId, id.data);
    return out.ok ? { ok: true, message: "Okay — it will be sent at the original time." } : { ok: false, message: OWN_MESSAGE[out.reason] ?? "That time has passed, so it can’t be sent." };
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** The caller's own delivery settings, across all trips. */
export async function loadReminderPrefs() {
  return withData("loadReminderPrefs", async () => ({ data: await getReminderPrefsForUser() }));
}

export async function saveReminderPrefs(input: unknown): Promise<ActionState> {
  const parsed = reminderPrefsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return guarded("saveReminderPrefs", async () => {
    const out = await saveReminderPrefsForUser(parsed.data);
    return out.ok ? { ok: true, message: "Reminder settings saved." } : { ok: false, message: out.error };
  });
}
