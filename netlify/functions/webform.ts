import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
  anthropicClient,
  appendMessage,
  checkRateLimit,
  classifySpam,
  createConversation,
  findOrCreateContact,
  getProfile,
  resolveChatChannel,
  runAssistantTurn,
  runInTenant,
  sendEmailViaSendGrid,
  setConversationStatus,
  writeAudit,
  type TenantContext,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { clientIp } from "./_lib/context.js";
import { loadTenantData } from "./_lib/tenant-data.js";

const bodySchema = z.object({
  publicKey: z.string().min(8).max(128),
  message: z.string().min(1).max(8000),
  name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
});

/**
 * POST /api/webform — public web-form / "contact us" ingestion.
 * Resolves the tenant from the widget public key, opens a web_form conversation,
 * runs the Claude engine to draft a reply, persists the exchange, and — since a
 * form submission has no live socket — emails the reply back to the sender if
 * they gave an email. Rate-limited and spam-filtered like the chat widget.
 */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      POST: async () => {
        const input = await readJson(req, bodySchema);

        const ip = clientIp(req);
        const rl = await checkRateLimit({
          key: `webform:${input.publicKey}:${ip ?? "unknown"}`,
          limit: 10,
          windowSec: 60,
        });
        if (!rl.allowed) return json({ error: "Too many submissions" }, 429);

        const resolved = await resolveChatChannel(input.publicKey);
        if (!resolved) return json({ error: "Unknown key" }, 404);

        const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };
        const spam = classifySpam(input.message);

        const result = await runInTenant(ctx, async (tx) => {
          const contact = await findOrCreateContact(
            ctx,
            { name: input.name, email: input.email, phone: input.phone },
            tx,
          );
          const conversation = await createConversation(
            ctx,
            { contactId: contact.id, channelId: resolved.channelId, subject: "Web form enquiry" },
            tx,
          );

          await writeAudit(
            {
              tenantId: ctx.tenantId,
              actor: "system",
              action: "message.received",
              entityType: "conversation",
              entityId: conversation.id,
              metadata: { channel: "web_form", spamScore: spam.score },
            },
            tx,
          );
          await appendMessage(
            ctx,
            {
              conversationId: conversation.id,
              direction: "inbound",
              role: "customer",
              body: input.message,
              spamScore: spam.score,
            },
            tx,
          );

          if (spam.isSpam) {
            await setConversationStatus(ctx, conversation.id, "spam", tx);
            return { conversationId: conversation.id, delivered: false as const };
          }

          const tenantData = await loadTenantData(ctx, tx);
          const turn = await runAssistantTurn(ctx, {
            tenantData,
            history: [],
            customerText: input.message,
            channel: "web_form",
            model: anthropicClient(),
            deps: { db: tx, conversationId: conversation.id, env: process.env },
          });

          await appendMessage(
            ctx,
            {
              conversationId: conversation.id,
              direction: "outbound",
              role: "ai",
              body: turn.replyText,
            },
            tx,
          );

          // Email the reply back to the sender (best-effort).
          let delivered = false;
          const profile = await getProfile(ctx, tx);
          if (
            input.email &&
            profile?.replyEmail &&
            process.env.SENDGRID_API_KEY &&
            !turn.escalated
          ) {
            await sendEmailViaSendGrid({
              apiKey: process.env.SENDGRID_API_KEY,
              from: profile.replyEmail,
              to: input.email,
              subject: `Re: your enquiry to ${profile.displayName}`,
              text: turn.replyText,
            }).then(
              () => {
                delivered = true;
              },
              () => undefined,
            );
          }

          await writeAudit(
            {
              tenantId: ctx.tenantId,
              actor: "ai",
              action: "reply.sent",
              entityType: "conversation",
              entityId: conversation.id,
              metadata: { channel: "web_form", escalated: turn.escalated, delivered },
            },
            tx,
          );

          return { conversationId: conversation.id, delivered, escalated: turn.escalated };
        });

        return json({ ok: true, ...result }, 200);
      },
    }),
  );

export const config: Config = { path: "/api/webform" };
