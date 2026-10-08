/**
 * "Ask the group" — the pure, client-safe half: limits, the shapes the
 * browser receives, vote totals, permissions and deadline helpers. Reads and
 * writes (and every authorization check) live in src/db/polls.ts, reached
 * only through src/lib/dal.ts.
 */
import { formatShortDay, formatTime } from "@/lib/dates";
import { can, type TripRole } from "@/lib/sharing";
import { zonedInstant, zoneAbbreviation } from "@/lib/time-zones";

export const POLL_LIMITS = {
  questionMin: 3,
  question: 140,
  description: 500,
  option: 80,
  minOptions: 2,
  maxOptions: 3,
  /** Open polls per trip — a guard against a runaway client, not a product limit. */
  maxOpen: 25,
} as const;

export type PollParentType = "trip" | "day" | "activity" | "place";
export type PollStatus = "open" | "closed" | "canceled";

export type PollOptionView = {
  id: string;
  position: number;
  label: string;
  /** The linked Explore place (null for a text option, or when the place was later removed). */
  place: { id: string; name: string; kind: string; category: string } | null;
};

export type PollVoter = { user_id: string; name: string; option_id: string | null };

export type PollTally = {
  /** Per option id: votes from current members. */
  counts: Record<string, number>;
  /** "Any works for me" — an abstention, never a vote for every option. */
  any: number;
  /** Current members who responded (substantive or "any"). */
  voted: number;
  /** Current members who were asked. */
  eligible: number;
  /** Option ids sharing the highest count (more than one = a tie). Empty when nobody voted for an option. */
  leaders: string[];
};

export type PollView = {
  id: string;
  question: string;
  description: string | null;
  created_by: string;
  creator_name: string;
  created_at: string;
  parent: {
    type: PollParentType;
    day: string | null;
    item: { id: string; title: string; date: string | null } | null;
    place: { id: string; name: string } | null;
    /** The linked activity / place was removed after the poll was made. */
    missing: boolean;
  };
  status: PollStatus;
  closes_at: string | null;
  /** Open on paper but past its deadline: votes are already refused. */
  expired: boolean;
  any_option: boolean;
  options: PollOptionView[];
  /** Who was asked and is still on the trip. */
  participants: { user_id: string; name: string; voted: boolean }[];
  /** Who answered what — visible to the whole group. Current members only. */
  votes: PollVoter[];
  tally: PollTally;
  hasVotes: boolean;
  me: { asked: boolean; response: { option_id: string | null } | null };
  result: {
    option_id: string;
    selected_by: string;
    selected_at: string;
    /** The totals as they were when it was chosen. */
    tally: PollTally;
    /** An itinerary visit that already uses the chosen Explore place (planned or done) — link to it, never duplicate. */
    existing: { id: string; date: string | null; status: string } | null;
  } | null;
  replaces: string | null;
  replacedBy: string | null;
  can: { vote: boolean; edit: boolean; close: boolean; cancel: boolean; choose: boolean; apply: boolean; revise: boolean };
};

/** Effective state: a poll past its deadline is closed to votes even if nothing has updated it yet. */
export const isVotingOpen = (p: { status: PollStatus; expired: boolean }) => p.status === "open" && !p.expired;

/* ------------------------------ totals ------------------------------ */

/**
 * Totals over CURRENT members only (the caller passes just their votes). A
 * tie stays a tie; the leader of a count is information, never a decision.
 */
export function tallyVotes(
  optionIds: string[],
  votes: { option_id: string | null }[],
  eligible: number,
): PollTally {
  const counts: Record<string, number> = Object.fromEntries(optionIds.map((id) => [id, 0]));
  let any = 0;
  for (const v of votes) {
    if (v.option_id === null) any++;
    else if (v.option_id in counts) counts[v.option_id]++;
  }
  const top = Math.max(0, ...Object.values(counts));
  return {
    counts,
    any,
    voted: votes.length,
    eligible,
    leaders: top > 0 ? optionIds.filter((id) => counts[id] === top) : [],
  };
}

/** "Leading", "Tied", or nothing when no option has a vote. Never "decided". */
export function standing(tally: PollTally): "none" | "leading" | "tied" {
  if (tally.leaders.length === 0) return "none";
  return tally.leaders.length === 1 ? "leading" : "tied";
}

/* ---------------------------- permissions ---------------------------- */

/**
 * Who may do what with a poll, from the caller's trip role and the poll's
 * state. The server decides with the same function; the UI only mirrors it.
 * - create: owners and editors.
 * - vote: any current member who was asked (viewers included) — a narrow
 *   participation permission that changes nothing else on the trip.
 * - close / cancel / choose / revise: the poll's creator or the trip owner.
 * - apply a result to the itinerary: owners and editors (they can edit it).
 */
export function pollPermissions(input: {
  role: TripRole | null;
  userId: string;
  createdBy: string;
  status: PollStatus;
  expired: boolean;
  asked: boolean;
  hasVotes: boolean;
  hasResult: boolean;
}): PollView["can"] {
  const member = can(input.role, "participate");
  const organizer = member && (input.role === "owner" || input.createdBy === input.userId);
  const live = input.status === "open";
  return {
    vote: member && input.asked && isVotingOpen(input),
    edit: organizer && live && !input.hasVotes && !input.hasResult,
    close: organizer && live,
    cancel: organizer && input.status !== "canceled" && !input.hasResult,
    choose: organizer && input.status !== "canceled" && !input.hasResult,
    apply: can(input.role, "contribute") && input.hasResult,
    revise: organizer && input.status !== "canceled" && !input.hasResult,
  };
}

/* ------------------------------ deadlines ------------------------------ */

/** The local wall-clock deadline the creator typed (in the trip's zone) as a real instant (ISO, UTC). null if not a real moment. */
export function deadlineInstant(date: string, time: string, tripZone: string): string | null {
  const ms = zonedInstant(date, time, tripZone);
  return ms === null || Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** "Fri, Oct 16 at 5:00 PM AST" — the deadline in the trip's zone. */
export function formatDeadline(iso: string, tripZone: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tripZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  const zone = zoneAbbreviation(date, time, tripZone);
  return `${formatShortDay(date)} at ${formatTime(time)}${zone ? ` ${zone}` : ""}`;
}

/* ------------------------------- summaries ------------------------------- */

export function parentLabel(parent: PollView["parent"]): string | null {
  if (parent.type === "day" && parent.day) return `For ${formatShortDay(parent.day)}`;
  if (parent.type === "activity") return parent.item ? `About ${parent.item.title}` : "About an activity that was removed";
  if (parent.type === "place") return parent.place ? `About ${parent.place.name}` : "About a place that was removed";
  return null;
}

export const optionLabel = (poll: Pick<PollView, "options">, optionId: string | null) =>
  optionId ? (poll.options.find((o) => o.id === optionId)?.label ?? "an option") : "Any works for me";

/** The one-line decision shown for a finalized poll with a text choice (nothing is invented from it). */
export function decisionSummary(poll: Pick<PollView, "question" | "options" | "result">): string | null {
  if (!poll.result) return null;
  return `The group chose “${optionLabel(poll, poll.result.option_id)}” for “${poll.question}”.`;
}
