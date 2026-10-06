import { formatTime } from "@/lib/dates";
import { formatRange, roundTrip, type MinuteRange } from "@/lib/recommendations";
import { agendaTitle, buildAgenda, entryInstant, type AgendaEntry } from "@/lib/schedule";
import { zonedInstant } from "@/lib/time-zones";
import type { ItineraryEntry, Reservation } from "@/lib/types";

/**
 * Deterministic checks for "Add to itinerary" from Explore: does a proposed
 * outing (plus its estimated drive each way) run into existing entries,
 * protected rest blocks, or airport logistics? Pure and advisory — it never
 * moves anything; the form asks the traveler to adjust the time or keep it.
 *
 * Times are local wall-clock values in the trip's zone; entries in other
 * zones (flights) are compared by real instant, so the process zone never
 * matters. Drive ranges are planning estimates: the window uses the upper
 * end of the range, and nothing here is routing.
 */

/** Landing → checked in at the stay, as the saved Aruba plan allows (15:20 → 18:15). */
export const ARRIVAL_SETTLE_MINUTES = 175;
/** Leaving the stay before a departure, as the saved Aruba plan allows (check-out 10:15 for 15:10). */
export const DEPARTURE_LEAVE_MINUTES = 295;

export type OutingProposal = {
  date: string;
  /** "HH:MM" in the trip's zone; null = no time chosen yet. */
  start: string | null;
  end: string | null;
  /** One-way estimated drive from the stay. */
  drive: MinuteRange | null;
  /** One adult goes alone while the other stays with the baby (e.g. a spa turn). */
  soloParent: boolean;
};

export type OutingContext = {
  tripStart: string;
  tripEnd: string;
  timeZone: string;
  items: ItineraryEntry[];
  reservations: Reservation[];
};

export type OutingNoticeCode =
  | "outside_trip"
  | "arrival_day"
  | "departure_day"
  | "arrival_buffer"
  | "departure_buffer"
  | "rest_overlap"
  | "rest_solo"
  | "solo_overlap"
  | "overlap"
  | "travel_overlap"
  | "long_drive"
  | "needs_time";

export type OutingNotice = {
  code: OutingNoticeCode;
  level: "warning" | "info";
  title: string;
  detail?: string;
  /** The traveler must explicitly keep this before saving. */
  confirm: boolean;
};

const MIN = 60_000;

const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/** "12:30 PM" for a minute-of-day, clamped to the day. */
const clock = (minutes: number) => {
  const m = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return formatTime(`${Math.floor(m / 60)}:${m % 60}`);
};

type Span = { title: string; start: number; end: number; label: string; rest: boolean; spa: boolean };

function spansFor(entries: AgendaEntry[]): Span[] {
  const spans: Span[] = [];
  for (const e of entries) {
    if (!e.time || e.cancelled || e.item?.status === "skipped") continue;
    // Stays never clash; flights are checked against the airport buffers instead.
    if (e.reservation?.kind === "lodging" || e.reservation?.kind === "flight") continue;
    const start = entryInstant(e);
    if (start === null) continue;
    let end = start;
    if (e.role === "single" && e.schedule.endTime) {
      const at = zonedInstant(e.schedule.endDate ?? e.date, e.schedule.endTime, e.schedule.endTimeZone);
      if (at !== null && at > start) end = at;
    }
    const label =
      end > start && e.role === "single" && e.schedule.endTime
        ? `${formatTime(e.time)}–${formatTime(e.schedule.endTime)}`
        : formatTime(e.time);
    spans.push({
      title: agendaTitle(e),
      start,
      end,
      label,
      rest: Boolean(e.item?.is_protected_rest),
      spa: e.item?.place?.category === "spa",
    });
  }
  return spans;
}

/** Strict overlap: touching boundaries ("back at 12:00", "rest from 12:00") don't count. A point counts when strictly inside. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  if (aEnd === aStart) return aStart > bStart && aStart < bEnd;
  if (bEnd === bStart) return bStart > aStart && bStart < aEnd;
  return aStart < bEnd && bStart < aEnd;
}

export function checkOuting(p: OutingProposal, ctx: OutingContext): OutingNotice[] {
  const notices: OutingNotice[] = [];
  const drive = p.drive;

  if (drive && drive.max >= 30) {
    const rt = roundTrip(drive);
    notices.push({
      code: "long_drive",
      level: "info",
      title: `Longer drive: about ${formatRange(rt)} min round trip (est.)`,
      detail: "On top of the time there. Estimated drive from your stay — check Maps for current routing.",
      confirm: false,
    });
  }

  if (p.date < ctx.tripStart || p.date > ctx.tripEnd) {
    notices.push({ code: "outside_trip", level: "warning", title: "This day is outside the trip dates.", confirm: true });
  }
  const arrivalDay = p.date === ctx.tripStart;
  const departureDay = p.date === ctx.tripEnd && !arrivalDay;
  if (arrivalDay) {
    notices.push({
      code: "arrival_day",
      level: "warning",
      title: "Arrival day — no outings are planned today.",
      detail: "Landing, immigration, baggage, the rental car and check-in come first. Keep it only if you really want to.",
      confirm: true,
    });
  }
  if (departureDay) {
    notices.push({
      code: "departure_day",
      level: "warning",
      title: "Departure day — keep check-out, the rental-car return and airport time free.",
      confirm: true,
    });
  }

  const agenda = buildAgenda({ items: ctx.items, reservations: ctx.reservations, tripStart: ctx.tripStart, tripEnd: ctx.tripEnd });
  const day = [...agenda.days, ...agenda.outside].find((d) => d.date === p.date);
  const spans = spansFor(day?.entries ?? []);

  if (!p.start) {
    if (spans.length) {
      notices.push({ code: "needs_time", level: "info", title: "Choose a start time to check it against this day’s plans.", confirm: false });
    }
    return notices;
  }

  const startMin = toMinutes(p.start);
  const endMin = p.end && toMinutes(p.end) > startMin ? toMinutes(p.end) : startMin;
  const at = (minutes: number) => zonedInstant(p.date, `${Math.floor(minutes / 60)}:${minutes % 60}`, ctx.timeZone)!;
  const visitStart = at(startMin);
  const visitEnd = endMin === startMin ? visitStart : at(endMin);
  const each = drive?.max ?? 0;
  const leave = visitStart - each * MIN;
  const back = visitEnd + each * MIN;
  const windowText = each
    ? `Leaving about ${clock(startMin - each)} and back about ${clock(endMin + each)}, with up to ${each} min of driving each way (est.).`
    : undefined;

  // Airport logistics, from the trip's own flights (cancelled ones ignored).
  for (const f of ctx.reservations) {
    if (f.kind !== "flight" || f.status === "cancelled") continue;
    if (!arrivalDay && !departureDay) continue;
    if (arrivalDay && f.end_date === p.date && f.end_time) {
      const landed = zonedInstant(f.end_date, f.end_time, f.end_time_zone ?? f.start_time_zone);
      if (landed !== null && leave < landed + ARRIVAL_SETTLE_MINUTES * MIN) {
        notices.push({
          code: "arrival_buffer",
          level: "warning",
          title: `Too soon after landing at ${formatTime(f.end_time)}.`,
          detail: "The plan allows about 3 hours for immigration, baggage, the rental car and getting to the condo.",
          confirm: true,
        });
      }
    }
    if (departureDay && f.start_date === p.date && f.start_time) {
      const departs = zonedInstant(f.start_date, f.start_time, f.start_time_zone);
      if (departs !== null && back > departs - DEPARTURE_LEAVE_MINUTES * MIN) {
        notices.push({
          code: "departure_buffer",
          level: "warning",
          title: `Runs into the ${formatTime(f.start_time)} departure.`,
          detail: "The plan has you checking out about 5 hours before the flight to return the car and reach the airport 3 hours early.",
          confirm: true,
        });
      }
    }
  }

  for (const s of spans) {
    const visitClash = overlaps(visitStart, visitEnd, s.start, s.end);
    const windowClash = overlaps(leave, back, s.start, s.end);
    if (!visitClash && !windowClash) continue;
    if (s.rest) {
      notices.push(
        p.soloParent
          ? {
              code: "rest_solo",
              level: "info",
              title: `During “${s.title}” (${s.label})`,
              detail: "Fine as a solo appointment while the other parent stays with Arjun at the condo.",
              confirm: false,
            }
          : {
              code: "rest_overlap",
              level: "warning",
              title: `Overlaps the protected rest block “${s.title}” (${s.label}).`,
              detail: `${windowText ?? ""} Adjust the time, or keep it — the rest block won’t be moved.`.trim(),
              confirm: true,
            },
      );
    } else if (p.soloParent && s.spa) {
      notices.push({
        code: "solo_overlap",
        level: "warning",
        title: `Both parents would be away — “${s.title}” (${s.label}) is already planned.`,
        detail: "Book separate appointments on different afternoons so one parent stays with Arjun.",
        confirm: true,
      });
    } else if (visitClash) {
      notices.push({ code: "overlap", level: "warning", title: `Overlaps “${s.title}” (${s.label}).`, confirm: false });
    } else {
      notices.push({
        code: "travel_overlap",
        level: "info",
        title: `Tight around “${s.title}” (${s.label}).`,
        detail: windowText,
        confirm: false,
      });
    }
  }
  return notices;
}

/** "13:30" — start plus minutes, or null when it would run past midnight. */
export function addMinutesToTime(time: string, minutes: number) {
  const total = toMinutes(time) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
