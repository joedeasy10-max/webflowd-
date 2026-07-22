import { z } from "zod";

/** ISO `HH:mm` (24h) time-of-day, e.g. "08:30", "17:00". */
export const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm (24-hour)");

/** ISO calendar date `YYYY-MM-DD`. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

/**
 * Loose but sane phone validation. We accept UK national and E.164 forms and
 * normalise to E.164 elsewhere; here we only reject obvious junk so onboarding
 * stays forgiving.
 */
export const phone = z
  .string()
  .trim()
  .min(7, "Phone number looks too short")
  .max(20)
  .regex(/^[+()\d][\d\s()+-]{5,}$/, "Enter a valid phone number");

export const email = z.string().trim().toLowerCase().email();

/** Weekday index, 0 = Sunday … 6 = Saturday (matches JS getDay / Luxon weekday%7). */
export const weekday = z.number().int().min(0).max(6);

/** Non-empty, trimmed, length-bounded free text. */
export const shortText = z.string().trim().min(1).max(200);
export const mediumText = z.string().trim().max(2000);
export const longText = z.string().trim().max(20000);

/** UK service area: list of outward postcodes and/or a radius around a base. */
export const serviceArea = z
  .object({
    postcodes: z.array(z.string().trim().toUpperCase().max(8)).max(200).default([]),
    radiusMiles: z.number().min(0).max(300).optional(),
    basePostcode: z.string().trim().toUpperCase().max(8).optional(),
    notes: mediumText.optional(),
  })
  .strict();

export type ServiceArea = z.infer<typeof serviceArea>;
