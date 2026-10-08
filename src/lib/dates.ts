import { differenceInCalendarDays, format, isSameMonth, isSameYear, parseISO } from "date-fns";
import { formatClockTime } from "@/lib/display-format";
import type { Clock } from "@/lib/settings";

/**
 * Trips and bookings store calendar dates ("2026-10-14") and local
 * wall-clock times ("08:20:00"). They are formatted as-is, never shifted
 * through UTC, so a reservation always shows the time printed on it.
 *
 * "Today" depends on where the viewer is, so it is computed from the
 * viewer's IANA time zone (see lib/timezone.ts).
 */

/** Parse a YYYY-MM-DD date as a local calendar date (no UTC shift). */
export function parseDate(value: string) {
  return parseISO(value);
}

export function todayInTimeZone(timeZone: string, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return iso;
}

export function hourInTimeZone(timeZone: string, now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
}

export type TripPhase = "current" | "upcoming" | "past";

export function tripPhase(start: string, end: string, today: string): TripPhase {
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "current";
}

export function daysUntil(date: string, today: string) {
  return differenceInCalendarDays(parseDate(date), parseDate(today));
}

/** Number of nights between two dates (check-in → check-out). */
export function nightsBetween(start: string, end: string) {
  return differenceInCalendarDays(parseDate(end), parseDate(start));
}

/** "October 14 – 19, 2026", "Sep 28 – Oct 3, 2026", "Dec 28, 2026 – Jan 2, 2027". */
export function formatDateRange(start: string, end: string, style: "long" | "short" = "long") {
  const s = parseDate(start);
  const e = parseDate(end);
  const month = style === "long" ? "MMMM" : "MMM";
  if (start === end) return format(s, `${month} d, yyyy`);
  if (!isSameYear(s, e)) return `${format(s, `${month} d, yyyy`)} – ${format(e, `${month} d, yyyy`)}`;
  if (!isSameMonth(s, e)) return `${format(s, `${month} d`)} – ${format(e, `${month} d, yyyy`)}`;
  return `${format(s, `${month} d`)} – ${format(e, "d, yyyy")}`;
}

/** "Wed, Oct 14, 2026" */
export function formatDayDate(date: string) {
  return format(parseDate(date), "EEE, MMM d, yyyy");
}

/** "Wed, Oct 14" */
export function formatShortDay(date: string) {
  return format(parseDate(date), "EEE, MMM d");
}

/** "8:20 AM" from "08:20:00" ("08:20" with the 24-hour preference). Presentation only. */
export function formatTime(time: string, clock: Clock = "12h") {
  return formatClockTime(time, clock);
}

/** "08:20" for <input type="time"> */
export function toTimeInput(time: string | null) {
  return time ? time.slice(0, 5) : "";
}

export function tripLengthDays(start: string, end: string) {
  return differenceInCalendarDays(parseDate(end), parseDate(start)) + 1;
}
