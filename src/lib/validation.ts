import { z } from "zod";
import { BOOKING_KINDS } from "@/lib/types";
import { COVER_KEYS } from "@/lib/covers";

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
  .union([z.literal(""), z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Enter a valid time.")])
  .transform((v) => v || null);

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(2048, `${label} is too long.`)
    .pipe(z.url({ protocol: /^https$/, error: `${label} must be a full https:// link.` }));

export const tripSchema = z
  .object({
    title: requiredText("Trip name", 120),
    destination: requiredText("Destination", 120),
    start_date: z.iso.date({ error: "Choose a start date." }),
    end_date: z.iso.date({ error: "Choose an end date." }),
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

export const bookingSchema = z
  .object({
    trip_id: z.uuid(),
    kind: z.enum(BOOKING_KINDS, { error: "Choose a booking type." }),
    title: requiredText("Name", 160),
    provider: optionalText("Provider", 120),
    confirmation_code: optionalText("Confirmation number", 80),
    start_date: optionalDate,
    start_time: optionalTime,
    end_date: optionalDate,
    end_time: optionalTime,
    origin: optionalText("From", 120),
    destination: optionalText("To", 120),
    location: optionalText("Location", 240),
    booking_url: z
      .union([z.literal(""), httpsUrl("Booking link")])
      .transform((v) => v || null),
    notes: optionalText("Notes", 5000),
  })
  .superRefine((b, ctx) => {
    if (b.start_time && !b.start_date) {
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "Add a date for this time." });
    }
    if (b.end_time && !b.end_date) {
      ctx.addIssue({ code: "custom", path: ["end_date"], message: "Add a date for this time." });
    }
    if (b.start_date && b.end_date && b.end_date < b.start_date) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "This can’t be before the start date.",
      });
    }
  });

export const documentSchema = z.object({
  trip_id: z.uuid(),
  booking_id: z
    .union([z.literal(""), z.uuid()])
    .transform((v) => v || null),
  label: requiredText("Name", 120),
  url: httpsUrl("Link"),
});

export const idSchema = z.uuid();

/** Read named string fields from FormData ("" when missing). */
export function formFields<K extends string>(formData: FormData, keys: readonly K[]) {
  return Object.fromEntries(
    keys.map((k) => {
      const v = formData.get(k);
      return [k, typeof v === "string" ? v : ""];
    }),
  ) as Record<K, string>;
}
