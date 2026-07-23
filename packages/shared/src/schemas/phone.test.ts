import { describe, expect, it } from "vitest";
import { voiceSettingsSchema } from "./phone.js";

describe("voiceSettingsSchema", () => {
  it("applies sensible defaults", () => {
    const r = voiceSettingsSchema.parse({ number: "+441234567890" });
    expect(r.enabled).toBe(true);
    expect(r.ttsProvider).toBe("twilio");
    expect(r.voice).toBe("Polly.Amy");
    expect(r.language).toBe("en-GB");
    expect(r.speechTimeoutSec).toBeNull();
  });

  it("accepts the ElevenLabs provider with a voice id", () => {
    const r = voiceSettingsSchema.parse({
      number: "+441234567890",
      ttsProvider: "elevenlabs",
      elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
    });
    expect(r.ttsProvider).toBe("elevenlabs");
    expect(r.elevenLabsVoiceId).toBe("21m00Tcm4TlvDq8ikWAM");
  });

  it("rejects an unknown provider", () => {
    const r = voiceSettingsSchema.safeParse({ number: "+441234567890", ttsProvider: "acme" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const r = voiceSettingsSchema.safeParse({ number: "+441234567890", script: "rm -rf" });
    expect(r.success).toBe(false);
  });
});
