import type { Config } from "@netlify/functions";
import { voiceSettingsSchema, type VoiceChannelConfig } from "@webflowd/shared";
import { getVoiceChannel, runInTenant, upsertVoiceChannel } from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/phone — the signed-in owner's voice-receptionist settings.
 * GET returns the current config; PUT saves the phone number + tuning knobs
 * (greeting, voice, language, speech timeout) onto the tenant's voice channel.
 */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        const channel = await runInTenant(ctx, (tx) => getVoiceChannel(ctx, tx));
        if (!channel) return json({ configured: false });
        const cfg = (channel.inboundConfig ?? {}) as VoiceChannelConfig;
        return json({
          configured: true,
          number: channel.identifier,
          enabled: channel.enabled,
          greeting: cfg.greeting ?? "",
          voice: cfg.voice ?? "Polly.Amy",
          language: cfg.language ?? "en-GB",
          speechTimeoutSec: cfg.speechTimeoutSec ?? null,
        });
      },
      PUT: async () => {
        const { ctx } = await authenticate(req);
        const body = await readJson(req, voiceSettingsSchema);
        const config: Record<string, unknown> = {
          greeting: body.greeting,
          voice: body.voice,
          language: body.language,
          speechTimeoutSec: body.speechTimeoutSec,
        };
        const row = await runInTenant(ctx, (tx) =>
          upsertVoiceChannel(ctx, { identifier: body.number, enabled: body.enabled, config }, tx),
        );
        return json({ ok: true, channelId: row.id });
      },
    }),
  );

export const config: Config = { path: "/api/phone" };
