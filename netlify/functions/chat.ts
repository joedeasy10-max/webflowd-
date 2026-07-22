import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
  anthropicClient,
  appendMessage,
  checkRateLimit,
  classifySpam,
  createConversation,
  findOrCreateContact,
  getBookingRules,
  getConversation,
  getHours,
  getProfile,
  getRecentMessages,
  listKnowledge,
  listServices,
  resolveChatChannel,
  runAssistantTurn,
  runInTenant,
  setConversationStatus,
  writeAudit,
  type EngineHistoryItem,
  type TenantContext,
  type TenantPromptData,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { clientIp } from "./_lib/context.js";

const bodySchema = z.object({
  publicKey: z.string().min(8).max(128),
  message: z.string().min(1).max(8000),
  conversationId: z.string().uuid().optional(),
  visitor: z
    .object({
      name: z.string().max(200).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(40).optional(),
    })
    .optional(),
});

/** CORS: the widget is embedded cross-origin on the owner's site. */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (process.env.WIDGET_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // If an allowlist is configured, only reflect allowed origins; else reflect any (dev).
  const allow = allowed.length === 0 ? origin || "*" : allowed.includes(origin) ? origin : "";
  return {
    "access-control-allow-origin": allow || "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/**
 * POST /api/chat — public chat-widget endpoint.
 * Resolves the tenant from the widget public key, filters spam, runs the Claude
 * engine, persists the exchange, and returns the reply. Runs the turn inside a
 * tenant transaction so RLS + tool executors are tenant-scoped.
 */
export default async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  return withErrorHandling(() =>
    methodRouter(req, {
      POST: async () => {
        const input = await readJson(req, bodySchema);

        const ip = clientIp(req);
        const rl = await checkRateLimit({
          key: `chat:${input.publicKey}:${ip ?? "unknown"}`,
          limit: 20,
          windowSec: 60,
        });
        if (!rl.allowed) return json({ error: "Too many messages" }, 429, cors);

        const resolved = await resolveChatChannel(input.publicKey);
        if (!resolved) return json({ error: "Unknown widget key" }, 404, cors);

        const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };
        const spam = classifySpam(input.message);

        const result = await runInTenant(ctx, async (tx) => {
          const contact = input.visitor ? await findOrCreateContact(ctx, input.visitor, tx) : null;

          const conversation = input.conversationId
            ? await getConversation(ctx, input.conversationId, tx)
            : await createConversation(
                ctx,
                { channelId: resolved.channelId, contactId: contact?.id ?? null },
                tx,
              );
          if (!conversation) return { notFound: true as const };

          await writeAudit(
            {
              tenantId: ctx.tenantId,
              actor: "system",
              action: "message.received",
              entityType: "conversation",
              entityId: conversation.id,
              metadata: { channel: "chat", spamScore: spam.score },
            },
            tx,
          );

          // History BEFORE appending the new inbound message.
          const priorMessages = await getRecentMessages(ctx, conversation.id, 20, tx);
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
            return {
              conversationId: conversation.id,
              reply: "Thanks for your message.",
              escalated: false as const,
            };
          }

          const tenantData = await loadTenantData(ctx, tx);
          const history: EngineHistoryItem[] = priorMessages.map((m) => ({
            role: m.role === "ai" || m.role === "owner" ? "ai" : "customer",
            body: m.body,
          }));

          const turn = await runAssistantTurn(ctx, {
            tenantData,
            history,
            customerText: input.message,
            channel: "chat",
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
          await writeAudit(
            {
              tenantId: ctx.tenantId,
              actor: "ai",
              action: "reply.sent",
              entityType: "conversation",
              entityId: conversation.id,
              metadata: { escalated: turn.escalated },
            },
            tx,
          );

          return {
            conversationId: conversation.id,
            reply: turn.replyText,
            escalated: turn.escalated,
          };
        });

        if ("notFound" in result) return json({ error: "Conversation not found" }, 404, cors);
        return json(result, 200, cors);
      },
    }),
  );
};

async function loadTenantData(
  ctx: TenantContext,
  tx: Parameters<typeof getProfile>[1],
): Promise<TenantPromptData> {
  const [profile, services, hours, bookingRules, knowledge] = [
    await getProfile(ctx, tx),
    await listServices(ctx, tx),
    await getHours(ctx, tx),
    await getBookingRules(ctx, tx),
    await listKnowledge(ctx, tx),
  ];
  return {
    profile: profile
      ? {
          displayName: profile.displayName,
          trade: profile.trade,
          phone: profile.phone,
          address: profile.address,
          about: profile.about,
          tone: profile.tone,
          pricingNotes: profile.pricingNotes,
          bookingPolicyText: profile.bookingPolicyText,
        }
      : null,
    services: services.map((s) => ({
      name: s.name,
      description: s.description,
      defaultDurationMin: s.defaultDurationMin,
      priceNote: s.priceNote,
      depositRequired: s.depositRequired,
    })),
    hours: hours.map((h) => ({
      weekday: h.weekday,
      closed: h.closed,
      open: h.open,
      close: h.close,
    })),
    bookingRules: bookingRules
      ? { minNoticeMin: bookingRules.minNoticeMin, maxAdvanceDays: bookingRules.maxAdvanceDays }
      : null,
    knowledge: knowledge
      .filter((k) => k.active)
      .map((k) => ({ question: k.question, answer: k.answer })),
  };
}

export const config: Config = { path: "/api/chat" };
