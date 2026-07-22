import type { Config } from "@netlify/functions";
import {
  claimWebhookEvent,
  handleMissedCall,
  markWebhookProcessed,
  releaseWebhookEvent,
  resolveChannelByIdentifier,
  runInTenant,
  sendSmsViaTwilio,
  verifyTwilioSignature,
  type TenantContext,
} from "@webflowd/core";

/** Twilio call statuses that mean the customer's call went unanswered. */
const MISSED_STATUSES = new Set(["no-answer", "busy", "failed"]);

/**
 * POST /webhooks/twilio/voice — Twilio call-status callback for missed-call
 * text-back. Verifies the Twilio signature, dedupes by CallSid+status, resolves
 * the tenant from the called (business) number, and — for an unanswered call —
 * texts the caller back. Returns empty TwiML so Twilio doesn't retry needlessly.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!authToken || !accountSid) return new Response("Not configured", { status: 500 });

  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const signature = req.headers.get("x-twilio-signature") ?? "";
  // Twilio signs the exact URL it POSTed to; allow an explicit override for
  // deployments behind a proxy where the reconstructed URL differs.
  const url = process.env.TWILIO_VOICE_WEBHOOK_URL ?? req.url;
  if (!verifyTwilioSignature(url, params, authToken, signature)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const callSid = params.CallSid ?? "";
  const callStatus = params.CallStatus ?? "";
  const from = params.From ?? ""; // caller (customer)
  const to = params.To ?? ""; // business number that was called
  if (!callSid || !from || !to) return twiml();

  // Only act on unanswered calls.
  if (!MISSED_STATUSES.has(callStatus)) return twiml();

  const eventId = `${callSid}:${callStatus}`;
  const claimed = await claimWebhookEvent("twilio-voice", eventId);
  if (!claimed) return twiml();

  try {
    const resolved = await resolveChannelByIdentifier("voice", to);
    if (resolved) {
      const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };
      const smsFrom = process.env.TWILIO_SMS_FROM || to;
      await runInTenant(ctx, async (tx) => {
        await handleMissedCall(
          ctx,
          { callSid, callerNumber: from, businessNumber: smsFrom },
          {
            db: tx,
            channelId: resolved.channelId,
            sendSms: (m) =>
              sendSmsViaTwilio({ accountSid, authToken, from: m.from, to: m.to, body: m.body }),
          },
        );
      });
    }
    await markWebhookProcessed("twilio-voice", eventId);
    return twiml();
  } catch (err) {
    await releaseWebhookEvent("twilio-voice", eventId).catch(() => undefined);
    console.error("Twilio voice webhook failed:", (err as Error).message);
    return new Response("Processing error", { status: 500 });
  }
};

function twiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export const config: Config = { path: "/webhooks/twilio/voice" };
