import { z } from "zod";
import { mediumText, shortText } from "./common.js";

/** A bookable service with duration/buffer defaults used by the booking engine. */
export const serviceSchema = z
  .object({
    name: shortText,
    description: mediumText.optional(),
    defaultDurationMin: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    bufferBeforeMin: z
      .number()
      .int()
      .min(0)
      .max(8 * 60)
      .default(0),
    bufferAfterMin: z
      .number()
      .int()
      .min(0)
      .max(8 * 60)
      .default(0),
    /** Free-text price note; the AI must not quote beyond this. */
    priceNote: shortText.optional(),
    depositRequired: z.boolean().default(false),
    /** Deposit amount in pence (GBP). Required when depositRequired is true. */
    depositAmountPence: z.number().int().min(0).max(1_000_000).optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((s) => !s.depositRequired || (s.depositAmountPence ?? 0) > 0, {
    message: "depositAmountPence is required when depositRequired is true",
    path: ["depositAmountPence"],
  });

export type ServiceInput = z.infer<typeof serviceSchema>;

export const serviceUpdateSchema = z
  .object({
    name: shortText.optional(),
    description: mediumText.optional(),
    defaultDurationMin: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
    bufferBeforeMin: z
      .number()
      .int()
      .min(0)
      .max(8 * 60)
      .optional(),
    bufferAfterMin: z
      .number()
      .int()
      .min(0)
      .max(8 * 60)
      .optional(),
    priceNote: shortText.optional(),
    depositRequired: z.boolean().optional(),
    depositAmountPence: z.number().int().min(0).max(1_000_000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
