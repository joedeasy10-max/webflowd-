import { z } from "zod";

/**
 * Feature flags an uploaded skill may toggle. These map to capabilities that are
 * ALREADY implemented in server code — a skill only switches them on/off for the
 * client; it can never introduce new executable behaviour. Anything outside this
 * allowlist is rejected at upload time.
 */
export const FEATURE_FLAGS = [
  "deposits", // require Stripe deposits on deposit-services
  "reminders", // appointment reminders
  "review_requests", // post-job review requests
  "lead_followup", // nurture sequences for unconverted leads
  "voice", // phone/voice receptionist
  "missed_call_text_back", // SMS back on missed calls
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** Kind of skill, for grouping in the admin UI. */
export const SKILL_CATEGORIES = ["knowledge", "feature", "workflow"] as const;

/** A lowercase, URL-safe stable identifier, unique per client. */
const skillKey = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, - or _");

/**
 * The uploadable skill manifest. DECLARATIVE ONLY — there is deliberately no
 * field for code, scripts, URLs to execute, or shell. A skill can (a) add prompt
 * `instructions` the assistant follows, and (b) flip pre-approved `featureFlags`.
 * That is the entire contract, which is what keeps "upload a skill" safe in a
 * shared multi-tenant environment.
 */
export const skillManifestSchema = z
  .object({
    key: skillKey,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    category: z.enum(SKILL_CATEGORIES).default("knowledge"),
    /** Guidance appended to the AI system prompt when the skill is enabled. */
    instructions: z.string().trim().max(8000).optional(),
    /** Pre-approved capability toggles (allowlist-checked). */
    featureFlags: z.array(z.enum(FEATURE_FLAGS)).max(FEATURE_FLAGS.length).default([]),
    /** Free-form declarative settings surfaced to the admin (no execution). */
    settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((m) => Boolean(m.instructions) || m.featureFlags.length > 0, {
    message: "A skill must provide instructions and/or at least one feature flag",
    path: ["instructions"],
  });

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export const skillToggleSchema = z.object({ enabled: z.boolean() }).strict();
