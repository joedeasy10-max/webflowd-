import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { channels } from "../db/schema.js";
import type { TenantContext } from "../tenancy/index.js";

export function generateChatPublicKey(): string {
  return `wfd_${randomBytes(18).toString("base64url")}`;
}

/** Ensure the tenant has a chat-widget channel; returns its id + public key. */
export async function ensureChatChannel(
  ctx: TenantContext,
  database: Database = getDb(),
): Promise<{ channelId: string; publicKey: string }> {
  const existing = await database.query.channels.findFirst({
    where: and(eq(channels.tenantId, ctx.tenantId), eq(channels.type, "chat")),
  });
  if (existing?.publicKey) {
    return { channelId: existing.id, publicKey: existing.publicKey };
  }
  const publicKey = generateChatPublicKey();
  const [row] = await database
    .insert(channels)
    .values({ tenantId: ctx.tenantId, type: "chat", publicKey, enabled: true })
    .returning({ id: channels.id });
  return { channelId: row!.id, publicKey };
}

export async function getChatChannel(ctx: TenantContext, database: Database = getDb()) {
  const row = await database.query.channels.findFirst({
    where: and(eq(channels.tenantId, ctx.tenantId), eq(channels.type, "chat")),
  });
  return row ?? null;
}

export interface ResolvedChannel {
  tenantId: string;
  channelId: string;
}

/**
 * Resolve a tenant + channel from a widget public key. This is a system-context
 * lookup performed BEFORE any tenant is known — the public key is the tenant
 * resolver. (`channels` is intentionally not under tenant RLS; see migration
 * 0002.)
 */
export async function resolveChatChannel(
  publicKey: string,
  database: Database = getDb(),
): Promise<ResolvedChannel | null> {
  if (!publicKey) return null;
  const row = await database.query.channels.findFirst({
    where: and(
      eq(channels.publicKey, publicKey),
      eq(channels.type, "chat"),
      eq(channels.enabled, true),
    ),
    columns: { id: true, tenantId: true },
  });
  return row ? { tenantId: row.tenantId, channelId: row.id } : null;
}
