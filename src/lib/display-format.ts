/**
 * Display preferences, applied to PRESENTATION only (Settings → Display).
 * These functions take stored values and return text. They never change what
 * is stored: wall-clock times stay "HH:MM" plus their IANA zone, distances
 * stay in the unit they were recorded in, amounts keep their own currency.
 */
import type { Clock, DistanceUnit } from "@/lib/settings";

/** "18:30" / "18:30:00" → "6:30 PM" (12h) or "18:30" (24h). Pure formatting: no zone, no UTC. */
export function formatClockTime(time: string, clock: Clock = "12h"): string {
  const [h, m] = time.split(":").map(Number);
  if (clock === "24h") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export const METERS_PER_MILE = 1609.344;

/**
 * A REAL measured distance (meters) in the chosen unit, e.g. "3.2 mi" / "5.1 km".
 * Only for numeric distances that exist as data — never derived from a travel
 * time, which would be a guess presented as a measurement.
 */
export function formatDistance(meters: number, unit: DistanceUnit = "mi"): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  const value = unit === "km" ? meters / 1000 : meters / METERS_PER_MILE;
  const digits = value < 10 ? 1 : 0;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${unit}`;
}

/**
 * An amount in ITS OWN currency. There is deliberately no conversion here and no
 * "display currency" argument: relabelling an amount as another currency would
 * be wrong. Unknown codes fall back to "12.50 XYZ".
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return nf.format(amountMinor / 10 ** (nf.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}
