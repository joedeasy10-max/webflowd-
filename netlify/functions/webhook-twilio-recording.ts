import type { Config } from "@netlify/functions";
import {
  claimWebhookEvent,
  handleVoicemail,
  markWebhookProcessed,
  releaseWebhookEvent,
  resolveChannelByIdentifier,
  runInTenant,
  sendSmsViaTwilio,
  verifyTwilioSignature,
  type TenantContext,
} from "@webflowd/core";

/**
 * POST /webhooks/twilio/recording — Twilio recording / transcription callback
 * for the voicemail receptionist. Verifies the signature, dedupes by
 * RecordingSid, resolves the tenant from the called number, stores the voicemail
 * (transcription + recording link) as an inbound message, and texts the caller
 * a courtesy follow-up. Accepts either the recording callback (RecordingUrl) or
 * the transcription callback (TranscriptionText).
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!authToken || !accountSid) return new Response("Not configured", { status: 500 });

  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = process.env.TWILIO_RECORDING_WEBHOOK_URL ?? req.url;
  if (!verifyTwilioSignature(url, params, authToken, signature)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const callSid = params.CallSid ?? "";
  const recordingSid = params.RecordingSid ?? params.TranscriptionSid ?? callSid;
  const from = params.From ?? ""; // caller (customer)
  const to = params.To ?? ""; // business number that was called
  if (!recordingSid || !from || !to) return twiml();

  const claimed = await claimWebhookEvent("twilio-recording", recordingSid);
  if (!claimed) return twiml();

  try {
    const resolved = await resolveChannelByIdentifier("voice", to);
    if (resolved) {
      const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };
      const smsFrom = process.env.TWILIO_SMS_FROM || to;
      await runInTenant(ctx, async (tx) => {
        await handleVoicemail(
          ctx,
          {
            callSid,
            recordingSid,
            recordingUrl: params.RecordingUrl ?? null,
            transcription: params.TranscriptionText ?? null,
            callerNumber: from,
            businessNumber: smsFrom,
          },
          {
            db: tx,
            channelId: resolved.channelId,
            sendSms: (m) =>
              sendSmsViaTwilio({ accountSid, authToken, from: m.from, to: m.to, body: m.body }),
          },
        );
      });
    }
    await markWebhookProcessed("twilio-recording", recordingSid);
    return twiml();
  } catch (err) {
    await releaseWebhookEvent("twilio-recording", recordingSid).catch(() => undefined);
    console.error("Twilio recording webhook failed:", (err as Error).message);
    return new Response("Processing error", { status: 500 });
  }
};

function twiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export const config: Config = { path: "/webhooks/twilio/recording" };
