import { z } from "zod";

/** Tenant-wide rules that constrain how the AI may offer and make bookings. */
export const bookingRulesSchema = z
  .object({
    /** Minimum lead time before a slot can be booked. */
    minNoticeMin: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 30)
      .default(120),
    /** How far ahead customers may book. */
    maxAdvanceDays: z.number().int().min(1).max(365).default(60),
    /** Default gap applied around jobs when a service has no explicit buffer. */
    defaultBufferMin: z
      .number()
      .int()
      .min(0)
      .max(8 * 60)
      .default(0),
    /** Slot start granularity, in minutes (e.g. 15, 30, 60). */
    slotGranularityMin: z
      .number()
      .int()
      .refine((n) => [5, 10, 15, 20, 30, 60].includes(n), "Must be one of 5,10,15,20,30,60")
      .default(30),
    /** Cap on jobs per calendar day (0 = unlimited). */
    maxJobsPerDay: z.number().int().min(0).max(50).default(0),
    /** If false, bookings are created as `proposed` for owner approval. */
    autoConfirm: z.boolean().default(true),
  })
  .strict();

export type BookingRulesInput = z.infer<typeof bookingRulesSchema>;

export const bookingRulesUpdateSchema = bookingRulesSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
