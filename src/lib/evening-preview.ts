/**
 * Evening preview of tomorrow — the pure half: when a preview is due (in the
 * TRIP's local calendar), which poll to mention, and the deterministic text.
 * No database, no clock of its own (callers pass `now`), no LLM, nothing
 * invented: only what is saved on the trip.
 */
import { formatShortDay, formatTime, todayInTimeZone } from "@/lib/dates";
import { cleanText, inTripZone } from "@/lib/notifications";
import type { PollView } from "@/lib/polls";
import { addDays, agendaTitle, type AgendaEntry } from "@/lib/schedule";
import { formatDeadlineZone } from "@/lib/evening-format";
import { zonedInstant } from "@/lib/time-zones";

/** Suggested time, wall-clock in the trip's zone. */
export const DEFAULT_SEND_TIME = "19:00";
/** Choosable times: every half hour from 4:00 PM to 10:00 PM (never a night-time ping, never a time that DST can skip). */
export const SEND_TIMES = Array.from({ length: 13 }, (_, i) => {
  const minutes = 16 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
/** A preview is still useful this long after its time; later than that it is skipped, never sent late. */
export const STALE_AFTER_MINUTES = 180;
/** Delivery attempts per email (a retry is another claim of the same ledger row). */
export const MAX_EMAIL_ATTEMPTS = 3;
/** How long a worker holds a claim before another may retry it. */
export const CLAIM_LEASE_MINUTES = 5;
/** A job is "active" if it ran within this long. */
export const HEARTBEAT_FRESH_MINUTES = 120;

export const isSendTime = (value: string) => SEND_TIMES.includes(value.slice(0, 5));

/* ------------------------------ schedule ------------------------------ */

export type ScheduleState = "not_due" | "due" | "stale" | "outside";

export type ScheduleDecision = {
  /** Today on the trip's calendar. */
  localToday: string;
  /** Tomorrow on the trip's calendar — pure date arithmetic, so DST never shifts it. */
  targetDate: string;
  /** The moment the preview was meant to go out. */
  scheduledFor: string | null;
  state: ScheduleState;
};

function localMinutes(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * Is a preview due right now? Looks only at "tomorrow" on the trip's own
 * calendar, so an outage never produces a backlog of old days: once the
 * window for tonight has passed it is `stale`, and the next target is a
 * different date altogether.
 *
 * - outside: tomorrow is before the first day or after the last (so the
 *   evening BEFORE day one is allowed, and nothing is sent after the trip).
 * - not_due: before the preferred time.
 * - due: from the preferred time until STALE_AFTER_MINUTES later.
 * - stale: later than that.
 */
export function evaluateSchedule(input: {
  now: Date;
  timeZone: string;
  sendTime: string;
  tripStart: string;
  tripEnd: string;
}): ScheduleDecision {
  const { now, timeZone, tripStart, tripEnd } = input;
  const localToday = todayInTimeZone(timeZone, now);
  const targetDate = addDays(localToday, 1);
  const time = input.sendTime.slice(0, 5);
  const scheduled = zonedInstant(localToday, time, timeZone);
  const scheduledFor = scheduled === null ? null : new Date(scheduled).toISOString();
  if (targetDate < tripStart || targetDate > tripEnd) return { localToday, targetDate, scheduledFor, state: "outside" };
  const [h, m] = time.split(":").map(Number);
  const late = localMinutes(now, timeZone) - (h * 60 + m);
  const state: ScheduleState = late < 0 ? "not_due" : late > STALE_AFTER_MINUTES ? "stale" : "due";
  return { localToday, targetDate, scheduledFor, state };
}

/**
 * Which date a preview of "the next evening" would describe, for the
 * on-screen sample: tomorrow when that is a trip day, otherwise the first day
 * if the trip hasn't started, otherwise none.
 */
export function sampleTarget(now: Date, timeZone: string, tripStart: string, tripEnd: string): { date: string; isTomorrow: boolean } | null {
  const tomorrow = addDays(todayInTimeZone(timeZone, now), 1);
  if (tomorrow >= tripStart && tomorrow <= tripEnd) return { date: tomorrow, isTomorrow: true };
  if (tomorrow < tripStart) return { date: tripStart, isTomorrow: false };
  return null;
}

/* ------------------------------- the poll ------------------------------- */

export type PollPick = { poll: PollView; reason: "tomorrow" | "closing_soon" };

const SOON_HOURS = 36;

/**
 * The single unresolved decision to mention, in this order:
 * 1. an open poll the recipient hasn't answered that is attached to tomorrow
 *    (its day, or one of tomorrow's activities);
 * 2. otherwise an unanswered open poll that closes within about a day and a
 *    half, BEFORE the activity or day it is about (`relevantStart`);
 * 3. otherwise none.
 * Answered, expired, closed, canceled and decided polls never appear, and the
 * vote totals are never consulted — nothing is presented as the likely answer.
 */
export function selectPoll(
  polls: PollView[],
  input: { targetDate: string; nowMs: number; relevantStart: (poll: PollView) => number | null },
): PollPick | null {
  const waiting = polls.filter((p) => p.status === "open" && !p.expired && !p.result && p.can.vote && p.me.response === null);
  const byDeadline = (a: PollView, b: PollView) =>
    (a.closes_at ? Date.parse(a.closes_at) : Infinity) - (b.closes_at ? Date.parse(b.closes_at) : Infinity) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id);

  const tomorrow = waiting
    .filter((p) => p.parent.day === input.targetDate || p.parent.item?.date === input.targetDate)
    .sort(byDeadline)[0];
  if (tomorrow) return { poll: tomorrow, reason: "tomorrow" };

  const soon = waiting
    .filter((p) => {
      if (!p.closes_at) return false;
      const closes = Date.parse(p.closes_at);
      const start = input.relevantStart(p);
      return closes > input.nowMs && closes - input.nowMs <= SOON_HOURS * 3_600_000 && start !== null && closes < start;
    })
    .sort(byDeadline)[0];
  return soon ? { poll: soon, reason: "closing_soon" } : null;
}

/* ------------------------------- content ------------------------------- */

export type PreviewContent = {
  title: string;
  /** The in-app text (≤ 400 characters). */
  body: string;
  /** Plain-text lines for email. */
  lines: string[];
  targetDate: string;
  highlights: string[];
  firstStart: string | null;
  empty: boolean;
  poll: { id: string; question: string; reason: PollPick["reason"] } | null;
  /** Where "View tomorrow" / "Vote & view tomorrow" leads (an in-app path). */
  href: string;
  /** "7:02 PM AST" — when this snapshot was taken, in the trip's zone. */
  generatedAt: string;
};

const joinList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function labelOf(entry: AgendaEntry) {
  const title = cleanText(agendaTitle(entry), 50) || "An activity";
  const kind = entry.reservation?.kind;
  if (kind === "lodging") return entry.role === "end" ? `Check-out: ${title}` : `Check-in: ${title}`;
  if (kind === "flight" || kind === "train" || kind === "car") return entry.role === "end" ? `Arrive: ${title}` : `Depart: ${title}`;
  return title;
}

/**
 * Tomorrow's saved plan as plain sentences. Up to three highlights in the
 * order the day runs (timed entries first, then flexible ones — meals and
 * protected rest blocks count like anything else); skipped and cancelled
 * entries are left out. Only titles and times: never addresses, booking
 * references, links or notes.
 */
export function composePreview(input: {
  tripId: string;
  tripTitle: string;
  destination: string;
  timeZone: string;
  targetDate: string;
  entries: AgendaEntry[];
  poll: PollPick | null;
  now: Date;
}): PreviewContent {
  const { targetDate, timeZone } = input;
  const live = input.entries.filter((e) => !e.cancelled && e.item?.status !== "skipped");
  const seen = new Set<string>();
  const unique = live.filter((e) => {
    const key = `${labelOf(e)}|${e.time ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const clock = (e: AgendaEntry) => (e.time ? formatTime(inTripZone(e.date, e.time, e.timeZone ?? timeZone, timeZone).time ?? e.time) : null);
  const shown = unique.slice(0, 3);
  const highlights = shown.map((e) => {
    const at = clock(e);
    return at ? `${labelOf(e)} (${at})` : labelOf(e);
  });
  const firstTimed = unique.find((e) => e.time);
  const firstStart = firstTimed ? clock(firstTimed) : null;
  const empty = unique.length === 0;
  const place = cleanText(input.destination, 40) || cleanText(input.tripTitle, 40);

  const generatedAt = formatGenerated(input.now, timeZone);
  const day = formatShortDay(targetDate);
  const decision = input.poll ? `One thing to decide: “${cleanText(input.poll.poll.question, 100)}”` : null;
  const plan = empty
    ? "Tomorrow is open. Keep it flexible or choose something from Explore."
    : `${day}: ${joinList(highlights)}${unique.length > shown.length ? ` and ${unique.length - shown.length} more` : ""}.${firstStart ? ` First start ${firstStart}.` : ""}`;
  const body = cleanText([plan, decision ? `${decision}.` : null, `As of ${generatedAt}.`].filter(Boolean).join(" "), 400);

  // A poll about tomorrow is shown beside tomorrow's plan; one about something else goes to the polls page.
  const href =
    input.poll && input.poll.reason === "closing_soon"
      ? `/trips/${input.tripId}/polls?poll=${input.poll.poll.id}`
      : `/trips/${input.tripId}/itinerary?day=${targetDate}`;
  return {
    title: cleanText(`Tomorrow in ${place}`, 120),
    body,
    lines: [
      `Tomorrow in ${place} — ${day}`,
      "",
      plan,
      ...(decision ? ["", decision] : []),
      "",
      `Planned as of ${generatedAt}. The link opens the current plan, which may have changed.`,
    ],
    targetDate,
    highlights,
    firstStart,
    empty,
    poll: input.poll ? { id: input.poll.poll.id, question: cleanText(input.poll.poll.question, 100), reason: input.poll.reason } : null,
    href,
    generatedAt,
  };
}

/** "7:02 PM AST". */
export function formatGenerated(now: Date, timeZone: string) {
  return formatDeadlineZone(now, timeZone);
}

export const actionLabel = (content: Pick<PreviewContent, "poll">) => (content.poll ? "Vote & view tomorrow" : "View tomorrow");
