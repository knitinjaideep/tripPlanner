import { formatDayDate, formatShortDay, formatTime, nightsBetween } from "@/lib/dates";
import type { Booking } from "@/lib/types";

/** "Wed, Oct 14, 2026 · 8:20 AM" — or just the date / nothing. */
export function formatMoment(date: string | null, time: string | null, short = false) {
  if (!date) return null;
  const day = short ? formatShortDay(date) : formatDayDate(date);
  return time ? `${day} · ${formatTime(time)}` : day;
}

/** One-line place summary: "EWR → AUA" or the location. */
export function placeSummary(b: Booking) {
  if (b.origin || b.destination) return [b.origin, b.destination].filter(Boolean).join(" → ");
  return b.location;
}

export function stayNights(b: Booking) {
  if (b.kind !== "lodging" || !b.start_date || !b.end_date) return null;
  const n = nightsBetween(b.start_date, b.end_date);
  return n > 0 ? n : null;
}

/** Bookings in time order; undated ones last (already the DB order). */
export function upcomingFirst(bookings: Booking[], today: string) {
  const dated = bookings.filter((b) => b.start_date);
  const next = dated.find((b) => (b.end_date ?? b.start_date)! >= today);
  return next ?? dated[0] ?? bookings[0] ?? null;
}

/** Treat short all-caps codes (EWR, AUA) as airport codes for display. */
export function looksLikeCode(value: string | null) {
  return Boolean(value && /^[A-Z0-9]{3,4}$/.test(value.trim()));
}
