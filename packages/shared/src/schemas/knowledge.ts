import { z } from "zod";
import { longText, shortText } from "./common.js";

/** A single FAQ / knowledge-base entry the AI may answer from. */
export const knowledgeItemSchema = z
  .object({
    question: shortText,
    answer: longText.pipe(z.string().min(1)),
    tags: z.array(z.string().trim().toLowerCase().max(40)).max(20).default([]),
    active: z.boolean().default(true),
  })
  .strict();

export type KnowledgeItemInput = z.infer<typeof knowledgeItemSchema>;

export const knowledgeItemUpdateSchema = z
  .object({
    question: shortText.optional(),
    answer: longText.pipe(z.string().min(1)).optional(),
    tags: z.array(z.string().trim().toLowerCase().max(40)).max(20).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
