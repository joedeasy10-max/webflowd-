import { z } from "zod";
import { isoDate, timeOfDay, weekday } from "./common.js";

/** One weekly opening rule. When `closed`, open/close are ignored. */
export const businessHourSchema = z
  .object({
    weekday,
    closed: z.boolean().default(false),
    open: timeOfDay.optional(),
    close: timeOfDay.optional(),
  })
  .strict()
  .refine((h) => h.closed || (!!h.open && !!h.close), {
    message: "open and close are required unless closed is true",
    path: ["open"],
  })
  .refine((h) => h.closed || h.open! < h.close!, {
    message: "open must be before close",
    path: ["close"],
  });

/** Full weekly schedule: exactly one entry per weekday (0–6). */
export const businessHoursSchema = z
  .array(businessHourSchema)
  .max(7)
  .refine((rows) => new Set(rows.map((r) => r.weekday)).size === rows.length, {
    message: "Duplicate weekday entries",
  });

/** A one-off override for a specific date (bank holiday, special hours). */
export const hoursExceptionSchema = z
  .object({
    date: isoDate,
    closed: z.boolean().default(true),
    open: timeOfDay.optional(),
    close: timeOfDay.optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((h) => h.closed || (!!h.open && !!h.close), {
    message: "open and close are required unless closed is true",
    path: ["open"],
  })
  .refine((h) => h.closed || h.open! < h.close!, {
    message: "open must be before close",
    path: ["close"],
  });

export type BusinessHourInput = z.infer<typeof businessHourSchema>;
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;
export type HoursExceptionInput = z.infer<typeof hoursExceptionSchema>;
