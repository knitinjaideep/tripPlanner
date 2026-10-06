/**
 * Curated recommendations attached to Explore places (`places.recommendation`).
 * Pure types and helpers — no imports, so the Drizzle schema, the client and
 * the tests can all use them.
 *
 * Everything here is editorial planning content: drive times are estimates,
 * family notes are suggestions (not accessibility or infant-facility
 * guarantees), and prices are what a source published on the review date.
 */

export type MinuteRange = { min: number; max: number };

export const RECOMMENDATION_TYPES = ["attraction", "beach", "restaurant", "spa"] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_TIERS = ["top_pick", "must_do", "recommended", "optional"] as const;
export type RecommendationTier = (typeof RECOMMENDATION_TIERS)[number];

/** A price exactly as a source published it — never a live quote. Amounts in cents. */
export type PublishedPrice = {
  label: string;
  baseCents: number;
  currency: "USD";
  /** Listed service charge, percent (e.g. 15). */
  serviceChargePercent: number | null;
  /** Listed Sunday service charge, percent, when it differs. */
  sundayServiceChargePercent: number | null;
  caveat: string;
};

export type Recommendation = {
  /** Collection that wrote it, e.g. "aruba-2026-explore". */
  collection: string;
  type: RecommendationType;
  tier: RecommendationTier;
  summary: string;
  area: string;
  cuisine: string | null;
  /** One-way estimated drive from the stay, minutes. Not live routing. */
  driveMinutes: MinuteRange | null;
  /** Suggested time at the place, excluding travel. Null when it isn't a fixed-length visit (meals, spas). */
  visitMinutes: MinuteRange | null;
  /** Spas: suggested treatment length. */
  treatmentMinutes: number | null;
  /** Spas: suggested total time away from the stay, including the drive and check-in. */
  totalAwayMinutes: number | null;
  bestTime: string | null;
  tags: string[];
  /** Editorial family suggestions — not verified accessibility or infant facilities. */
  family: string[];
  /** Dishes worth asking about (subject to the current menu). */
  food: string[];
  vegetarian: string[];
  practical: string[];
  /** https links the content was drawn from. */
  sources: string[];
  /** Google Maps search text (name + "Aruba"); never the stay's address. */
  mapsQuery: string;
  /** When the content was researched (YYYY-MM-DD) — not proof every detail is current. */
  reviewedOn: string;
  /** "editorial": researched by the traveler, not independently verified by Atlas. */
  verification: "editorial";
  price: PublishedPrice | null;
  /** Shown when there is no published price, e.g. "Unknown — request a current quote." */
  priceNote: string | null;
  /** An adult solo-time option: one parent goes while the other stays with the baby. */
  soloParent: boolean;
  /** Spas: an editable "take turns" suggestion (never a reservation). */
  turns: TakeTurns | null;
};

/** A suggested solo-appointment rhythm, as local "HH:MM" times. */
export type TakeTurns = {
  text: string;
  steps: { at: string; until?: string; approx?: boolean; label: string }[];
  /** Prefill for "Add to itinerary": leave → back. */
  leave: string;
  back: string;
};

export const DRIVE_DISCLAIMER = "Estimated drive from your stay. Check Maps for current routing.";
export const FAMILY_DISCLAIMER =
  "Family notes are planning suggestions, not verified accessibility, safety or infant-facility information.";
export const CONFIRM_DIRECTLY = "Confirm directly";

/** Near stay: the estimated maximum one-way drive is 15 minutes or less. */
export const NEAR_STAY_MAX_DRIVE = 15;
/** Short outing: the suggested maximum visit (excluding travel) is 60 minutes or less. */
export const SHORT_OUTING_MAX_VISIT = 60;

type WithRecommendation = { recommendation?: unknown; category?: string };

/** The place's recommendation, or null (also for anything that doesn't look like one). */
export function recommendationOf(place: WithRecommendation): Recommendation | null {
  const r = place.recommendation as Partial<Recommendation> | null | undefined;
  if (!r || typeof r !== "object" || typeof r.collection !== "string" || typeof r.summary !== "string") return null;
  if (!Array.isArray(r.tags) || !Array.isArray(r.sources)) return null;
  return r as Recommendation;
}

export function isNearStay(rec: Recommendation | null) {
  return Boolean(rec?.driveMinutes && rec.driveMinutes.max <= NEAR_STAY_MAX_DRIVE);
}

export function isShortOuting(rec: Recommendation | null) {
  return Boolean(rec?.visitMinutes && rec.visitMinutes.max <= SHORT_OUTING_MAX_VISIT);
}

export function hasVegetarianOptions(rec: Recommendation | null) {
  return Boolean(rec?.tags.some((t) => /vegetarian|vegan/i.test(t)));
}

export function isParentSoloTime(rec: Recommendation | null) {
  return Boolean(rec?.soloParent);
}

/** Spa places: the curated type, or the traveler's own "Spa" category. */
export function isSpaPlace(place: WithRecommendation) {
  return place.category === "spa" || recommendationOf(place)?.type === "spa";
}

/** "5–10" or "60". */
export function formatRange(r: MinuteRange) {
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}

/** "est. 5–10 min drive". */
export function driveLabel(r: MinuteRange) {
  return `est. ${formatRange(r)} min drive`;
}

/** "1–2 h" style for longer spans, minutes otherwise. */
export function durationLabel(r: MinuteRange) {
  const fmt = (m: number) => (m >= 90 && m % 30 === 0 ? `${m / 60}`.replace(".5", "½") : `${m}`);
  if (r.min >= 90 && r.max >= 90 && r.min % 30 === 0 && r.max % 30 === 0) {
    return r.min === r.max ? `${fmt(r.min)} h` : `${fmt(r.min)}–${fmt(r.max)} h`;
  }
  return `${formatRange(r)} min`;
}

/** Round-trip driving estimate (both ways). */
export function roundTrip(r: MinuteRange): MinuteRange {
  return { min: r.min * 2, max: r.max * 2 };
}

/** A long drive deserves its own callout (e.g. Baby Beach). */
export function isLongDrive(rec: Recommendation | null) {
  return Boolean(rec?.driveMinutes && rec.driveMinutes.max >= 30);
}

export const TIER_LABELS: Record<RecommendationTier, string> = {
  top_pick: "Top pick",
  must_do: "Must do",
  recommended: "Recommended",
  optional: "Optional",
};

/** Itinerary category for a visit added from Explore (Beach → activity, as in the saved plan). */
export function itineraryCategoryFor(place: { kind: string }, rec: Recommendation | null) {
  if (place.kind === "food") return "food" as const;
  if (rec?.type === "beach" || rec?.type === "spa") return "activity" as const;
  return "sightseeing" as const;
}

/**
 * Minutes to suggest for the visit's end time: a spa's total time away
 * (it already includes the drive), else the upper end of the visit length.
 * Null for meals — their length is the traveler's call.
 */
export function suggestedMinutes(rec: Recommendation | null) {
  return rec?.totalAwayMinutes ?? rec?.visitMinutes?.max ?? null;
}

/** Short, editable visit note prefilled from a recommendation (≤ ~6 lines). */
export function itineraryNoteFor(rec: Recommendation, website: string | null) {
  const lines = ["Suggestion from Explore — not booked."];
  if (rec.totalAwayMinutes && rec.treatmentMinutes) {
    lines.push(`About ${rec.totalAwayMinutes} min away in total, including the drive and check-in; treatment about ${rec.treatmentMinutes} min.`);
  }
  if (rec.driveMinutes) lines.push(`Est. ${formatRange(rec.driveMinutes)} min drive each way from your stay — check Maps for current routing.`);
  if (isLongDrive(rec) && rec.driveMinutes) {
    lines.push(`About ${formatRange(roundTrip(rec.driveMinutes))} min of round-trip driving (est.), not included in the time there.`);
  }
  if (rec.soloParent && rec.family[0]) lines.push(rec.family[0]);
  lines.push(...[...rec.vegetarian, ...rec.practical].slice(0, 2));
  const source = website ?? rec.sources[0];
  if (source) lines.push(`Source: ${source}`);
  return lines.join("\n");
}

/* ------------------------------ prices ------------------------------ */

/** Integer-cent arithmetic, rounded half up to the cent. No floating-point totals. */
export function withServiceCharge(baseCents: number, percent: number) {
  return baseCents + Math.round((baseCents * percent) / 100);
}

export function formatCents(cents: number, currency = "USD") {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const whole = Math.trunc(cents / 100);
  const rest = String(Math.abs(cents % 100)).padStart(2, "0");
  return `${symbol}${whole.toLocaleString("en-US")}.${rest}`;
}

/**
 * Deterministic estimate from a published price: one treatment and two
 * separate treatments with the listed (non-Sunday) service charge. Other
 * charges are not included and the result is never a quote.
 */
export function priceEstimate(price: PublishedPrice) {
  const pct = price.serviceChargePercent ?? 0;
  const one = withServiceCharge(price.baseCents, pct);
  return {
    base: formatCents(price.baseCents, price.currency),
    perPerson: formatCents(one, price.currency),
    forTwo: formatCents(one * 2, price.currency),
    percent: pct,
    sundayPercent: price.sundayServiceChargePercent,
  };
}
