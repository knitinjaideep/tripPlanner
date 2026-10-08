/**
 * Personal Settings — the pure, client-safe half: the typed models, their
 * defaults, the catalogue of choices and the lenient parsers that turn
 * whatever is stored (missing, partial, unknown values) into safe values.
 * Nothing here touches the database; writes are validated by the Zod schemas
 * in src/lib/validation.ts and stored by src/db/settings.ts (reached only
 * through src/lib/dal.ts).
 */

/* ------------------------------ appearance ------------------------------ */

import { parseBackgroundId, type BackgroundId } from "@/lib/backgrounds";

export { BACKGROUND_IDS, BACKGROUND_REGISTRY, backgroundEntry, backgroundFiles, backgroundThumbUrl, backgroundUrl, type BackgroundId } from "@/lib/backgrounds";

export const INTENSITIES = ["subtle", "standard"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const MASCOT_MODES = ["show", "hide"] as const;
export type MascotMode = (typeof MASCOT_MODES)[number];

/** The one typed appearance model: saved, draft and effective appearance all share it. */
export type Appearance = {
  background: BackgroundId;
  intensity: Intensity;
  density: Density;
  mascot: MascotMode;
};

/** The default for someone with no saved choice: Explorer’s Map when its picture is available, else Plain Ivory. */
export function defaultAppearance(available: readonly BackgroundId[]): Appearance {
  return {
    background: available.includes("explorers-map") ? "explorers-map" : "plain-ivory",
    intensity: "subtle",
    density: "comfortable",
    mascot: "show",
  };
}

const pick = <T extends string>(allowed: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/** Stored appearance → a full, valid Appearance. Missing or unknown fields take the default. */
export function parseAppearance(raw: unknown, available: readonly BackgroundId[]): Appearance {
  const base = defaultAppearance(available);
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    background: parseBackgroundId(o.background) ?? base.background,
    intensity: pick(INTENSITIES, o.intensity) ?? base.intensity,
    density: pick(DENSITIES, o.density) ?? base.density,
    mascot: pick(MASCOT_MODES, o.mascot) ?? base.mascot,
  };
}

/** What the app shell actually paints: a background whose picture is missing falls back to Plain Ivory. */
export function effectiveAppearance(appearance: Appearance, available: readonly BackgroundId[]): Appearance {
  return available.includes(appearance.background) ? appearance : { ...appearance, background: "plain-ivory" };
}

export const sameAppearance = (a: Appearance, b: Appearance) =>
  a.background === b.background && a.intensity === b.intensity && a.density === b.density && a.mascot === b.mascot;

/* ----------------------------- notifications ----------------------------- */

/** One switch per kind of in-app notification that exists today. */
export const NOTIFICATION_GROUPS = [
  "invitations",
  "polls",
  "shared_changes",
  "evening_preview",
  "booking_reminders",
  "task_reminders",
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];
export type NotificationSettings = Record<NotificationGroup, boolean>;

export const NOTIFICATION_GROUP_INFO: Record<NotificationGroup, { label: string; description: string }> = {
  invitations: { label: "Invitations", description: "Someone invites you to a trip, or accepts your invitation." },
  polls: { label: "Polls and results", description: "A question to answer in “Ask the group”, and the decision once it is made." },
  shared_changes: { label: "Shared-plan changes", description: "Someone adds, moves or removes something in a trip you share." },
  evening_preview: { label: "Evening previews", description: "A look at tomorrow’s plan, for trips where you turned previews on." },
  booking_reminders: { label: "Confirmed-booking reminders", description: "Reminders you set up before a confirmed booking." },
  task_reminders: { label: "Assigned-task reminders", description: "Reminders you set up before a task assigned to you is due." },
};

export const defaultNotificationSettings = (): NotificationSettings => ({
  invitations: true,
  polls: true,
  shared_changes: true,
  evening_preview: true,
  booking_reminders: true,
  task_reminders: true,
});

export function parseNotificationSettings(raw: unknown): NotificationSettings {
  const base = defaultNotificationSettings();
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const group of NOTIFICATION_GROUPS) if (typeof o[group] === "boolean") base[group] = o[group];
  return base;
}

/** Which switch governs a notification being created (null = not governed by a switch). */
export function notificationGroupOf(draft: { type: string; subject?: string }): NotificationGroup | null {
  switch (draft.type) {
    case "invitation_received":
    case "invitation_accepted":
      return "invitations";
    case "poll_vote_needed":
    case "poll_result":
      return "polls";
    case "itinerary_changed":
      return "shared_changes";
    case "evening_preview":
      return "evening_preview";
    case "reminder":
      return draft.subject === "task" ? "task_reminders" : "booking_reminders";
    default:
      return null;
  }
}

/* --------------------------- travel preferences --------------------------- */

export const DIET_OPTIONS = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  halal: "Halal",
  kosher: "Kosher",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
} as const;
export type Diet = keyof typeof DIET_OPTIONS;
export const DIETS = Object.keys(DIET_OPTIONS) as Diet[];

export const INTEREST_OPTIONS = {
  beaches: "Beaches",
  food: "Food and dining",
  hiking: "Hiking and nature",
  wildlife: "Wildlife",
  culture: "Museums and culture",
  history: "History",
  wellness: "Spas and wellness",
  nightlife: "Nightlife",
  shopping: "Shopping",
  family: "Family activities",
  photography: "Photography",
  adventure: "Adventure sports",
} as const;
export type Interest = keyof typeof INTEREST_OPTIONS;
export const INTERESTS = Object.keys(INTEREST_OPTIONS) as Interest[];

export const PACES = ["relaxed", "balanced", "busy"] as const;
export type Pace = (typeof PACES)[number];
export const PACE_LABELS: Record<Pace, string> = { relaxed: "Relaxed", balanced: "Balanced", busy: "Busy" };

export const TRANSPORT_OPTIONS = {
  walking: "Walking",
  rental_car: "Rental car",
  rideshare: "Taxi or rideshare",
  public_transit: "Public transit",
  bike: "Bike",
  tours: "Guided tours",
} as const;
export type Transport = keyof typeof TRANSPORT_OPTIONS;
export const TRANSPORTS = Object.keys(TRANSPORT_OPTIONS) as Transport[];

export const DIET_NOTE_MAX = 140;

export type TravelPreferences = {
  diet: Diet | null;
  diet_note: string;
  interests: Interest[];
  pace: Pace | null;
  transport: Transport[];
};

export const defaultTravelPreferences = (): TravelPreferences => ({ diet: null, diet_note: "", interests: [], pace: null, transport: [] });

const pickMany = <T extends string>(allowed: readonly T[], value: unknown): T[] =>
  Array.isArray(value) ? allowed.filter((a) => value.includes(a)) : [];

export function parseTravelPreferences(raw: unknown): TravelPreferences {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    diet: pick(DIETS, o.diet),
    diet_note: typeof o.diet_note === "string" ? o.diet_note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, DIET_NOTE_MAX) : "",
    interests: pickMany(INTERESTS, o.interests),
    pace: pick(PACES, o.pace),
    transport: pickMany(TRANSPORTS, o.transport),
  };
}

/* --------------------------- display preferences --------------------------- */

export const CLOCKS = ["12h", "24h"] as const;
export type Clock = (typeof CLOCKS)[number];
export const DISTANCE_UNITS = ["mi", "km"] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

/** Currencies offered as the default for new manual amounts. */
export const CURRENCIES = {
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
  CAD: "Canadian dollar",
  AUD: "Australian dollar",
  AWG: "Aruban florin",
  MXN: "Mexican peso",
  JPY: "Japanese yen",
  CHF: "Swiss franc",
  INR: "Indian rupee",
} as const;
export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export type DisplayPreferences = {
  clock: Clock;
  distance: DistanceUnit;
  currency: CurrencyCode;
};

export const defaultDisplayPreferences = (): DisplayPreferences => ({ clock: "12h", distance: "mi", currency: "USD" });

export function parseDisplayPreferences(raw: unknown): DisplayPreferences {
  const base = defaultDisplayPreferences();
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    clock: pick(CLOCKS, o.clock) ?? base.clock,
    distance: pick(DISTANCE_UNITS, o.distance) ?? base.distance,
    currency: pick(CURRENCY_CODES, o.currency) ?? base.currency,
  };
}

/* ------------------------------- account ------------------------------- */

export const DISPLAY_NAME_MAX = 80;

/** One of the person's own evening-preview schedules (read-only in Settings). */
export type EveningPreviewSchedule = { tripId: string; title: string; timeZone: string; sendTime: string };

/** Everything the Settings page needs to render, as the server read it. */
export type SettingsSnapshot = {
  appearance: Appearance;
  /** Whether the person has ever saved an appearance (false = showing the defaults). */
  appearanceSaved: boolean;
  /** Counts appearance saves (0 = never saved). A save must name the version it was based on, so a stale device cannot silently overwrite a newer choice. */
  appearanceVersion: number;
  notifications: NotificationSettings;
  /** The person's reminder switch from "Your reminder settings" is off, so reminder switches here have no effect until it is on. */
  remindersPausedElsewhere: boolean;
  travel: TravelPreferences;
  display: DisplayPreferences;
  /** The local name, or null when the Google name is used. */
  displayNameOverride: string | null;
};

/** Sections saved by plain merge. Appearance has its own versioned save (see saveAppearance). */
export type SettingsSection = "notifications" | "travel" | "display";
