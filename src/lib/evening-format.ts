import { formatTime } from "@/lib/dates";
import { zoneAbbreviation } from "@/lib/time-zones";

/** "7:02 PM AST" — a real moment shown on the wall clock of `timeZone`. */
export function formatDeadlineZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  const zone = zoneAbbreviation(date, time, timeZone);
  return `${formatTime(time)}${zone ? ` ${zone}` : ""}`;
}
