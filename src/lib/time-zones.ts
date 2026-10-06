import { TIME_ZONES } from "./time-zone-list";

/** IANA time zone helpers, shared by server validation and client forms. */

export function isValidTimeZone(tz: string) {
  if (!tz || tz.length > 64) return false;
  if (tz !== "UTC" && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Zones for pickers — a static list so server and browser render the same options. */
export function timeZoneOptions() {
  return TIME_ZONES;
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires (America/Argentina)" */
export function timeZoneLabel(tz: string) {
  if (!tz.includes("/")) return tz;
  const parts = tz.split("/");
  const city = parts.pop()!.replace(/_/g, " ");
  return `${city} (${parts.join("/").replace(/_/g, " ")})`;
}

function offsetMinutes(timeZone: string, instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The real instant (ms since epoch) of a local wall-clock moment in a zone.
 * Used only to *order* and compare stored times across zones — the stored
 * values themselves are never shifted. Without a valid zone the wall clock
 * is read as UTC, so same-zone comparisons still work.
 */
export function zonedInstant(date: string, time: string | null, timeZone: string | null) {
  const [h = "12", m = "00"] = (time ?? "12:00").split(":");
  const wallAsUtc = Date.parse(`${date}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00Z`);
  if (Number.isNaN(wallAsUtc)) return null;
  if (!timeZone || !isValidTimeZone(timeZone)) return wallAsUtc;
  // Two passes find the real instant for that wall-clock time in the zone.
  const first = offsetMinutes(timeZone, new Date(wallAsUtc));
  const second = offsetMinutes(timeZone, new Date(wallAsUtc - first * 60_000));
  return wallAsUtc - second * 60_000;
}

/**
 * Short zone name ("EDT", "GMT-4") in effect at a local wall-clock moment.
 * Used only to *label* stored times — the stored values are never shifted.
 */
export function zoneAbbreviation(date: string, time: string | null, timeZone: string) {
  if (!isValidTimeZone(timeZone)) return null;
  const instant = zonedInstant(date, time, timeZone);
  if (instant === null) return null;
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(instant))
      .find((p) => p.type === "timeZoneName")?.value ?? null
  );
}
