import { formatDayDate, formatShortDay, formatTime, nightsBetween } from "@/lib/dates";
import { zoneAbbreviation } from "@/lib/time-zones";
import type { Reservation } from "@/lib/types";

/** "8:20 AM EDT" — the stored wall-clock time, labelled with its zone. */
export function formatZonedTime(date: string, time: string, timeZone: string | null) {
  const zone = timeZone ? zoneAbbreviation(date, time, timeZone) : null;
  return zone ? `${formatTime(time)} ${zone}` : formatTime(time);
}

/** "Wed, Oct 14, 2026 · 8:20 AM EDT" — or just the date / nothing. */
export function formatMoment(date: string | null, time: string | null, short = false, timeZone: string | null = null) {
  if (!date) return null;
  const day = short ? formatShortDay(date) : formatDayDate(date);
  return time ? `${day} · ${formatZonedTime(date, time, timeZone)}` : day;
}

/** One-line place summary: "EWR → AUA" or the location. */
export function placeSummary(b: Reservation) {
  if (b.origin || b.destination) return [b.origin, b.destination].filter(Boolean).join(" → ");
  return b.location;
}

export function stayNights(b: Reservation) {
  if (b.kind !== "lodging" || !b.start_date || !b.end_date) return null;
  const n = nightsBetween(b.start_date, b.end_date);
  return n > 0 ? n : null;
}

/** Bookings in time order; undated ones last (already the DB order). */
export function upcomingFirst(bookings: Reservation[], today: string) {
  const dated = bookings.filter((b) => b.start_date);
  const next = dated.find((b) => (b.end_date ?? b.start_date)! >= today);
  return next ?? dated[0] ?? bookings[0] ?? null;
}

/** Treat short all-caps codes (EWR, AUA) as airport codes for display. */
export function looksLikeCode(value: string | null) {
  return Boolean(value && /^[A-Z0-9]{3,4}$/.test(value.trim()));
}
