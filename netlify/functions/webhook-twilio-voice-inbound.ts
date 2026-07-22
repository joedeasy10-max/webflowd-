import type { Config } from "@netlify/functions";
import type { VoiceChannelConfig } from "@webflowd/shared";
import {
  createConversation,
  findOrCreateContact,
  getChannelById,
  getProfile,
  resolveChannelByIdentifier,
  runInTenant,
  writeAudit,
  type TenantContext,
} from "@webflowd/core";
import {
  absoluteUrl,
  readVerifiedTwilio,
  sayAndGather,
  sayAndHangup,
  twiml,
} from "./_lib/twilio.js";

/**
 * POST /webhooks/twilio/voice-inbound — the entry point for an inbound call.
 * Verifies the Twilio signature, resolves the tenant from the called number,
 * opens a voice conversation, and returns TwiML that greets the caller and
 * gathers their first spoken request. Each subsequent turn posts to
 * /webhooks/twilio/voice-turn with the conversation id, so the whole flow is
 * stateless across function invocations (Netlify has no long-lived socket).
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const params = await readVerifiedTwilio(req);
  if (!params) return new Response("Invalid signature", { status: 403 });

  const from = params.From ?? "";
  const to = params.To ?? "";

  const resolved = await resolveChannelByIdentifier("voice", to);
  if (!resolved) {
    return twiml(sayAndHangup("Sorry, we can't take your call right now. Please try again later."));
  }

  const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };
  const greeting = await runInTenant(ctx, async (tx) => {
    const contact = from ? await findOrCreateContact(ctx, { phone: from }, tx) : null;
    const conversation = await createConversation(
      ctx,
      { contactId: contact?.id ?? null, channelId: resolved.channelId, subject: "Inbound call" },
      tx,
    );
    await writeAudit(
      {
        tenantId: ctx.tenantId,
        actor: "system",
        action: "message.received",
        entityType: "conversation",
        entityId: conversation.id,
        metadata: { channel: "voice", callSid: params.CallSid },
      },
      tx,
    );
    const profile = await getProfile(ctx, tx);
    const name = profile?.displayName ?? "the team";
    const channel = await getChannelById(ctx, resolved.channelId, tx);
    const cfg = (channel?.inboundConfig ?? {}) as VoiceChannelConfig;
    const actionUrl = absoluteUrl(req, `/webhooks/twilio/voice-turn?cid=${conversation.id}`);
    return sayAndGather({
      say:
        cfg.greeting ||
        `Hi, you've reached ${name}. I'm the virtual assistant — how can I help you today?`,
      actionUrl,
      voice: cfg.voice,
      language: cfg.language,
      speechTimeoutSec: cfg.speechTimeoutSec ?? null,
    });
  });

  return twiml(greeting);
};

export const config: Config = { path: "/webhooks/twilio/voice-inbound" };
