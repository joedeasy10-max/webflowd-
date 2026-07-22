import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
  anthropicClient,
  checkRateLimit,
  getProfile,
  ingestInboundMessage,
  resolveChatChannel,
  runInTenant,
  scheduleLeadFollowup,
  sendEmailViaSendGrid,
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
 * Resolves the tenant from the widget public key, runs the message through the
 * shared Claude ingestion pipeline (channel web_form), and — since a form
 * submission has no live socket — emails the drafted reply back to the sender if
 * they gave an email, then schedules a lead follow-up sequence. Rate-limited and
 * spam-filtered like the chat widget.
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

        const result = await runInTenant(ctx, async (tx) => {
          const tenantData = await loadTenantData(ctx, tx);
          const ingest = await ingestInboundMessage(
            ctx,
            {
              channel: "web_form",
              channelId: resolved.channelId,
              message: input.message,
              visitor: { name: input.name, email: input.email, phone: input.phone },
              subject: "Web form enquiry",
            },
            { db: tx, model: anthropicClient(), tenantData, env: process.env },
          );

          if (ingest.spam) {
            return { conversationId: ingest.conversationId, delivered: false, spam: true };
          }

          // Email the reply back to the sender (best-effort).
          let delivered = false;
          const profile = await getProfile(ctx, tx);
          if (
            input.email &&
            profile?.replyEmail &&
            process.env.SENDGRID_API_KEY &&
            !ingest.escalated
          ) {
            await sendEmailViaSendGrid({
              apiKey: process.env.SENDGRID_API_KEY,
              from: profile.replyEmail,
              to: input.email,
              subject: `Re: your enquiry to ${profile.displayName}`,
              text: ingest.reply,
            }).then(
              () => {
                delivered = true;
              },
              () => undefined,
            );
          }

          // Nurture the lead: schedule follow-ups (self-cancel if they book).
          if (ingest.contactId && (input.email || input.phone)) {
            await scheduleLeadFollowup(
              ctx,
              {
                contactId: ingest.contactId,
                conversationId: ingest.conversationId,
                channel: input.phone ? "sms" : "email",
              },
              tx,
            );
          }

          return {
            conversationId: ingest.conversationId,
            delivered,
            escalated: ingest.escalated,
          };
        });

        return json({ ok: true, ...result }, 200);
      },
    }),
  );

export const config: Config = { path: "/api/webform" };
