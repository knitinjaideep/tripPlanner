import { z } from "zod";
import { RESERVATION_KINDS, RESERVATION_STATUSES, type ReservationKind } from "@/lib/types";
import { COVER_KEYS } from "@/lib/cover-keys";
import { DETAIL_FIELDS } from "@/lib/reservation-details";
import { isValidTimeZone } from "@/lib/time-zones";
import { STARTER_KEYS } from "@/lib/packing";
import {
  ITINERARY_CATEGORIES,
  ITINERARY_STATUSES,
  PLACE_KINDS,
  PLACE_PRIORITIES,
  WOULD_RETURN,
  isPlaceCategory,
  type PlaceCategory,
} from "@/lib/plan-options";

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/** Optional text input: blank becomes null. */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => v || null);

const optionalDate = z
  .union([z.literal(""), z.iso.date({ error: "Enter a valid date." })])
  .transform((v) => v || null);

const optionalTime = z
  .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a valid time.")])
  .transform((v) => v || null);

const timeZone = (message: string) =>
  z.string().trim().refine(isValidTimeZone, { message });

const optionalTimeZone = z
  .union([z.literal(""), timeZone("Choose a valid time zone.")])
  .transform((v) => v || null);

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(2048, `${label} is too long.`)
    .pipe(z.url({ protocol: /^https$/, hostname: z.regexes.domain, error: `${label} must be a full https:// link.` }))
    // No embedded credentials (https://user:pass@host) — never needed, often a phishing trick.
    // Zod still runs this after a failed url check, so unparseable input must not throw.
    .refine((v) => {
      if (!URL.canParse(v)) return true;
      const url = new URL(v);
      return !url.username && !url.password;
    }, `${label} can’t include a username or password.`);

export const tripSchema = z
  .object({
    title: requiredText("Trip name", 120),
    destination: requiredText("Destination", 120),
    start_date: z.iso.date({ error: "Choose a start date." }),
    end_date: z.iso.date({ error: "Choose an end date." }),
    time_zone: timeZone("Choose the destination’s time zone."),
    travelers: z
      .string()
      .max(800)
      .transform((v) =>
        v
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(z.string().max(40, "Each traveler name must be 40 characters or fewer."))
          .max(20, "Add up to 20 travelers."),
      ),
    cover_image: z.enum(COVER_KEYS, { error: "Choose a cover photo." }),
    notes: optionalText("Notes", 5000),
  })
  .refine((t) => t.end_date >= t.start_date, {
    path: ["end_date"],
    message: "End date can’t be before the start date.",
  });

/** Per-kind schema for `details` — unknown keys are dropped. */
function detailsSchema(kind: ReservationKind) {
  const shape: Record<string, z.ZodType<string | number | null>> = {};
  for (const field of DETAIL_FIELDS[kind]) {
    shape[field.key] = field.numeric
      ? z
          .string()
          .trim()
          .regex(/^\d*$/, `${field.label} must be a whole number.`)
          .transform((v) => (v ? Number(v) : null))
          .refine((n) => n === null || (n >= field.numeric!.min && n <= field.numeric!.max), {
            message: `${field.label} must be between ${field.numeric.min} and ${field.numeric.max}.`,
          })
      : optionalText(field.label, field.max);
  }
  return z
    .object(shape)
    .transform((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== "")));
}

export const reservationSchema = z
  .object({
    kind: z.enum(RESERVATION_KINDS, { error: "Choose a booking type." }),
    status: z.enum(RESERVATION_STATUSES, { error: "Choose a status." }),
    title: requiredText("Name", 160),
    provider: optionalText("Provider", 120),
    // Always a string: codes can start with zeros and mix letters/digits.
    confirmation_code: optionalText("Confirmation number", 80),
    start_date: optionalDate,
    start_time: optionalTime,
    start_time_zone: optionalTimeZone,
    end_date: optionalDate,
    end_time: optionalTime,
    end_time_zone: optionalTimeZone,
    origin: optionalText("From", 120),
    destination: optionalText("To", 120),
    location: optionalText("Location", 240),
    booking_url: z
      .union([z.literal(""), httpsUrl("Booking link")])
      .transform((v) => v || null),
    notes: optionalText("Notes", 5000),
    details: z.record(z.string(), z.string()),
  })
  .superRefine((b, ctx) => {
    if (b.start_time && !b.start_date) {
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "Add a date for this time." });
    }
    if (b.end_time && !b.end_date) {
      ctx.addIssue({ code: "custom", path: ["end_date"], message: "Add a date for this time." });
    }
    if (b.start_time && !b.start_time_zone) {
      ctx.addIssue({ code: "custom", path: ["start_time_zone"], message: "Choose the local time zone." });
    }
    if (b.end_time && !b.end_time_zone) {
      ctx.addIssue({ code: "custom", path: ["end_time_zone"], message: "Choose the local time zone." });
    }
    if (b.start_date && b.end_date && b.end_date < b.start_date) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "This can’t be before the start date.",
      });
    }
  })
  .transform((b, ctx) => {
    const parsed = detailsSchema(b.kind).safeParse(b.details);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", path: [`details.${String(issue.path[0])}`], message: issue.message });
      }
      return z.NEVER;
    }
    return { ...b, details: parsed.data };
  });

export const documentSchema = z.object({
  reservation_id: z
    .union([z.literal(""), z.uuid({ error: "Choose a booking from this trip." })])
    .transform((v) => v || null),
  label: requiredText("Name", 120),
  url: httpsUrl("Link"),
});

export const idSchema = z.uuid();

/* ------------------ Explore, Itinerary, Packing, Memories ------------------ */

const optionalId = (message: string) =>
  z.union([z.literal(""), z.uuid({ error: message })]).transform((v) => v || null);

const optionalHttpsUrl = (label: string) =>
  z.union([z.literal(""), httpsUrl(label)]).transform((v) => v || null);

/** "" → null, otherwise a whole number 1–5. */
const optionalRating = z
  .union([z.literal(""), z.string().regex(/^[1-5]$/, "Choose 1 to 5 stars.")])
  .transform((v) => (v ? Number(v) : null));

/** HTML checkbox: present ("on") → true, missing ("") → false. */
const checkbox = z.string().transform((v) => v === "on" || v === "true");

/** "08:20" and "08:20:00" compare equal. */
const timeKey = (t: string) => (t.length === 5 ? `${t}:00` : t);

/** Only name and kind are required; category defaults to "Other", priority to "Maybe". */
export const placeSchema = z
  .object({
    name: requiredText("Name", 160),
    kind: z.enum(PLACE_KINDS, { error: "Choose place or food." }),
    category: z
      .string()
      .trim()
      .transform((v) => v || "other"),
    priority: z
      .union([z.literal(""), z.enum(PLACE_PRIORITIES, { error: "Choose must do or maybe." })])
      .transform((v) => v || "maybe"),
    address: optionalText("Address", 240),
    maps_url: optionalHttpsUrl("Map link"),
    website_url: optionalHttpsUrl("Website"),
    planning_notes: optionalText("Notes", 5000),
  })
  .superRefine((p, ctx) => {
    if (!isPlaceCategory(p.kind, p.category)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "Choose a category." });
    }
  })
  .transform((p) => ({ ...p, category: p.category as PlaceCategory }));

/**
 * A visit or standalone activity. Reservation-backed visits never carry
 * their own schedule (the booking is authoritative), so those fields are
 * dropped. A blank zone on a standalone visit means "the trip's zone".
 */
export const itineraryItemSchema = z
  .object({
    place_id: optionalId("Choose a place from this trip."),
    reservation_id: optionalId("Choose a booking from this trip."),
    title: optionalText("Title", 160),
    category: z.enum(ITINERARY_CATEGORIES, { error: "Choose a category." }),
    local_date: optionalDate,
    local_start_time: optionalTime,
    local_end_date: optionalDate,
    local_end_time: optionalTime,
    timezone: optionalTimeZone,
    planning_notes: optionalText("Notes", 5000),
    // Missing (older callers) reads as unchecked.
    is_optional: checkbox.optional().transform((v) => v === true),
    is_protected_rest: checkbox.optional().transform((v) => v === true),
  })
  .transform((v) => {
    if (v.reservation_id) {
      return {
        ...v,
        local_date: null,
        local_start_time: null,
        local_end_date: null,
        local_end_time: null,
        timezone: null,
        is_optional: false,
        is_protected_rest: false,
      };
    }
    // Keep one representation of "ends the same day": no end date.
    return v.local_end_date === v.local_date ? { ...v, local_end_date: null } : v;
  })
  .superRefine((v, ctx) => {
    if (!v.title && !v.place_id && !v.reservation_id) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "Give this activity a name." });
    }
    if (v.reservation_id) return;
    if (!v.local_date) {
      ctx.addIssue({ code: "custom", path: ["local_date"], message: "Choose a day." });
      return;
    }
    if (v.local_end_date && v.local_end_date < v.local_date) {
      ctx.addIssue({ code: "custom", path: ["local_end_date"], message: "This can’t be before the start date." });
    }
    if (v.local_end_time && !v.local_end_date) {
      if (!v.local_start_time) {
        ctx.addIssue({ code: "custom", path: ["local_start_time"], message: "Add a start time for this end time." });
      } else if (timeKey(v.local_end_time) <= timeKey(v.local_start_time)) {
        ctx.addIssue({
          code: "custom",
          path: ["local_end_date"],
          message: "Ends before it starts — add the end date if it runs overnight.",
        });
      }
    }
  });

export const visitReviewSchema = z.object({
  status: z.enum(ITINERARY_STATUSES, { error: "Choose a status." }),
  rating: optionalRating,
  reflection: optionalText("Reflection", 5000),
  is_favorite: checkbox,
});

/** A form-generated UUID that makes a create idempotent; blank = none. */
export const requestIdSchema = z
  .union([z.literal(""), z.uuid()])
  .transform((v) => v || undefined);

/** "Record a visit" from Explore. visit_choice: "" (let the server check), "new", or a planned visit's id. */
export const recordVisitSchema = z.object({
  date: z.iso.date({ error: "Choose the day you went." }),
  rating: optionalRating,
  reflection: optionalText("Reflection", 5000),
  is_favorite: checkbox,
  visit_choice: z.union([z.literal(""), z.literal("new"), z.uuid({ error: "Choose a visit." })]),
});

/** The optional reflection panel: status is changed separately. */
export const reflectionSchema = visitReviewSchema.omit({ status: true });

export const itineraryStatusSchema = z.enum(ITINERARY_STATUSES);

export const itineraryDateSchema = z.iso.date({ error: "Choose a day." });

/** A day's flexible entries in their new order: `i:<itemId>` or `r:<bookingId>`. */
export const itineraryOrderSchema = z
  .array(z.string().regex(/^[ir]:[0-9a-f-]{36}$/i))
  .min(1)
  .max(200)
  .transform((keys) =>
    keys.map((k) => ({ type: k.startsWith("i:") ? ("item" as const) : ("reservation" as const), id: k.slice(2) })),
  );

export const packingCategorySchema = z.object({ name: requiredText("Category name", 60) });

export const packingItemSchema = z.object({
  category_id: z.uuid({ error: "Choose a category." }),
  label: requiredText("Item", 120),
  quantity: z
    .string()
    .trim()
    .regex(/^\d*$/, "Quantity must be a whole number.")
    .transform((v) => (v ? Number(v) : 1))
    .refine((n) => n >= 1 && n <= 999, { message: "Quantity must be between 1 and 999." }),
  traveler_name: optionalText("Traveler", 40),
  notes: optionalText("Notes", 1000),
});

/** What to do with a packing category's items when deleting it. */
export const deletePackingCategorySchema = z.discriminatedUnion("items", [
  z.object({ items: z.literal("none") }),
  z.object({ items: z.literal("delete") }),
  z.object({ items: z.literal("move"), target_category_id: z.uuid({ error: "Choose where to move the items." }) }),
]);

/** A full new order of packing categories, or of one category's items. */
export const packingOrderSchema = z.array(z.uuid()).min(1).max(500);

/** Starter categories to copy into the trip. */
export const packingStarterSchema = z
  .array(z.enum(STARTER_KEYS), { error: "Choose at least one category." })
  .min(1, "Choose at least one category.");

/** Copy from another trip: all of its categories, or the chosen ones. */
export const packingCopySchema = z.object({
  source_trip_id: z.uuid({ error: "Choose a trip to copy from." }),
  categories: z.union([z.literal("all"), z.array(z.uuid()).min(1, "Choose at least one category.").max(200)]),
});

/** Deleting an Explore place that has visits: refuse, or keep the visits without it. */
/** "Your notes" on an Explore place; blank clears them. */
export const placeNotesSchema = z.object({ planning_notes: optionalText("Notes", 5000) });

export const placeFavoriteSchema = z.boolean();

export const collectionIdSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);

export const deletePlaceSchema = z.object({ visits: z.enum(["block", "detach"]) });

/** The trip's reflection (everything except the album link, which is saved on its own). */
export const tripSummarySchema = z.object({
  overall_rating: optionalRating,
  summary: optionalText("Summary", 5000),
  favorite_moment: optionalText("Favorite moment", 2000),
  // "" = not answered (null); "undecided" is a real answer, distinct from "no".
  would_return: z
    .union([z.literal(""), z.enum(WOULD_RETURN, { error: "Choose yes, no, or undecided." })])
    .transform((v) => v || null),
  lessons_for_next_time: optionalText("Lessons", 5000),
});

/** A link to an album kept elsewhere (Google Photos, Drive…). "" removes it. */
export const tripAlbumSchema = z.object({ photo_album_url: optionalHttpsUrl("Photo album link") });

export const tripMemorySchema = tripSummarySchema.extend(tripAlbumSchema.shape);

/**
 * "Capture a moment" — something already done that isn't on the itinerary.
 * Saved as a completed standalone activity (the shared itinerary model).
 */
export const captureMomentSchema = z.object({
  title: requiredText("What you did", 160),
  category: z.enum(ITINERARY_CATEGORIES, { error: "Choose a category." }),
  local_date: z.iso.date({ error: "Choose the day." }),
  rating: optionalRating,
  reflection: optionalText("Reflection", 5000),
  is_favorite: checkbox,
});

/** Applying a previewed itinerary plan: the preview's token and a choice per conflict. */
export const planApplySchema = z.object({
  plan_id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  token: z.string().regex(/^[0-9a-f]{16}$/),
  choices: z
    .record(z.string().max(160), z.enum(["keep", "plan"]))
    .refine((c) => Object.keys(c).length <= 300),
  set_trip_time_zone: z.boolean(),
});

/** Read named string fields from FormData ("" when missing). */
export function formFields<K extends string>(formData: FormData, keys: readonly K[]) {
  return Object.fromEntries(
    keys.map((k) => {
      const v = formData.get(k);
      return [k, typeof v === "string" ? v : ""];
    }),
  ) as Record<K, string>;
}

/** Collect `details.<key>` inputs into a plain object of strings. */
export function detailFields(formData: FormData) {
  const details: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("details.") && typeof value === "string") {
      details[name.slice("details.".length)] = value;
    }
  }
  return details;
}
