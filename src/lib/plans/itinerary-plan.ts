import type { ItineraryCategory } from "@/lib/plan-options";
import { zonedInstant } from "@/lib/time-zones";
import type { ItineraryItem, Place, Reservation, Trip } from "@/lib/types";

/**
 * A saved itinerary plan (e.g. the Aruba family schedule) and the pure
 * comparison that turns it into a reviewable preview. No database access:
 * src/db/queries.ts loads the trip, runs `planPreview` and, on Apply,
 * re-runs it inside a locked transaction before writing anything.
 *
 * Matching rules (conservative on purpose):
 * - entries the plan wrote before carry `source_key` = "<plan id>:<item key>"
 *   and are matched by it — never appended twice;
 * - other standalone entries match only on the same day with the same
 *   normalized title (or a listed earlier title);
 * - anything the traveler changed, completed or reflected on is a conflict
 *   whose default is "keep mine"; nothing is reset to planned.
 * Bookings are never written: flights and the stay are checked and flagged.
 */

export type PlanItem = {
  /** Stable within the plan; stored as `<plan id>:<key>`. */
  key: string;
  date: string;
  /** "HH:MM" local wall-clock time in the plan's zone; null = flexible. */
  start: string | null;
  /** Null = open-ended (a point in time, or "duration varies" in the notes). */
  end: string | null;
  title: string;
  category: ItineraryCategory;
  notes: string | null;
  optional?: boolean;
  protectedRest?: boolean;
  /** An Explore place with exactly this name (normalized) is linked; none is ever created. */
  placeName?: string;
  /** Titles an earlier version of this plan used for the same entry. */
  aliases?: string[];
};

/** A scheduled flight time the traveler confirmed; checked against the saved booking. */
export type FlightAnchor = {
  kind: "arrival" | "departure";
  date: string;
  time: string;
  airport: string;
};

/** An outdated entry from an earlier plan version (matched by day, title and time window). */
export type RetireRule = {
  label: string;
  date: string;
  title: RegExp;
  /** Inclusive start-time window "HH:MM"; omit to match any time. */
  from?: string;
  to?: string;
};

export type ItineraryPlan = {
  id: string;
  label: string;
  destination: RegExp;
  startDate: string;
  endDate: string;
  timeZone: string;
  travelers: string[];
  stayName: string;
  days: { date: string; theme: string }[];
  anchors: FlightAnchor[];
  /** Where the arrival-day check-in and departure-day check-out sit in the plan. */
  stayChecks: { checkInBy: string; checkOutAt: string };
  items: PlanItem[];
  retire: RetireRule[];
};

/* ----------------------------- inputs ----------------------------- */

export type PlanRow = Pick<
  ItineraryItem,
  | "id"
  | "place_id"
  | "reservation_id"
  | "title"
  | "category"
  | "local_date"
  | "local_start_time"
  | "local_end_date"
  | "local_end_time"
  | "timezone"
  | "planning_notes"
  | "status"
  | "rating"
  | "reflection"
  | "is_favorite"
  | "is_optional"
  | "is_protected_rest"
  | "source_key"
  | "source_fingerprint"
  | "updated_at"
>;

export type PlanTrip = Pick<Trip, "id" | "title" | "destination" | "start_date" | "end_date" | "time_zone" | "travelers">;
export type PlanPlace = Pick<Place, "id" | "name">;
export type PlanReservation = Pick<
  Reservation,
  | "id"
  | "kind"
  | "status"
  | "title"
  | "provider"
  | "start_date"
  | "start_time"
  | "start_time_zone"
  | "end_date"
  | "end_time"
  | "end_time_zone"
  | "origin"
  | "destination"
  | "location"
  | "updated_at"
>;

/* ----------------------------- output ----------------------------- */

export type PlanNotice = {
  level: "ok" | "info" | "warning" | "blocker";
  title: string;
  detail?: string;
};

type ItemRef = { key: string; date: string; start: string | null; end: string | null; title: string };

export type PlanOp =
  | { kind: "add"; item: ItemRef; placeName: string | null }
  /** Written by the plan and untouched since: brought up to date. */
  | { kind: "update"; item: ItemRef; rowId: string; changes: string[] }
  /** An identical entry without a source: recorded as the plan's, nothing visible changes. */
  | { kind: "link"; item: ItemRef; rowId: string }
  | { kind: "unchanged"; item: ItemRef; rowId: string; kept: string[] }
  /** An outdated plan entry nobody touched. */
  | { kind: "remove"; rowId: string; title: string; date: string; label: string }
  | {
      kind: "conflict";
      /** Key for the traveler's choice. */
      id: string;
      reason: "edited" | "reviewed" | "match" | "retire";
      rowId: string;
      title: string;
      date: string;
      /** The plan entry involved (absent for outdated entries). */
      item: ItemRef | null;
      changes: string[];
      kept: string[];
      label?: string;
    };

export type PlanChoice = "keep" | "plan";

export type PlanPreview = {
  planId: string;
  label: string;
  /** Apply is refused (e.g. trip dates differ from the plan). */
  blocked: boolean;
  notices: PlanNotice[];
  ops: PlanOp[];
  counts: Record<PlanOp["kind"], number>;
  /** Offered when the trip's zone differs from the plan's. */
  zoneOption: { current: string; planned: string; sameClock: boolean } | null;
};

/* ----------------------------- helpers ---------------------------- */

export const sourceKey = (plan: Pick<ItineraryPlan, "id">, item: Pick<PlanItem, "key">) => `${plan.id}:${item.key}`;

/** Lowercase, no accents or punctuation, "&" → "and": "Lunch, baby nap & parents' rest" → "lunch baby nap and parents rest". */
export function normalizeTitle(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const timeKey = (t: string | null) => (t ? (t.length === 5 ? `${t}:00` : t) : null);
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** The planning columns the plan writes for an item. */
export function planValues(plan: Pick<ItineraryPlan, "timeZone">, item: PlanItem) {
  return {
    title: item.title,
    category: item.category,
    local_date: item.date,
    local_start_time: timeKey(item.start),
    local_end_date: null as string | null,
    local_end_time: timeKey(item.end),
    timezone: plan.timeZone,
    planning_notes: item.notes,
    is_optional: item.optional ?? false,
    is_protected_rest: item.protectedRest ?? false,
  };
}

type PlanningFields = ReturnType<typeof planValues>;

/** FNV-1a (two seeds → 16 hex chars). A change detector, not security. */
export function hashText(text: string) {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x01c9dc58);
}

/** Fingerprint of a row's planning fields, compared with what the plan last wrote. */
export function fingerprint(f: Pick<PlanningFields, keyof PlanningFields>) {
  return hashText(
    JSON.stringify([
      f.title,
      f.category,
      f.local_date,
      timeKey(f.local_start_time),
      f.local_end_date,
      timeKey(f.local_end_time),
      f.timezone,
      f.planning_notes,
      f.is_optional,
      f.is_protected_rest,
    ]),
  );
}

const rowFields = (row: PlanRow): PlanningFields => ({
  title: row.title ?? "",
  category: row.category,
  local_date: row.local_date ?? "",
  local_start_time: timeKey(row.local_start_time),
  local_end_date: row.local_end_date,
  local_end_time: timeKey(row.local_end_time),
  timezone: row.timezone ?? "",
  planning_notes: row.planning_notes,
  is_optional: row.is_optional,
  is_protected_rest: row.is_protected_rest,
});

/**
 * Has the row been edited since the plan wrote it? The stored fingerprint is
 * always of the plan's own values, so an entry whose notes were merged with
 * the traveler's counts as edited and is never overwritten automatically.
 */
const untouched = (row: PlanRow) => Boolean(row.source_fingerprint) && fingerprint(rowFields(row)) === row.source_fingerprint;

/** The traveler's own notes are never dropped; the plan's text only has to be in there. */
const notesCover = (rowNotes: string | null, planNotes: string | null) =>
  !planNotes || rowNotes === planNotes || Boolean(rowNotes?.includes(planNotes));

/** Notes after "use the plan" on an edited entry: theirs first, the plan's appended if missing. */
export function mergeNotes(rowNotes: string | null, planNotes: string | null) {
  if (notesCover(rowNotes, planNotes)) return rowNotes ?? planNotes;
  return rowNotes ? `${rowNotes}\n\n${planNotes}`.slice(0, 5000) : planNotes;
}

/** Which planning fields differ from the plan (empty = the row already says what the plan says). */
export function planDifferences(row: PlanRow, plan: Pick<ItineraryPlan, "timeZone">, item: PlanItem) {
  const want = planValues(plan, item);
  const changes: string[] = [];
  // A place visit without its own title shows the place's name — leave that alone.
  if (!(row.place_id && row.title === null) && row.title !== want.title) changes.push("title");
  if (row.local_date !== want.local_date) changes.push("day");
  if (timeKey(row.local_start_time) !== want.local_start_time || timeKey(row.local_end_time) !== want.local_end_time || row.local_end_date) {
    changes.push("time");
  }
  if (row.timezone !== want.timezone) changes.push("time zone");
  if (row.category !== want.category) changes.push("category");
  if (!notesCover(row.planning_notes, want.planning_notes)) changes.push("notes");
  if (row.is_optional !== want.is_optional) changes.push("optional");
  if (row.is_protected_rest !== want.is_protected_rest) changes.push("protected rest");
  return changes;
}

/** What the traveler decided or wrote on this entry — always kept. */
export function keptContent(row: PlanRow) {
  const kept: string[] = [];
  if (row.status === "completed") kept.push("done");
  if (row.status === "skipped") kept.push("skipped");
  if (row.rating !== null) kept.push("rating");
  if (row.reflection) kept.push("reflection");
  if (row.is_favorite) kept.push("favorite");
  if (row.place_id) kept.push("Explore place");
  return kept;
}

const hasReview = (row: PlanRow) =>
  row.status !== "planned" || row.rating !== null || Boolean(row.reflection) || row.is_favorite;

const ref = (item: PlanItem): ItemRef => ({ key: item.key, date: item.date, start: item.start, end: item.end, title: item.title });

const inWindow = (time: string | null, from?: string, to?: string) => {
  if (!from && !to) return true;
  const t = hhmm(time);
  return t !== null && (!from || t >= from) && (!to || t <= to);
};

/** Does this trip look like the plan's destination? */
export function planMatchesTrip(plan: Pick<ItineraryPlan, "destination">, trip: Pick<Trip, "title" | "destination">) {
  return plan.destination.test(trip.destination) || plan.destination.test(trip.title);
}

/* ----------------------------- checks ----------------------------- */

const fmt = (time: string | null) => {
  if (!time) return "no time";
  const [h, m] = time.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const AIRPORT = (code: string) => new RegExp(`\\b${code}\\b|aruba`, "i");

function flightNotices(plan: ItineraryPlan, reservations: PlanReservation[]): PlanNotice[] {
  const notices: PlanNotice[] = [];
  const flights = reservations.filter((r) => r.kind === "flight" && r.status !== "cancelled");
  for (const anchor of plan.anchors) {
    const arrival = anchor.kind === "arrival";
    const what = arrival ? "Arrival flight" : "Departure flight";
    const matches = flights.filter((r) =>
      arrival
        ? AIRPORT(anchor.airport).test(r.destination ?? "") && r.end_date === anchor.date
        : AIRPORT(anchor.airport).test(r.origin ?? "") && r.start_date === anchor.date,
    );
    if (matches.length === 0) {
      notices.push({
        level: "warning",
        title: `${what}: no saved booking found`,
        detail: `The plan expects ${anchor.kind === "arrival" ? "arriving at" : "leaving"} ${anchor.airport} at ${anchor.time} on ${anchor.date}. No flight entry is created — add the booking in Bookings and it appears on the itinerary by itself.`,
      });
      continue;
    }
    if (matches.length > 1) {
      notices.push({
        level: "warning",
        title: `${what}: ${matches.length} bookings look like it`,
        detail: `Check Bookings for a duplicate: ${matches.map((m) => m.title).join(", ")}.`,
      });
    }
    const r = matches[0];
    const time = arrival ? r.end_time : r.start_time;
    const zone = (arrival ? r.end_time_zone : r.start_time_zone) ?? null;
    if (hhmm(time) !== anchor.time) {
      notices.push({
        level: "warning",
        title: `${what} time differs: saved ${fmt(time)}, confirmed ${anchor.time}`,
        detail: `“${r.title}” was not changed. Edit the booking if ${anchor.time} is right.`,
      });
    } else {
      notices.push({ level: "ok", title: `${what} matches: ${anchor.time} on ${anchor.date} (“${r.title}”)` });
    }
    if (zone && zone !== plan.timeZone && time) {
      const same = zonedInstant(anchor.date, time, zone) === zonedInstant(anchor.date, time, plan.timeZone);
      notices.push({
        level: same ? "info" : "warning",
        title: `${what} is saved in ${zone}, not ${plan.timeZone}`,
        detail: same
          ? "Both zones are UTC−4 on these dates, so the time lines up. Relabel it in the booking form if you like — nothing here changes the booking."
          : "These zones differ on this date, so the saved instant is off. Fix the zone in the booking form.",
      });
    }
  }
  return notices;
}

function stayNotices(plan: ItineraryPlan, reservations: PlanReservation[]): PlanNotice[] {
  const stays = reservations.filter(
    (r) => r.kind === "lodging" && r.status !== "cancelled" && r.start_date && r.start_date <= plan.endDate && (r.end_date ?? r.start_date) >= plan.startDate,
  );
  if (stays.length === 0) {
    return [{ level: "warning", title: "No saved stay found", detail: "Check-in and check-out steps stay generic until you add the booking." }];
  }
  const notices: PlanNotice[] = [];
  const stay = stays[0];
  const text = [stay.title, stay.provider, stay.location].filter(Boolean).join(" ");
  if (normalizeTitle(text).includes(normalizeTitle(plan.stayName))) {
    notices.push({ level: "ok", title: `Using your saved stay: ${stay.title}` });
  } else {
    notices.push({
      level: "info",
      title: `Using your saved stay “${stay.title}”${stay.provider ? ` (${stay.provider})` : ""}`,
      detail: `The plan mentioned ${plan.stayName}; the saved booking is used as-is.${stay.location ? ` Address: ${stay.location}.` : ""}`,
    });
  }
  if (stay.start_date === plan.startDate && stay.start_time && hhmm(stay.start_time)! > plan.stayChecks.checkInBy) {
    notices.push({
      level: "warning",
      title: `Saved check-in opens at ${fmt(stay.start_time)}, after the plan’s ${plan.stayChecks.checkInBy} arrival`,
      detail: "Check the host’s instructions or adjust the arrival-day plan.",
    });
  }
  if (stay.end_date === plan.endDate && stay.end_time && hhmm(stay.end_time)! < plan.stayChecks.checkOutAt) {
    notices.push({
      level: "warning",
      title: `Saved check-out is ${fmt(stay.end_time)}, before the plan’s ${plan.stayChecks.checkOutAt} check-out`,
      detail: "The booking isn’t changed. Confirm a later check-out with the host, or move the Day 6 morning earlier after applying.",
    });
  }
  if (stays.length > 1) {
    notices.push({ level: "info", title: `${stays.length} stays overlap the trip`, detail: "The first one is used for these checks." });
  }
  return notices;
}

/* ----------------------------- preview ---------------------------- */

const ZERO: PlanPreview["counts"] = { add: 0, update: 0, link: 0, unchanged: 0, remove: 0, conflict: 0 };

export function planPreview({
  plan,
  trip,
  rows,
  places,
  reservations,
}: {
  plan: ItineraryPlan;
  trip: PlanTrip;
  rows: PlanRow[];
  places: PlanPlace[];
  reservations: PlanReservation[];
}): PlanPreview {
  const notices: PlanNotice[] = [];
  let blocked = false;

  if (!planMatchesTrip(plan, trip)) {
    blocked = true;
    notices.push({ level: "blocker", title: `This trip isn’t ${plan.label.split(" ")[0]}`, detail: "Open the matching trip to apply this plan." });
  }
  if (trip.start_date !== plan.startDate || trip.end_date !== plan.endDate) {
    blocked = true;
    notices.push({
      level: "blocker",
      title: `Trip dates differ: saved ${trip.start_date} – ${trip.end_date}, plan ${plan.startDate} – ${plan.endDate}`,
      detail: "Nothing was changed. Fix the trip dates (Edit trip) if the plan’s dates are right, then review again.",
    });
  } else {
    notices.push({ level: "ok", title: `Six trip days line up: ${plan.startDate} – ${plan.endDate}` });
  }

  let zoneOption: PlanPreview["zoneOption"] = null;
  if (trip.time_zone !== plan.timeZone) {
    const probe = "12:00";
    const sameClock = plan.days.every(
      (d) => zonedInstant(d.date, probe, trip.time_zone) === zonedInstant(d.date, probe, plan.timeZone),
    );
    zoneOption = { current: trip.time_zone, planned: plan.timeZone, sameClock };
    notices.push({
      level: "info",
      title: `Trip time zone is ${trip.time_zone}; plan entries use ${plan.timeZone}`,
      detail: sameClock
        ? "Same clock on these dates, so nothing shifts. You can switch the trip’s zone below."
        : "These zones differ on the trip dates — consider switching the trip’s zone below.",
    });
  }

  const missing = plan.travelers.filter((t) => !trip.travelers.some((s) => normalizeTitle(s) === normalizeTitle(t)));
  if (missing.length) {
    notices.push({
      level: "info",
      title: `Saved travelers: ${trip.travelers.join(", ") || "none"}`,
      detail: `The plan was written for ${plan.travelers.join(", ")}. Travelers aren’t changed here.`,
    });
  }

  notices.push(...flightNotices(plan, reservations), ...stayNotices(plan, reservations));
  if (!reservations.some((r) => r.kind === "car" && r.status !== "cancelled")) {
    notices.push({
      level: "info",
      title: "No rental car booking saved",
      detail: "Rental pickup and return steps stay generic — no company, location or confirmation is invented.",
    });
  }

  /* ---- entries ---- */
  const standalone = rows.filter((r) => !r.reservation_id);
  const placeName = new Map(places.map((p) => [p.id, p.name]));
  const prefix = `${plan.id}:`;
  const sourced = new Map(standalone.filter((r) => r.source_key?.startsWith(prefix)).map((r) => [r.source_key!, r]));
  const claimed = new Set<string>();
  const ops: PlanOp[] = [];

  for (const item of plan.items) {
    const key = sourceKey(plan, item);
    const row = sourced.get(key);
    if (row) {
      claimed.add(row.id);
      const changes = planDifferences(row, plan, item);
      const kept = keptContent(row);
      if (changes.length === 0) ops.push({ kind: "unchanged", item: ref(item), rowId: row.id, kept });
      else if (untouched(row) && !hasReview(row)) ops.push({ kind: "update", item: ref(item), rowId: row.id, changes });
      else
        ops.push({
          kind: "conflict",
          id: key,
          reason: untouched(row) ? "reviewed" : "edited",
          rowId: row.id,
          title: row.title ?? placeName.get(row.place_id ?? "") ?? item.title,
          date: row.local_date ?? item.date,
          item: ref(item),
          changes,
          kept,
        });
      continue;
    }

    const names = new Set([item.title, ...(item.aliases ?? [])].map(normalizeTitle));
    const match = standalone.find(
      (r) =>
        !claimed.has(r.id) &&
        !r.source_key &&
        r.local_date === item.date &&
        names.has(normalizeTitle(r.title ?? placeName.get(r.place_id ?? "") ?? "")),
    );
    if (match) {
      claimed.add(match.id);
      const changes = planDifferences(match, plan, item);
      if (changes.length === 0) ops.push({ kind: "link", item: ref(item), rowId: match.id });
      else
        ops.push({
          kind: "conflict",
          id: key,
          reason: "match",
          rowId: match.id,
          title: match.title ?? placeName.get(match.place_id ?? "") ?? item.title,
          date: item.date,
          item: ref(item),
          changes,
          kept: keptContent(match),
        });
      continue;
    }

    const place = item.placeName
      ? places.filter((p) => normalizeTitle(p.name) === normalizeTitle(item.placeName!))
      : [];
    ops.push({ kind: "add", item: ref(item), placeName: place.length === 1 ? place[0].name : null });
  }

  // Plan entries that later versions dropped.
  const planKeys = new Set(plan.items.map((i) => sourceKey(plan, i)));
  for (const row of sourced.values()) {
    if (planKeys.has(row.source_key!)) continue;
    claimed.add(row.id);
    const title = row.title ?? placeName.get(row.place_id ?? "") ?? "Untitled";
    if (untouched(row) && !hasReview(row) && !row.place_id) {
      ops.push({ kind: "remove", rowId: row.id, title, date: row.local_date ?? "", label: "No longer in the plan" });
    } else {
      ops.push({
        kind: "conflict", id: `row:${row.id}`, reason: "retire", rowId: row.id, title, date: row.local_date ?? "",
        item: null, changes: [], kept: keptContent(row), label: "No longer in the plan",
      });
    }
  }

  // Outdated entries from an earlier, unsourced version: always the traveler's call.
  for (const row of standalone) {
    if (claimed.has(row.id) || row.source_key) continue;
    const title = row.title ?? placeName.get(row.place_id ?? "") ?? "";
    const rule = plan.retire.find(
      (r) => r.date === row.local_date && r.title.test(title) && inWindow(row.local_start_time, r.from, r.to),
    );
    if (!rule) continue;
    claimed.add(row.id);
    ops.push({
      kind: "conflict", id: `row:${row.id}`, reason: "retire", rowId: row.id, title, date: row.local_date ?? "",
      item: null, changes: [], kept: keptContent(row), label: rule.label,
    });
  }

  const counts = { ...ZERO };
  for (const op of ops) counts[op.kind]++;
  return { planId: plan.id, label: plan.label, blocked, notices, ops, counts, zoneOption };
}

/**
 * Identifies exactly what was previewed: the operations plus the rows and
 * bookings they were computed from. Apply refuses a stale token instead of
 * acting on an itinerary that changed in between.
 */
export function previewToken(preview: PlanPreview, rows: PlanRow[], trip: PlanTrip, reservations: PlanReservation[]) {
  return hashText(
    JSON.stringify([
      preview.ops,
      preview.blocked,
      trip.time_zone,
      rows.map((r) => [r.id, r.updated_at]).sort(),
      reservations.map((r) => [r.id, r.updated_at]).sort(),
    ]),
  );
}

/** The day's theme line, shown once the plan has been applied to this trip. */
export function planDayTheme(plan: ItineraryPlan, date: string) {
  return plan.days.find((d) => d.date === date)?.theme ?? null;
}

/** Was this plan applied to the trip (any entry carries its source)? */
export function planApplied(plan: Pick<ItineraryPlan, "id">, items: Pick<ItineraryItem, "source_key">[]) {
  return items.some((i) => i.source_key?.startsWith(`${plan.id}:`));
}
