"use server";

import { revalidatePath } from "next/cache";
import {
  cancelPollForUser,
  castVoteForUser,
  chooseResultForUser,
  closePollForUser,
  createPollForUser,
  updatePollForUser,
  type PollWriteReason,
} from "@/lib/dal";
import { idSchema, pollInputSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded } from "./shared";

/**
 * "Ask the group" mutations. They take the trip and poll ids plus the
 * person's own input; who is asking comes from the verified session and what
 * they may do is decided in the data layer (owners / editors create, any
 * current member votes, the asker or the owner closes / cancels / decides).
 */

export type PollActionState = ActionState & { pollId?: string };

const REASONS: Record<PollWriteReason, string> = {
  not_found: "That question isn’t available anymore.",
  bad_parent: "That day, activity or place isn’t part of this trip.",
  option_place_not_in_trip: "One of the saved places isn’t part of this trip.",
  duplicate_options: "Give each option a different name — two or three options.",
  deadline_past: "Choose a closing time in the future.",
  participant_not_member: "You can only ask people who are on this trip.",
  no_participants: "Choose at least one other person to ask. (Asking never adds anyone to the trip.)",
  too_many_open: "There are a lot of open questions already. Close a few first.",
  has_votes: "People have already answered, so the question can’t change. Create a revised poll instead.",
  not_open: "This question is no longer open.",
  closed: "Voting has closed for this question.",
  canceled: "This question was canceled.",
  not_participant: "You weren’t asked this one.",
  bad_option: "That isn’t one of the choices.",
  has_result: "A final answer was already chosen.",
  already_chosen: "A final answer was already chosen.",
  revised_not_found: "The question you’re replacing isn’t available.",
};

const refresh = (tripId: string) => revalidatePath(`/trips/${tripId}`, "layout");

type Outcome = { ok: true; id?: string } | { ok: false; reason: PollWriteReason } | "NO_ACCESS" | { ok: boolean; reason?: PollWriteReason };

function toState(outcome: Outcome, success: string): PollActionState {
  if (outcome === "NO_ACCESS") return { ok: false, message: REASONS.not_found };
  if (outcome.ok) return { ok: true, message: success, pollId: "id" in outcome ? outcome.id : undefined };
  return { ok: false, message: REASONS[(outcome as { reason: PollWriteReason }).reason] ?? "That didn’t work. Nothing was changed." };
}

function parse(input: unknown): { ok: true; data: ReturnType<typeof pollInputSchema.parse> } | { ok: false; state: PollActionState } {
  const parsed = pollInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, state: { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the question and options." } };
}

export async function createPoll(tripId: string, input: unknown): Promise<PollActionState> {
  const parsed = parse(input);
  if (!parsed.ok) return parsed.state;
  const result = await guarded("createPoll", async () => toState((await createPollForUser(tripId, parsed.data)) as Outcome, "Question sent to the group."));
  if (result.ok) refresh(tripId);
  return result;
}

export async function updatePoll(tripId: string, pollId: string, input: unknown): Promise<PollActionState> {
  const parsed = parse(input);
  if (!parsed.ok) return parsed.state;
  const result = await guarded("updatePoll", async () => toState((await updatePollForUser(tripId, pollId, parsed.data)) as Outcome, "Question updated."));
  if (result.ok) refresh(tripId);
  return result;
}

/** `optionId` = a choice, or "any" for "Any works for me" (an abstention). */
export async function votePoll(tripId: string, pollId: string, optionId: string): Promise<ActionState> {
  if (optionId !== "any" && !idSchema.safeParse(optionId).success) return { ok: false, message: REASONS.bad_option };
  const result = await guarded("votePoll", async () =>
    toState((await castVoteForUser(tripId, pollId, optionId === "any" ? { any: true } : { option_id: optionId })) as Outcome, "Your answer is saved."),
  );
  if (result.ok) refresh(tripId);
  return result;
}

export async function closePoll(tripId: string, pollId: string): Promise<ActionState> {
  const result = await guarded("closePoll", async () => toState((await closePollForUser(tripId, pollId)) as Outcome, "Question closed."));
  if (result.ok) refresh(tripId);
  return result;
}

export async function cancelPoll(tripId: string, pollId: string): Promise<ActionState> {
  const result = await guarded("cancelPoll", async () => toState((await cancelPollForUser(tripId, pollId)) as Outcome, "Question canceled."));
  if (result.ok) refresh(tripId);
  return result;
}

/** The organizer's explicit decision. Nothing is added to the itinerary. */
export async function choosePollResult(tripId: string, pollId: string, optionId: string): Promise<ActionState> {
  if (!idSchema.safeParse(optionId).success) return { ok: false, message: REASONS.bad_option };
  const result = await guarded("choosePollResult", async () =>
    toState((await chooseResultForUser(tripId, pollId, optionId)) as Outcome, "Final answer chosen. The group has been told."),
  );
  if (result.ok) refresh(tripId);
  return result;
}
