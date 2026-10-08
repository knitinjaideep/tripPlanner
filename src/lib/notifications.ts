/**
 * Notifications — the pure, client-safe half: the registry of notification
 * types, the shapes the browser receives, destinations, text hygiene, the
 * itinerary change summary, and the Today / Yesterday / Earlier grouping.
 * Nothing here touches the database or secrets; the writes and the
 * authorization checks live in src/db/notifications.ts (reached only through
 * src/lib/dal.ts).
 *
 * Adding a feature's notifications (polls, evening previews, reminders):
 * 1. flip `enabled` to true on its entry in NOTIFICATION_KINDS and give it a
 *    `destination` (an in-app path that satisfies `isSafeInternalPath`);
 * 2. add its payload to `NotificationDraft` and a small builder next to the
 *    domain write in the DAL — the same transaction, via `createNotifications`;
 * 3. choose a stable `dedupeKey` for the event (see `dedupeKeys`).
 * The service refuses to create a type that is not enabled, so nothing can
 * emit a notification for a feature that does not exist yet.
 */
import { formatShortDay, formatTime } from "@/lib/dates";
import { zonedInstant, isValidTimeZone } from "@/lib/time-zones";

/* ------------------------------ registry ------------------------------ */

export type ResourceType = "invitation" | "itinerary_item" | "poll" | "trip_day" | "reminder";

/** What a notification needs from the server to work out where it leads. */
export type DestinationContext = {
  tripId: string | null;
  resourceId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  /** The recipient currently owns the trip or is a member of it. */
  isMember: boolean;
};

type KindDefinition = {
  /** false = reserved for a later feature; the service refuses to create it. */
  enabled: boolean;
  /**
   * "trip": visible only while the recipient owns / belongs to the trip.
   * "invitation": also visible while an open invitation addressed to their
   * verified email exists (they are not a member yet).
   */
  scope: "trip" | "invitation";
  resource: ResourceType;
  /** Small label for the item ("Itinerary", "Invitation"). */
  label: string;
  /** Where opening it leads, or null when there is nowhere to go. Always checked by `isSafeInternalPath`. */
  destination: (ctx: DestinationContext) => string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const NOTIFICATION_KINDS = {
  invitation_received: {
    enabled: true,
    scope: "invitation",
    resource: "invitation",
    label: "Invitation",
    destination: ({ tripId, resourceId, isMember }) =>
      isMember && tripId ? `/trips/${tripId}` : resourceId ? `/invitations/${resourceId}` : null,
  },
  invitation_accepted: {
    enabled: true,
    scope: "trip",
    resource: "invitation",
    label: "Trip members",
    destination: ({ tripId }) => (tripId ? `/trips/${tripId}` : null),
  },
  itinerary_changed: {
    enabled: true,
    scope: "trip",
    resource: "itinerary_item",
    label: "Itinerary",
    destination: ({ tripId, metadata }) => {
      if (!tripId) return null;
      const day = typeof metadata.date === "string" && ISO_DAY.test(metadata.date) ? metadata.date : null;
      return day ? `/trips/${tripId}/itinerary?day=${day}` : `/trips/${tripId}/itinerary`;
    },
  },
  poll_vote_needed: {
    enabled: true,
    scope: "trip",
    resource: "poll",
    label: "Ask the group",
    destination: ({ tripId, resourceId }) => (tripId && resourceId ? `/trips/${tripId}/polls?poll=${resourceId}` : null),
  },
  poll_result: {
    enabled: true,
    scope: "trip",
    resource: "poll",
    label: "Group decision",
    destination: ({ tripId, resourceId }) => (tripId && resourceId ? `/trips/${tripId}/polls?poll=${resourceId}` : null),
  },
  evening_preview: {
    enabled: true,
    scope: "trip",
    resource: "trip_day",
    label: "Tomorrow",
    // A poll that isn't about tomorrow leads to the polls page; otherwise to tomorrow's plan (polls about it sit beside it).
    destination: ({ tripId, metadata }) => {
      if (!tripId) return null;
      if (typeof metadata.poll === "string" && UUID_ONLY.test(metadata.poll)) return `/trips/${tripId}/polls?poll=${metadata.poll}`;
      const day = typeof metadata.date === "string" && ISO_DAY.test(metadata.date) ? metadata.date : null;
      return day ? `/trips/${tripId}/itinerary?day=${day}` : `/trips/${tripId}/itinerary`;
    },
  },
  reminder: {
    enabled: true,
    scope: "trip",
    resource: "reminder",
    label: "Reminder",
    // metadata carries which record it is about (`s` = booking | task, `sid` = its id). The link always opens CURRENT data.
    destination: ({ tripId, metadata }) => {
      if (!tripId || typeof metadata.sid !== "string" || !UUID_ONLY.test(metadata.sid)) return tripId ? `/trips/${tripId}` : null;
      if (metadata.s === "booking") return `/trips/${tripId}/bookings?booking=${metadata.sid}`;
      if (metadata.s === "task") return `/trips/${tripId}/packing?task=${metadata.sid}`;
      return `/trips/${tripId}`;
    },
  },
} as const satisfies Record<string, KindDefinition>;

export type NotificationType = keyof typeof NOTIFICATION_KINDS;
export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_KINDS) as NotificationType[];

export const isNotificationType = (value: unknown): value is NotificationType =>
  typeof value === "string" && Object.hasOwn(NOTIFICATION_KINDS, value);

export const kindOf = (type: string): KindDefinition | null =>
  isNotificationType(type) ? (NOTIFICATION_KINDS[type] as KindDefinition) : null;

/** Types that may exist today. */
export const ENABLED_TYPES = NOTIFICATION_TYPES.filter((t) => NOTIFICATION_KINDS[t].enabled);
/** Types whose visibility can also come from an open invitation (see `scope`). */
export const INVITATION_SCOPED_TYPES = NOTIFICATION_TYPES.filter((t) => NOTIFICATION_KINDS[t].scope === "invitation");

/* ------------------------------ drafts ------------------------------- */

/**
 * What a feature hands to the notification service. Built on the server from
 * verified state only — never from request fields. `recipientId` is checked
 * against current membership (or the open invitation) before anything is
 * written, and `dedupeKey` makes repeating the same event a no-op.
 */
type DraftBase = {
  recipientId: string;
  actorId: string | null;
  dedupeKey: string;
  title: string;
  body: string;
};

export type NotificationDraft =
  | (DraftBase & { type: "invitation_received"; tripId: string; invitationId: string })
  | (DraftBase & { type: "invitation_accepted"; tripId: string; invitationId: string })
  | (DraftBase & { type: "itinerary_changed"; tripId: string; itemId: string; date: string | null })
  | (DraftBase & { type: "poll_vote_needed"; tripId: string; pollId: string })
  | (DraftBase & { type: "poll_result"; tripId: string; pollId: string })
  | (DraftBase & { type: "evening_preview"; tripId: string; date: string; /** An unresolved poll the preview points at instead of the day. */ pollId?: string | null })
  | (DraftBase & { type: "reminder"; tripId: string; reminderId: string; occurrence: number; subject: "booking" | "task"; subjectId: string });

/** Stable dedupe keys, one place so two features can never collide by accident. */
export const dedupeKeys = {
  invitationReceived: (invitationId: string) => `invitation_received:${invitationId}`,
  invitationAccepted: (invitationId: string) => `invitation_accepted:${invitationId}`,
  /** One per saved write: `rowVersion` is the item's `updated_at` after that write. */
  itineraryAdded: (itemId: string) => `itinerary_added:${itemId}`,
  itineraryRemoved: (itemId: string) => `itinerary_removed:${itemId}`,
  itineraryChanged: (itemId: string, rowVersion: string) => `itinerary_changed:${itemId}:${rowVersion}`,
  pollVoteNeeded: (pollId: string) => `poll_vote_needed:${pollId}`,
  pollResult: (pollId: string) => `poll_result:${pollId}`,
  eveningPreview: (tripId: string, date: string) => `evening_preview:${tripId}:${date}`,
  /** One per occurrence: a time change or a snooze is a new occurrence, a retry of the same one is not. */
  reminder: (reminderId: string, occurrence: number) => `reminder:${reminderId}:${occurrence}`,
} as const;

/** The metadata stored with a draft: ids and a day, nothing descriptive. */
export function draftParts(draft: NotificationDraft): {
  tripId: string;
  resourceType: ResourceType;
  resourceId: string | null;
  metadata: Record<string, string>;
} {
  switch (draft.type) {
    case "invitation_received":
    case "invitation_accepted":
      return { tripId: draft.tripId, resourceType: "invitation", resourceId: draft.invitationId, metadata: {} };
    case "itinerary_changed":
      return {
        tripId: draft.tripId,
        resourceType: "itinerary_item",
        resourceId: draft.itemId,
        metadata: draft.date ? { date: draft.date } : {},
      };
    case "poll_vote_needed":
    case "poll_result":
      return { tripId: draft.tripId, resourceType: "poll", resourceId: draft.pollId, metadata: {} };
    case "evening_preview":
      return {
        tripId: draft.tripId,
        resourceType: "trip_day",
        resourceId: null,
        metadata: draft.pollId ? { date: draft.date, poll: draft.pollId } : { date: draft.date },
      };
    case "reminder":
      return {
        tripId: draft.tripId,
        resourceType: "reminder",
        resourceId: draft.reminderId,
        metadata: { occ: String(draft.occurrence), s: draft.subject, sid: draft.subjectId },
      };
  }
}

/* ---------------------------- what the browser gets ---------------------------- */

export type NotificationItem = {
  id: string;
  type: NotificationType;
  label: string;
  created_at: string;
  read_at: string | null;
  /** false = access was lost or the invitation closed: title/body are replaced and there is no link. */
  available: boolean;
  title: string;
  body: string;
  trip: { id: string; title: string } | null;
  /** A vetted in-app path, or null. Opening goes here; never a URL from the database. */
  href: string | null;
  /** Reminder items only: what it is about and, from live data, what the person may do now. */
  reminder?: ReminderItemInfo;
};

/**
 * A reminder in the inbox. `state` is the history of that delivered item
 * ("Updated" = the record changed after it was sent); `live` is re-derived from
 * current data when the inbox is read, so an old item never offers an action
 * the person can no longer take.
 */
export type ReminderItemInfo = {
  subject: "booking" | "task";
  subjectId: string;
  reminderId: string;
  occurrence: number;
  state: "updated" | "canceled" | "completed" | "snoozed" | null;
  live: {
    canComplete: boolean;
    taskDone: boolean;
    canSnooze: boolean;
    snoozeOptions: { id: string; label: string; atMs: number }[];
    directionsUrl: string | null;
    zoneName: string;
    zone: string;
    limitAtMs: number | null;
    superseded: boolean;
  } | null;
};

const REMINDER_STATES = ["updated", "canceled", "completed", "snoozed"] as const;

/** The reminder facts stored with an item (ids and a state label — validated, never trusted blindly). */
export function reminderInfoFrom(row: { type: string; resource_id: string | null; metadata: Record<string, unknown> | null }): ReminderItemInfo | undefined {
  if (row.type !== "reminder" || !row.resource_id) return undefined;
  const m = row.metadata ?? {};
  const subject = m.s === "booking" || m.s === "task" ? m.s : null;
  const sid = typeof m.sid === "string" && UUID_ONLY.test(m.sid) ? m.sid : null;
  if (!subject || !sid) return undefined;
  const occurrence = Number(m.occ);
  const state = (REMINDER_STATES as readonly unknown[]).includes(m.state) ? (m.state as ReminderItemInfo["state"]) : null;
  return { subject, subjectId: sid, reminderId: row.resource_id, occurrence: Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1, state, live: null };
}

export type NotificationPage = {
  items: NotificationItem[];
  /** Pass back to load older items; null = that was the last page. */
  nextCursor: string | null;
  unread: number;
};

export type NotificationFilter = "all" | "unread";
export const NOTIFICATION_PAGE_SIZE = 20;
export const MAX_UNREAD_SHOWN = 99;

export const UNAVAILABLE_COPY = {
  title: "No longer available",
  trip: "You no longer have access to this trip, so this update is hidden.",
  invitation: "This invitation was withdrawn, has expired, or isn’t open to this account anymore.",
} as const;

export function unavailableBody(type: NotificationType) {
  return NOTIFICATION_KINDS[type].scope === "invitation" ? UNAVAILABLE_COPY.invitation : UNAVAILABLE_COPY.trip;
}

/* --------------------------- safe destinations --------------------------- */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TRIP_TABS = "(?:/(?:itinerary|bookings|explore|packing|memories))?";
const REMINDER_PAGE = `/trips/${UUID}/(?:bookings\\?booking|packing\\?task)=${UUID}`;
const POLL_PAGE = `/trips/${UUID}/polls(?:\\?poll=${UUID})?`;
const SAFE_DESTINATION = new RegExp(
  `^(?:/trips/${UUID}${TRIP_TABS}(?:\\?day=\\d{4}-\\d{2}-\\d{2})?|${POLL_PAGE}|${REMINDER_PAGE}|/invitations/${UUID}|/notifications)$`,
  "i",
);

/**
 * A destination is only ever an in-app path from this short allow-list:
 * a trip (optionally one tab and one day), an invitation page, or the inbox.
 * Anything else — absolute URLs, `//host`, backslashes, other routes — fails.
 */
export function isSafeInternalPath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 200 && SAFE_DESTINATION.test(path);
}

/** The vetted destination for a notification, or null (then it is shown without a link). */
export function resolveDestination(type: string, ctx: DestinationContext): string | null {
  const kind = kindOf(type);
  if (!kind || !kind.enabled) return null;
  const path = kind.destination(ctx);
  return isSafeInternalPath(path) ? path : null;
}

/* ------------------------------ text hygiene ------------------------------ */

/**
 * Notification text is user-visible in a list that is easy to glance at over
 * someone's shoulder and lives in the database for a while, so it is kept
 * short and plain: one line, no URLs, no token-like strings. (Callers also
 * never pass notes, addresses, booking references or documents in.)
 */
export function cleanText(raw: string, max: number): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/https?:\/\/\S+/gi, "a link")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "…")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export const personName = (name: string | null | undefined) => cleanText(name ?? "", 60) || "Someone";

/* --------------------------- itinerary change text --------------------------- */

export type ItinerarySnapshot = {
  id: string;
  /** The title the traveler sees: the item's own, else its place, else "An activity". */
  title: string;
  date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  /** IANA zone the wall-clock values are in (the trip's zone when not set). */
  time_zone: string;
  place_id: string | null;
  /** The place's name only — never its address or links. */
  place_name: string | null;
  /** Booking-backed rows follow their booking and are never announced here. */
  reservation_backed: boolean;
};

type Moment = { date: string; time: string | null };

/** The stored wall-clock moment, shown in the trip's zone (converted only when the entry is in another zone). */
export function inTripZone(date: string, time: string | null, zone: string, tripZone: string): Moment {
  if (!time || zone === tripZone || !isValidTimeZone(zone) || !isValidTimeZone(tripZone)) return { date, time };
  const instant = zonedInstant(date, time, zone);
  if (instant === null) return { date, time };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tripZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

const startMoment = (s: ItinerarySnapshot, tripZone: string) => inTripZone(s.date, s.start_time, s.time_zone, tripZone);
const endMoment = (s: ItinerarySnapshot, tripZone: string): Moment | null =>
  s.end_time ? inTripZone(s.end_date ?? s.date, s.end_time, s.time_zone, tripZone) : null;

const dayAndTime = (m: Moment) => (m.time ? `${formatShortDay(m.date)} at ${formatTime(m.time)}` : formatShortDay(m.date));

/** "Dinner moved from 6:00 PM to 6:30 PM." (null when the schedule is unchanged). */
function scheduleSentence(before: ItinerarySnapshot, after: ItinerarySnapshot, tripZone: string): string | null {
  const b = startMoment(before, tripZone);
  const a = startMoment(after, tripZone);
  const title = after.title;
  if (b.date !== a.date) return `${title} moved from ${dayAndTime(b)} to ${dayAndTime(a)}.`;
  if (b.time !== a.time) {
    if (b.time && a.time) return `${title} moved from ${formatTime(b.time)} to ${formatTime(a.time)}.`;
    if (a.time) return `${title} now starts at ${formatTime(a.time)}.`;
    return `${title} no longer has a set start time.`;
  }
  const be = endMoment(before, tripZone);
  const ae = endMoment(after, tripZone);
  const endText = (m: Moment | null) => (m?.time ? `${m.date}|${m.time}` : "");
  if (endText(be) !== endText(ae)) {
    if (ae?.time) {
      return `${title} now ends ${ae.date !== a.date ? `${formatShortDay(ae.date)} ` : ""}at ${formatTime(ae.time)}.`;
    }
    return `${title} no longer has an end time.`;
  }
  return null;
}

/** "Dinner location changed from A to B." — place names only. */
function locationSentence(before: ItinerarySnapshot, after: ItinerarySnapshot): string | null {
  if (before.place_id === after.place_id) return null;
  if (before.place_name && after.place_name) {
    return `${after.title} location changed from ${before.place_name} to ${after.place_name}.`;
  }
  if (after.place_name) return `${after.title} now has a location: ${after.place_name}.`;
  if (before.place_name) return `${after.title} location removed (was ${before.place_name}).`;
  return null;
}

export type ItineraryChangeText = { title: string; body: string; date: string };

/**
 * The notification text for one itinerary write, or null when nothing the
 * group cares about changed (a note edit, a rename, a status tick, …) or the
 * entry is a booking's row.
 */
export function describeItineraryChange(
  kind: "added" | "removed" | "changed",
  before: ItinerarySnapshot | null,
  after: ItinerarySnapshot | null,
  tripZone: string,
  actorName: string,
): ItineraryChangeText | null {
  const who = personName(actorName);
  const subject = kind === "removed" ? before : after;
  if (!subject || subject.reservation_backed) return null;
  const t = cleanText(subject.title, 80) || "An activity";
  const snap = (s: ItinerarySnapshot) => ({ ...s, title: t, place_name: s.place_name ? cleanText(s.place_name, 60) : null });

  if (kind === "added" && after) {
    const m = startMoment(after, tripZone);
    return { title: "Activity added", body: cleanText(`${who} added ${t} for ${dayAndTime(m)}.`, 400), date: m.date };
  }
  if (kind === "removed" && before) {
    const m = startMoment(before, tripZone);
    return { title: "Activity removed", body: cleanText(`${who} removed ${t} (${dayAndTime(m)}).`, 400), date: m.date };
  }
  if (kind === "changed" && before && after) {
    const b = snap(before);
    const a = snap(after);
    const sentences = [scheduleSentence(b, a, tripZone), locationSentence(b, a)].filter((s): s is string => Boolean(s));
    if (sentences.length === 0) return null;
    return {
      title: "Itinerary updated",
      body: cleanText(`${sentences.join(" ")} — ${who}`, 400),
      date: startMoment(a, tripZone).date,
    };
  }
  return null;
}

/* ------------------------------ grouping ------------------------------ */

export type DayGroup = "Today" | "Yesterday" | "Earlier";

function calendarDay(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function previousDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The viewer's zone, or a sensible fallback (their browser's, then UTC) when none is configured / valid. */
export function effectiveTimeZone(configured: string | null | undefined, browser?: string | null) {
  for (const tz of [configured, browser]) if (tz && isValidTimeZone(tz)) return tz;
  return "UTC";
}

export function dayGroupOf(createdAt: string, now: Date, timeZone: string): DayGroup {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "Earlier";
  const today = calendarDay(now, timeZone);
  const day = calendarDay(created, timeZone);
  if (day === today) return "Today";
  if (day === previousDay(today)) return "Yesterday";
  return "Earlier";
}

export function groupByDay<T extends { created_at: string }>(items: T[], now: Date, timeZone: string) {
  const groups: { label: DayGroup; items: T[] }[] = [];
  for (const item of items) {
    const label = dayGroupOf(item.created_at, now, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** "3:42 PM" today / yesterday, "Oct 3" earlier — in the viewer's zone. */
export function timeLabel(createdAt: string, now: Date, timeZone: string) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const group = dayGroupOf(createdAt, now, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(group === "Earlier" ? { month: "short", day: "numeric" } : { hour: "numeric", minute: "2-digit" }),
  }).format(created);
}

export function unreadBadge(count: number) {
  return count > MAX_UNREAD_SHOWN ? `${MAX_UNREAD_SHOWN}+` : String(count);
}

/* ------------------------------ cursors ------------------------------ */

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const UUID_RE = new RegExp(`^${UUID}$`, "i");

export const isTimestamp = (value: unknown): value is string => typeof value === "string" && TIMESTAMP.test(value);

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);
