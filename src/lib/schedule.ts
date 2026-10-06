import type { ItineraryCategory } from "@/lib/plan-options";
import { zonedInstant } from "@/lib/time-zones";
import type { ItineraryEntry, ItineraryItem, Reservation, ReservationKind } from "@/lib/types";

/**
 * Itinerary schedule helpers. Pure functions on stored strings — calendar
 * dates ("2026-10-14") and local wall-clock times ("08:20:00") are never
 * parsed through the browser's zone, so nothing shifts by a day.
 *
 * Where a visit's time comes from:
 * - standalone / place visits: the item's own local_date + times + zone;
 * - reservation-backed visits: the reservation (start/end, each with its
 *   own zone). The item only adds ordering, completion and reflection.
 * Dated reservations without an itinerary item still appear on the
 * agenda, so nothing has to be entered twice.
 */

export type Schedule = {
  date: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  /** Zone of the start (and of the end, unless endTimeZone differs). */
  timeZone: string | null;
  endTimeZone: string | null;
  source: "item" | "reservation";
};

export function reservationSchedule(r: Reservation): Schedule {
  return {
    date: r.start_date,
    startTime: r.start_time,
    endDate: r.end_date,
    endTime: r.end_time,
    timeZone: r.start_time_zone,
    endTimeZone: r.end_time_zone ?? r.start_time_zone,
    source: "reservation",
  };
}

export function itemSchedule(item: ItineraryEntry): Schedule {
  if (item.reservation_id && item.reservation) return reservationSchedule(item.reservation);
  return {
    date: item.local_date,
    startTime: item.local_start_time,
    endDate: item.local_end_date ?? (item.local_end_time ? item.local_date : null),
    endTime: item.local_end_time,
    timeZone: item.timezone,
    endTimeZone: item.timezone,
    source: "item",
  };
}

/** True when the schedule ends on a later calendar day than it starts. */
export function endsOnLaterDay(s: Schedule) {
  return Boolean(s.date && s.endDate && s.endDate > s.date);
}

/** Display name: the item's own title, else its place, else its booking. */
export function entryTitle(item: ItineraryEntry) {
  return item.title ?? item.place?.name ?? item.reservation?.title ?? "Untitled";
}

const KIND_TO_CATEGORY: Record<ReservationKind, ItineraryCategory> = {
  flight: "transport",
  train: "transport",
  car: "transport",
  lodging: "lodging",
  restaurant: "food",
  activity: "activity",
  other: "other",
};

export function categoryForReservation(kind: ReservationKind): ItineraryCategory {
  return KIND_TO_CATEGORY[kind];
}

/* ----------------------------- dates ------------------------------ */

/** Calendar-date arithmetic in UTC, independent of the process zone. */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from one date to another (negative if earlier). */
export function daysBetweenDates(from: string, to: string) {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Every date from start to end inclusive. */
export function datesBetween(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const timeKey = (t: string | null) => (t ? (t.length === 5 ? `${t}:00` : t) : null);

/**
 * Turn a reservation's schedule into a standalone one that satisfies the
 * itinerary constraints — used when a booking is deleted but its visit
 * (with notes or a reflection) is kept. The end is kept only when it is in
 * the same zone and well-formed; a booking with no date (rare: dates can't
 * be cleared while a visit is linked) falls back to the trip's first day.
 */
export function standaloneScheduleFromReservation(
  r: Pick<
    Reservation,
    "start_date" | "start_time" | "start_time_zone" | "end_date" | "end_time" | "end_time_zone"
  >,
  trip: { start_date: string; time_zone: string },
): Pick<ItineraryItem, "local_date" | "local_start_time" | "local_end_date" | "local_end_time" | "timezone"> {
  if (!r.start_date) {
    return { local_date: trip.start_date, local_start_time: null, local_end_date: null, local_end_time: null, timezone: trip.time_zone };
  }
  const timezone = r.start_time_zone ?? trip.time_zone;
  const start = timeKey(r.start_time);
  const end = timeKey(r.end_time);
  const sameZone = !r.end_time_zone || r.end_time_zone === timezone;
  let local_end_date: string | null = null;
  let local_end_time: string | null = null;
  if (sameZone && r.end_date && r.end_date > r.start_date) {
    local_end_date = r.end_date;
    local_end_time = end;
  } else if (sameZone && r.end_date === r.start_date && start && end && end > start) {
    local_end_time = end;
  }
  return { local_date: r.start_date, local_start_time: start, local_end_date, local_end_time, timezone };
}

/* ----------------------------- agenda ----------------------------- */

/**
 * How an entry sits on a day. Multi-day stays and transport show as two
 * milestones (check-in / check-out, departure / arrival) on their own days
 * — never as an all-day block on every day in between.
 */
export type EntryRole = "single" | "start" | "end";

export type AgendaEntry = {
  /**
   * Stable identity: booking-backed entries are `r:<reservationId>` whether
   * or not an itinerary row exists yet, so linking one keeps UI state.
   * End milestones add `:end`.
   */
  key: string;
  role: EntryRole;
  /** The day this entry appears on. */
  date: string;
  /** Wall-clock time shown on this day (the end time for an end milestone) and its zone. */
  time: string | null;
  timeZone: string | null;
  /** The itinerary row (standalone, place visit, or a booking's link), if any. */
  item: ItineraryEntry | null;
  /** The booking, for booking-backed entries. */
  reservation: Reservation | null;
  schedule: Schedule;
  cancelled: boolean;
};

export type AgendaDay = {
  date: string;
  /** 1-based day of the trip, or null for dates outside the trip. */
  dayNumber: number | null;
  /** Timed entries first in time order, then flexible ones (see splitDay). */
  entries: AgendaEntry[];
};

export type Agenda = {
  /** Every trip day, even empty ones. */
  days: AgendaDay[];
  /** Dates outside the trip that still have entries (e.g. after the trip was shortened). Never dropped. */
  outside: AgendaDay[];
  /** Booking-backed visits whose booking currently has no date. */
  unscheduled: AgendaEntry[];
  /** Cancelled bookings left out because includeCancelled was false. */
  hiddenCancelled: number;
};

const MILESTONE_KINDS = new Set<ReservationKind>(["lodging", "flight", "train", "car"]);

/** Display name of any agenda entry. */
export function agendaTitle(e: Pick<AgendaEntry, "item" | "reservation">) {
  return e.item ? entryTitle(e.item) : (e.reservation?.title ?? "Untitled");
}

export function agendaCategory(e: Pick<AgendaEntry, "item" | "reservation">): ItineraryCategory {
  return e.item?.category ?? (e.reservation ? categoryForReservation(e.reservation.kind) : "other");
}

/** Instant used to order timed entries (zones respected); null when untimed. */
export function entryInstant(e: Pick<AgendaEntry, "date" | "time" | "timeZone">) {
  return e.time ? zonedInstant(e.date, e.time, e.timeZone) : null;
}

const orderOf = (e: AgendaEntry) => e.item?.sort_order ?? 0;
const createdOf = (e: AgendaEntry) => e.item?.created_at ?? e.reservation?.created_at ?? "";

/** Timed entries by real instant; ties and untimed entries by sort_order, then creation. */
function compareEntries(a: AgendaEntry, b: AgendaEntry) {
  const ia = entryInstant(a);
  const ib = entryInstant(b);
  if ((ia === null) !== (ib === null)) return ia === null ? 1 : -1;
  if (ia !== null && ib !== null && ia !== ib) return ia - ib;
  if (orderOf(a) !== orderOf(b)) return orderOf(a) - orderOf(b);
  return createdOf(a) < createdOf(b) ? -1 : createdOf(a) > createdOf(b) ? 1 : 0;
}

function toEntries(base: Omit<AgendaEntry, "role" | "date" | "time" | "timeZone" | "key">, key: string): AgendaEntry[] {
  const s = base.schedule;
  if (!s.date) return [];
  const kind = base.reservation?.kind;
  const splits = Boolean(kind && MILESTONE_KINDS.has(kind) && s.endDate && s.endDate > s.date);
  if (!splits) {
    return [{ ...base, key, role: "single", date: s.date, time: s.startTime, timeZone: s.timeZone }];
  }
  return [
    { ...base, key, role: "start", date: s.date, time: s.startTime, timeZone: s.timeZone },
    { ...base, key: `${key}:end`, role: "end", date: s.endDate!, time: s.endTime, timeZone: s.endTimeZone },
  ];
}

/**
 * Merge itinerary rows and bookings into a day-by-day agenda. A booking
 * shows once: through its itinerary row when it has one, otherwise by
 * itself. Entries dated outside the trip are kept in `outside`.
 */
export function buildAgenda({
  items,
  reservations,
  tripStart,
  tripEnd,
  includeCancelled = false,
}: {
  items: ItineraryEntry[];
  reservations: Reservation[];
  tripStart: string;
  tripEnd: string;
  includeCancelled?: boolean;
}): Agenda {
  const linked = new Set(items.map((i) => i.reservation_id).filter(Boolean));
  const bases = [
    ...items.map((item) => ({
      key: item.reservation_id ? `r:${item.reservation_id}` : `i:${item.id}`,
      base: {
        item,
        reservation: item.reservation,
        schedule: itemSchedule(item),
        cancelled: item.reservation?.status === "cancelled",
      },
    })),
    ...reservations
      .filter((r) => !linked.has(r.id))
      .map((r) => ({
        key: `r:${r.id}`,
        base: { item: null, reservation: r, schedule: reservationSchedule(r), cancelled: r.status === "cancelled" },
      })),
  ];

  let hiddenCancelled = 0;
  const unscheduled: AgendaEntry[] = [];
  const byDate = new Map<string, AgendaEntry[]>();
  for (const { key, base } of bases) {
    if (base.cancelled && !includeCancelled) {
      if (base.schedule.date) hiddenCancelled++;
      continue;
    }
    if (!base.schedule.date) {
      // Only itinerary rows can be undated here (their booking lost its date).
      if (base.item) unscheduled.push({ ...base, key, role: "single", date: "", time: null, timeZone: null });
      continue;
    }
    const parts = toEntries(base, key);
    for (const entry of parts) {
      // A departure the night before or an arrival home after the trip is
      // shown through its other end inside the trip, not as "outside".
      const outside = entry.date < tripStart || entry.date > tripEnd;
      const otherInside = parts.some((o) => o !== entry && o.date >= tripStart && o.date <= tripEnd);
      if (outside && otherInside) continue;
      byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
    }
  }

  const tripDays = datesBetween(tripStart, tripEnd);
  const inTrip = new Set(tripDays);
  const day = (date: string, dayNumber: number | null): AgendaDay => ({
    date,
    dayNumber,
    entries: (byDate.get(date) ?? []).sort(compareEntries),
  });

  return {
    days: tripDays.map((date, i) => day(date, i + 1)),
    outside: [...byDate.keys()]
      .filter((d) => !inTrip.has(d))
      .sort()
      .map((d) => day(d, null)),
    unscheduled: unscheduled.sort(compareEntries),
    hiddenCancelled,
  };
}

/** A day's entries split into the timeline (timed, chronological) and the Flexible list. */
export function splitDay(entries: AgendaEntry[]) {
  return { timed: entries.filter((e) => e.time), flexible: entries.filter((e) => !e.time) };
}

/**
 * Gentle overlap hints for a day's timed entries: key → titles it overlaps.
 * Entries with an end are intervals, others points. Stays, skipped and
 * cancelled entries are ignored. Never blocks anything.
 */
export function findOverlaps(entries: AgendaEntry[]) {
  type Span = { key: string; title: string; start: number; end: number | null };
  const spans: Span[] = [];
  for (const e of entries) {
    if (!e.time || e.cancelled || e.item?.status === "skipped" || e.reservation?.kind === "lodging") continue;
    const start = entryInstant(e);
    if (start === null) continue;
    let end: number | null = null;
    if (e.role === "single" && e.schedule.endTime) {
      end = zonedInstant(e.schedule.endDate ?? e.date, e.schedule.endTime, e.schedule.endTimeZone);
      if (end !== null && end <= start) end = null;
    }
    spans.push({ key: e.key, title: agendaTitle(e), start, end });
  }
  const overlaps = new Map<string, string[]>();
  const add = (a: Span, b: Span) => overlaps.set(a.key, [...(overlaps.get(a.key) ?? []), b.title]);
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i];
      const b = spans[j];
      const aEnd = a.end ?? a.start;
      const bEnd = b.end ?? b.start;
      // Same start, or one starts strictly inside the other.
      if (a.start === b.start || (a.start < bEnd && b.start < aEnd)) {
        add(a, b);
        add(b, a);
      }
    }
  }
  return overlaps;
}

/** Itinerary default: today (in the trip's zone) while the trip is on, else the first day. */
export function defaultItineraryDay(tripStart: string, tripEnd: string, todayInTripZone: string) {
  return todayInTripZone >= tripStart && todayInTripZone <= tripEnd ? todayInTripZone : tripStart;
}

/** Overview preview: today during the trip, the first day before it, the last day after it. */
export function previewDay(tripStart: string, tripEnd: string, todayInTripZone: string) {
  if (todayInTripZone < tripStart) return tripStart;
  if (todayInTripZone > tripEnd) return tripEnd;
  return todayInTripZone;
}

/**
 * Does a visit hold anything the traveler wrote or decided? Such visits
 * survive deletion of their booking (converted to standalone); bare links
 * that only placed a booking on the itinerary are removed with it.
 */
export function visitHasUserContent(
  item: Pick<ItineraryItem, "status" | "rating" | "reflection" | "planning_notes" | "is_favorite" | "place_id" | "title">,
) {
  return Boolean(
    item.status !== "planned" ||
      item.rating !== null ||
      item.reflection ||
      item.planning_notes ||
      item.is_favorite ||
      item.place_id ||
      item.title,
  );
}
