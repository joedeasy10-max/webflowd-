import type { ChannelType } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { writeAudit } from "../audit/index.js";
import type { TenantContext } from "../tenancy/index.js";
import { findOrCreateContact, type ContactIdentity } from "../repos/contacts.js";
import {
  appendMessage,
  createConversation,
  getRecentMessages,
  setConversationStatus,
} from "../repos/conversations.js";
import { classifySpam } from "./spam.js";
import { runAssistantTurn, type EngineHistoryItem } from "./engine.js";
import type { ModelClient } from "./client.js";
import type { TenantPromptData } from "./prompt.js";

export interface IngestInput {
  channel: ChannelType;
  channelId?: string | null;
  message: string;
  visitor?: ContactIdentity | null;
  subject?: string | null;
}

export interface IngestDeps {
  db?: Database;
  model: ModelClient;
  tenantData: TenantPromptData;
  env?: NodeJS.ProcessEnv;
  history?: EngineHistoryItem[];
}

export interface IngestResult {
  conversationId: string;
  contactId: string | null;
  reply: string;
  escalated: boolean;
  spam: boolean;
}

/**
 * Ingest one inbound customer message on any channel: spam-filter it, open a
 * conversation, run the Claude engine, and persist the exchange. Shared by the
 * web-form and Google-Business ingestion endpoints so every channel gets the
 * same tenant-scoped, audited, prompt-injection-safe pipeline.
 *
 * Tenant-scoped — call inside `runInTenant`. The caller resolves the tenant from
 * the channel identifier (never from the message) and loads `tenantData`.
 */
export async function ingestInboundMessage(
  ctx: TenantContext,
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const db = deps.db ?? getDb();
  const spam = classifySpam(input.message);

  const contact =
    input.visitor && (input.visitor.email || input.visitor.phone || input.visitor.name)
      ? await findOrCreateContact(ctx, input.visitor, db)
      : null;

  const conversation = await createConversation(
    ctx,
    { contactId: contact?.id ?? null, channelId: input.channelId ?? null, subject: input.subject },
    db,
  );

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "system",
      action: "message.received",
      entityType: "conversation",
      entityId: conversation.id,
      metadata: { channel: input.channel, spamScore: spam.score },
    },
    db,
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
    db,
  );

  if (spam.isSpam) {
    await setConversationStatus(ctx, conversation.id, "spam", db);
    return {
      conversationId: conversation.id,
      contactId: contact?.id ?? null,
      reply: "Thanks for your message.",
      escalated: false,
      spam: true,
    };
  }

  const turn = await runAssistantTurn(ctx, {
    tenantData: deps.tenantData,
    history: deps.history ?? [],
    customerText: input.message,
    channel: input.channel,
    model: deps.model,
    deps: { db, conversationId: conversation.id, env: deps.env ?? process.env },
  });

  await appendMessage(
    ctx,
    {
      conversationId: conversation.id,
      direction: "outbound",
      role: "ai",
      body: turn.replyText,
    },
    db,
  );
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "ai",
      action: "reply.sent",
      entityType: "conversation",
      entityId: conversation.id,
      metadata: { channel: input.channel, escalated: turn.escalated },
    },
    db,
  );

  return {
    conversationId: conversation.id,
    contactId: contact?.id ?? null,
    reply: turn.replyText,
    escalated: turn.escalated,
    spam: false,
  };
}

export interface ConversationTurnResult {
  reply: string;
  escalated: boolean;
}

/**
 * Run one assistant turn inside an EXISTING conversation, carrying prior message
 * history for context. Appends the customer's message and the AI reply, and
 * audit-logs the reply. Used by turn-based channels like the voice receptionist
 * (each `<Gather>` speech result is one turn). Tenant-scoped — call inside
 * `runInTenant`.
 */
export async function replyInConversation(
  ctx: TenantContext,
  input: {
    conversationId: string;
    customerText: string;
    channel: ChannelType;
    tenantData: TenantPromptData;
    model: ModelClient;
    env?: NodeJS.ProcessEnv;
    db?: Database;
    historyLimit?: number;
  },
): Promise<ConversationTurnResult> {
  const db = input.db ?? getDb();

  // History BEFORE appending the new inbound message.
  const prior = await getRecentMessages(ctx, input.conversationId, input.historyLimit ?? 20, db);
  const history: EngineHistoryItem[] = prior.map((m) => ({
    role: m.role === "ai" || m.role === "owner" ? "ai" : "customer",
    body: m.body,
  }));

  await appendMessage(
    ctx,
    {
      conversationId: input.conversationId,
      direction: "inbound",
      role: "customer",
      body: input.customerText,
    },
    db,
  );

  const turn = await runAssistantTurn(ctx, {
    tenantData: input.tenantData,
    history,
    customerText: input.customerText,
    channel: input.channel,
    model: input.model,
    deps: { db, conversationId: input.conversationId, env: input.env ?? process.env },
  });

  await appendMessage(
    ctx,
    {
      conversationId: input.conversationId,
      direction: "outbound",
      role: "ai",
      body: turn.replyText,
    },
    db,
  );
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "ai",
      action: "reply.sent",
      entityType: "conversation",
      entityId: input.conversationId,
      metadata: { channel: input.channel, escalated: turn.escalated },
    },
    db,
  );

  return { reply: turn.replyText, escalated: turn.escalated };
}
