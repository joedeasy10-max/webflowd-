import type { Config } from "@netlify/functions";
import {
  anthropicClient,
  getConversation,
  replyInConversation,
  resolveChannelByIdentifier,
  runInTenant,
  type TenantContext,
} from "@webflowd/core";
import {
  absoluteUrl,
  readVerifiedTwilio,
  sayAndGather,
  sayAndHangup,
  twiml,
} from "./_lib/twilio.js";
import { loadTenantData } from "./_lib/tenant-data.js";

const GOODBYE = "Thanks for calling. Goodbye.";
const HANDOFF = "Thanks — I'll get one of the team to call you straight back. Goodbye for now.";
const NO_INPUT = "Sorry, I didn't catch that. Please tell me how I can help.";

/**
 * POST /webhooks/twilio/voice-turn — one turn of the speech IVR. Twilio posts
 * the caller's transcribed speech (SpeechResult); we run it through the Claude
 * engine within the call's conversation and reply with TwiML that speaks the
 * answer and gathers the next turn. Escalations end the call with a callback
 * promise; repeated silence ends politely. The conversation id + reprompt count
 * ride in the action URL, so no server-side call state is needed.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const params = await readVerifiedTwilio(req);
  if (!params) return new Response("Invalid signature", { status: 403 });

  const url = new URL(req.url);
  const cid = url.searchParams.get("cid") ?? "";
  const reprompts = Number(url.searchParams.get("r") ?? "0") || 0;
  const to = params.To ?? "";
  const speech = (params.SpeechResult ?? "").trim();

  const resolved = await resolveChannelByIdentifier("voice", to);
  if (!resolved || !cid) return twiml(sayAndHangup(GOODBYE));

  const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };

  // No speech captured: reprompt once, then end politely.
  if (!speech) {
    if (reprompts >= 1) return twiml(sayAndHangup(GOODBYE));
    const actionUrl = absoluteUrl(req, `/webhooks/twilio/voice-turn?cid=${cid}&r=${reprompts + 1}`);
    return twiml(sayAndGather({ say: NO_INPUT, actionUrl }));
  }

  const body = await runInTenant(ctx, async (tx) => {
    // Ensure the conversation belongs to this tenant before writing to it.
    const conversation = await getConversation(ctx, cid, tx).catch(() => null);
    if (!conversation) return sayAndHangup(GOODBYE);

    const tenantData = await loadTenantData(ctx, tx);
    const turn = await replyInConversation(ctx, {
      conversationId: cid,
      customerText: speech,
      channel: "voice",
      tenantData,
      model: anthropicClient(),
      env: process.env,
      db: tx,
    });

    if (turn.escalated) return sayAndHangup(`${turn.reply} ${HANDOFF}`);

    const actionUrl = absoluteUrl(req, `/webhooks/twilio/voice-turn?cid=${cid}`);
    return sayAndGather({ say: turn.reply, actionUrl });
  });

  return twiml(body);
};

export const config: Config = { path: "/webhooks/twilio/voice-turn" };
