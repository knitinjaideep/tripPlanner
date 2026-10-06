import { BOOKING_KIND_META } from "@/lib/booking-kinds";
import { formatShortDay, formatTime, nightsBetween } from "@/lib/dates";
import { LABELS, type ItineraryCategory } from "@/lib/plan-options";
import type { AgendaEntry } from "@/lib/schedule";
import { mapsLink } from "@/lib/explore";
import { zoneAbbreviation } from "@/lib/time-zones";

/**
 * Display text for agenda entries. Stored wall-clock values are formatted
 * as-is; zone abbreviations are labels only.
 */

const TRANSPORT = new Set(["flight", "train", "car"]);

/** "8:20 AM" + "EDT" for the time column; null when untimed. */
export function entryClock(e: Pick<AgendaEntry, "date" | "time" | "timeZone">) {
  if (!e.time) return null;
  return { time: formatTime(e.time), zone: e.timeZone ? zoneAbbreviation(e.date, e.time, e.timeZone) : null };
}

function zoned(date: string, time: string, zone: string | null) {
  const abbr = zone ? zoneAbbreviation(date, time, zone) : null;
  return abbr ? `${formatTime(time)} ${abbr}` : formatTime(time);
}

/** "Check-in", "Arrives", … for milestones and bookings; null for plain activities. */
export function entryLabel(e: AgendaEntry) {
  const r = e.reservation;
  if (!r) return null;
  const meta = BOOKING_KIND_META[r.kind];
  if (e.role === "end") return meta.endLabel;
  if (r.kind === "lodging" || TRANSPORT.has(r.kind)) return meta.startLabel;
  return meta.label;
}

/** One muted line under the title: route, the other end, place, length. */
export function entryDetail(e: AgendaEntry) {
  const s = e.schedule;
  const r = e.reservation;
  const parts: string[] = [];

  if (r && TRANSPORT.has(r.kind)) {
    const route = [r.origin, r.destination].filter(Boolean).join(" → ");
    if (route) parts.push(route);
    if (e.role === "end" && s.date) {
      parts.push(`left ${formatShortDay(s.date)}${s.startTime ? ` · ${zoned(s.date, s.startTime, s.timeZone)}` : ""}`);
    } else if (s.endTime && s.endDate) {
      const sameDay = s.endDate === s.date;
      parts.push(`${BOOKING_KIND_META[r.kind].endLabel.toLowerCase()} ${sameDay ? "" : `${formatShortDay(s.endDate)} · `}${zoned(s.endDate, s.endTime, s.endTimeZone)}`);
    } else if (s.endDate && s.endDate !== s.date) {
      parts.push(`${BOOKING_KIND_META[r.kind].endLabel.toLowerCase()} ${formatShortDay(s.endDate)}`);
    }
    return parts.join(" · ");
  }

  if (r?.kind === "lodging") {
    if (e.role !== "end" && s.date && s.endDate && s.endDate > s.date) {
      const n = nightsBetween(s.date, s.endDate);
      parts.push(`${n === 1 ? "1 night" : `${n} nights`} · until ${formatShortDay(s.endDate)}`);
    }
    if (r.location) parts.push(r.location);
    return parts.join(" · ");
  }

  if (s.endTime && s.endDate) {
    parts.push(s.endDate === s.date ? `until ${zoned(s.endDate, s.endTime, s.endTimeZone)}` : `until ${formatShortDay(s.endDate)} · ${zoned(s.endDate, s.endTime, s.endTimeZone)}`);
  } else if (s.endDate && s.date && s.endDate > s.date) {
    parts.push(`until ${formatShortDay(s.endDate)}`);
  }
  const where = e.item?.place?.address ?? r?.location;
  if (where) parts.push(where);
  return parts.join(" · ");
}

/** A maps link for a place: its saved link, else a search for its name and address. */
export function placeMapsUrl(place: { name: string; address: string | null; maps_url: string | null }) {
  return mapsLink(place).url;
}

export function categoryLabel(category: ItineraryCategory) {
  return LABELS.itineraryCategory[category];
}

/** Itinerary URL for a day; the selected day lives in the query string. */
export function itineraryHref(tripId: string, date: string, showCancelled = false) {
  const query = new URLSearchParams({ day: date });
  if (showCancelled) query.set("cancelled", "1");
  return `/trips/${tripId}/itinerary?${query}`;
}
