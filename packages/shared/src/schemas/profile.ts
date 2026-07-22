import { z } from "zod";
import { email, mediumText, phone, serviceArea, shortText } from "./common.js";

/**
 * The business profile injected into the AI's system prompt. This is the
 * source of truth the assistant is allowed to speak from.
 */
export const businessProfileSchema = z
  .object({
    legalName: shortText.optional(),
    displayName: shortText,
    trade: shortText.optional(), // e.g. "Plumbing", "Electrical"
    phone: phone.optional(),
    replyEmail: email.optional(),
    address: mediumText.optional(),
    serviceArea: serviceArea.optional(),
    about: mediumText.optional(),
    /** Brand voice guidance, e.g. "Friendly, plain-spoken, no jargon." */
    tone: mediumText.optional(),
    /** Free-text pricing notes. The AI must not invent prices beyond these. */
    pricingNotes: mediumText.optional(),
    /** Cancellation / deposit / callout policy shown to customers. */
    bookingPolicyText: mediumText.optional(),
    logoUrl: z.string().url().max(2048).optional(),
  })
  .strict();

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

/** Partial update — every field optional but at least one required. */
export const businessProfileUpdateSchema = businessProfileSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
