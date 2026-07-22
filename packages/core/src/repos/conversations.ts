import { and, eq } from "drizzle-orm";
import type { ConversationStatus, MessageDirection, MessageRole } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { conversations, messages } from "../db/schema.js";
import { guardRow, TenantError, type TenantContext } from "../tenancy/index.js";

export async function createConversation(
  ctx: TenantContext,
  input: { contactId?: string | null; channelId?: string | null; subject?: string | null },
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(conversations)
    .values({
      tenantId: ctx.tenantId,
      contactId: input.contactId ?? null,
      channelId: input.channelId ?? null,
      subject: input.subject ?? null,
      status: "ai_handling",
      lastMessageAt: new Date(),
    })
    .returning();
  return row!;
}

export async function getConversation(
  ctx: TenantContext,
  conversationId: string,
  database: Database = getDb(),
) {
  const row = await database.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, ctx.tenantId)),
  });
  return guardRow(ctx, row ?? null);
}

export async function setConversationStatus(
  ctx: TenantContext,
  conversationId: string,
  status: ConversationStatus,
  database: Database = getDb(),
) {
  const rows = await database
    .update(conversations)
    .set({ status })
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, ctx.tenantId)))
    .returning({ id: conversations.id });
  if (rows.length === 0) throw new TenantError("Conversation not found", 404);
}

export async function appendMessage(
  ctx: TenantContext,
  input: {
    conversationId: string;
    direction: MessageDirection;
    role: MessageRole;
    body: string;
    providerMessageId?: string | null;
    spamScore?: number | null;
  },
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(messages)
    .values({
      tenantId: ctx.tenantId,
      conversationId: input.conversationId,
      direction: input.direction,
      role: input.role,
      body: input.body,
      providerMessageId: input.providerMessageId ?? null,
      spamScore: input.spamScore ?? null,
    })
    .returning();
  await database
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, input.conversationId));
  return row!;
}

/** Recent messages for a conversation, oldest-first, capped. */
export async function getRecentMessages(
  ctx: TenantContext,
  conversationId: string,
  limit = 20,
  database: Database = getDb(),
) {
  const rows = await database.query.messages.findMany({
    where: and(eq(messages.tenantId, ctx.tenantId), eq(messages.conversationId, conversationId)),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit,
  });
  return rows.reverse();
}
