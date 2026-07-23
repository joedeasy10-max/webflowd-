import { z } from "zod";
import { mediumText, phone } from "./common.js";

/**
 * TTS voices offered for the voice receptionist. Twilio's Amazon Polly neural
 * voices; UK English first. The owner picks one in the Phone settings screen.
 */
export const TTS_VOICES = [
  "Polly.Amy", // British English, female
  "Polly.Brian", // British English, male
  "Polly.Arthur", // British English, male (neural)
  "Polly.Emma", // British English, female
  "Polly.Joanna", // US English, female
  "Polly.Matthew", // US English, male
] as const;

/**
 * Text-to-speech provider for the receptionist.
 * - `twilio`: built-in Amazon Polly voices via TwiML `<Say>` (active now).
 * - `elevenlabs`: a custom ElevenLabs voice (activates once an ElevenLabs
 *   account + `ELEVENLABS_API_KEY` are connected; until then the call falls back
 *   to the selected Polly voice).
 */
export const TTS_PROVIDERS = ["twilio", "elevenlabs"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

/**
 * Owner-configurable settings for the turn-based voice receptionist. Stored on
 * the tenant's `voice` channel (`identifier` = the phone number, the rest in
 * `inbound_config`) so the owner can tune it themselves with no redeploy.
 */
export const voiceSettingsSchema = z
  .object({
    /** The Twilio phone number that receives calls, in E.164 (e.g. +441234567890). */
    number: phone,
    enabled: z.boolean().default(true),
    /** Spoken greeting; falls back to a sensible default when omitted. */
    greeting: mediumText.optional(),
    /** Which TTS provider speaks the replies. */
    ttsProvider: z.enum(TTS_PROVIDERS).default("twilio"),
    voice: z.enum(TTS_VOICES).default("Polly.Amy"),
    /**
     * ElevenLabs voice id to use when `ttsProvider` is `elevenlabs`. Take it from
     * your ElevenLabs voice library once your account is set up.
     */
    elevenLabsVoiceId: z.string().trim().max(64).optional(),
    /** BCP-47 language tag Twilio uses for STT + TTS. */
    language: z.string().trim().max(12).default("en-GB"),
    /**
     * Seconds of silence before Twilio treats a turn as finished. `null` = the
     * default "auto" endpointing, which adapts to the speaker.
     */
    speechTimeoutSec: z.number().int().min(1).max(10).nullable().default(null),
  })
  .strict();

export type VoiceSettingsInput = z.infer<typeof voiceSettingsSchema>;

/** The subset persisted in `channels.inbound_config` (everything but the number). */
export interface VoiceChannelConfig {
  greeting?: string;
  ttsProvider?: TtsProvider;
  voice?: string;
  elevenLabsVoiceId?: string;
  language?: string;
  speechTimeoutSec?: number | null;
}
