import { buildAgenda, entryTitle, agendaCategory, agendaTitle, itemSchedule } from "@/lib/schedule";
import type { ItineraryCategory } from "@/lib/plan-options";
import type { ItineraryEntry, Reservation, ReservationKind } from "@/lib/types";

/**
 * Memories are read from the itinerary — a completed itinerary row *is* a
 * memory (rating, reflection, favorite live on it). Nothing here copies or
 * stores anything; every count is derived from those rows.
 */

export type JournalPhase = "before" | "during" | "after";

/** Before / during / after, judged by today in the trip's own zone. */
export function journalPhase(tripStart: string, tripEnd: string, todayInTripZone: string): JournalPhase {
  if (todayInTripZone < tripStart) return "before";
  if (todayInTripZone > tripEnd) return "after";
  return "during";
}

/** The day a visit happened: its own date, or its booking's start. */
export function visitDate(visit: ItineraryEntry) {
  return itemSchedule(visit).date;
}

/**
 * Completed activities = completed rows. Places visited = distinct linked
 * places among them (repeat visits count once); food & drink = the distinct
 * ones of kind "food". Unlinked activities are never counted as places.
 */
export function memoryStats(visits: Pick<ItineraryEntry, "status" | "place_id" | "place">[]) {
  const done = visits.filter((v) => v.status === "completed");
  const places = new Set<string>();
  const food = new Set<string>();
  for (const v of done) {
    if (!v.place_id) continue;
    places.add(v.place_id);
    if (v.place?.kind === "food") food.add(v.place_id);
  }
  return { completed: done.length, places: places.size, food: food.size };
}

export type JournalDay = {
  /** null = the visit's booking has no date. */
  date: string | null;
  /** 1-based trip day, or null outside the trip's dates. */
  dayNumber: number | null;
  visits: ItineraryEntry[];
};

/**
 * Completed visits grouped by day, oldest first. Repeat visits to the same
 * place stay separate entries. Undated visits come last.
 */
export function groupVisitsByDay(visits: ItineraryEntry[], tripStart: string, tripEnd: string): JournalDay[] {
  const byDate = new Map<string | null, ItineraryEntry[]>();
  for (const v of visits) {
    if (v.status !== "completed") continue;
    const date = visitDate(v);
    byDate.set(date, [...(byDate.get(date) ?? []), v]);
  }
  const startUtc = utc(tripStart);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0))
    .map(([date, list]) => ({
      date,
      dayNumber: date && date >= tripStart && date <= tripEnd ? Math.round((utc(date) - startUtc) / 86_400_000) + 1 : null,
      // Keep the query's order (time, then itinerary order) within a day.
      visits: list,
    }));
}

function utc(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export type CaptureCandidate = {
  key: string;
  target: { itemId: string } | { reservationId: string };
  title: string;
  date: string;
  category: ItineraryCategory;
  kind: ReservationKind | null;
  /** The time shown on that day, if any ("14:30:00"). */
  time: string | null;
};

/**
 * What "Capture a moment" offers from the itinerary: entries on trip days
 * up to today (in the trip's zone) that aren't done yet — activities,
 * place visits and bookings alike. Cancelled bookings and the second half
 * of a stay / flight (check-out, arrival) are left out. Most recent first.
 */
export function captureCandidates({
  items,
  reservations,
  tripStart,
  tripEnd,
  todayInTripZone,
}: {
  items: ItineraryEntry[];
  reservations: Reservation[];
  tripStart: string;
  tripEnd: string;
  todayInTripZone: string;
}): CaptureCandidate[] {
  const agenda = buildAgenda({ items, reservations, tripStart, tripEnd });
  const out: CaptureCandidate[] = [];
  for (const day of agenda.days) {
    if (day.date > todayInTripZone) continue;
    for (const e of day.entries) {
      if (e.role === "end" || e.cancelled || e.item?.status === "completed") continue;
      const target = e.item ? { itemId: e.item.id } : e.reservation ? { reservationId: e.reservation.id } : null;
      if (!target) continue;
      out.push({
        key: e.key,
        target,
        title: e.item ? entryTitle(e.item) : agendaTitle(e),
        date: day.date,
        category: agendaCategory(e),
        kind: e.reservation?.kind ?? null,
        time: e.time,
      });
    }
  }
  return out.reverse();
}

/** Favorites are completed visits flagged as favorite — the same rows, never a copy. */
export function favoriteVisits(visits: ItineraryEntry[]) {
  return visits.filter((v) => v.status === "completed" && v.is_favorite);
}
