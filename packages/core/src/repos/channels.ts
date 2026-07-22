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

/** The tenant's voice (phone) channel, if they've set one up. */
export async function getVoiceChannel(ctx: TenantContext, database: Database = getDb()) {
  const row = await database.query.channels.findFirst({
    where: and(eq(channels.tenantId, ctx.tenantId), eq(channels.type, "voice")),
  });
  return row ?? null;
}

export async function getChannelById(
  ctx: TenantContext,
  channelId: string,
  database: Database = getDb(),
) {
  const row = await database.query.channels.findFirst({
    where: and(eq(channels.id, channelId), eq(channels.tenantId, ctx.tenantId)),
  });
  return row ?? null;
}

export interface VoiceChannelInput {
  identifier: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Create or update the tenant's voice channel. The phone number is the channel
 * `identifier` (used to resolve the tenant on inbound calls); tuning knobs
 * (greeting/voice/language/timeout) live in `inbound_config`. One voice channel
 * per tenant.
 */
export async function upsertVoiceChannel(
  ctx: TenantContext,
  input: VoiceChannelInput,
  database: Database = getDb(),
) {
  const existing = await getVoiceChannel(ctx, database);
  if (existing) {
    const [row] = await database
      .update(channels)
      .set({
        identifier: input.identifier,
        enabled: input.enabled,
        inboundConfig: input.config,
      })
      .where(and(eq(channels.id, existing.id), eq(channels.tenantId, ctx.tenantId)))
      .returning();
    return row!;
  }
  const [row] = await database
    .insert(channels)
    .values({
      tenantId: ctx.tenantId,
      type: "voice",
      identifier: input.identifier,
      enabled: input.enabled,
      inboundConfig: input.config,
    })
    .returning();
  return row!;
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

/**
 * Resolve a tenant + channel from a channel type and its external identifier
 * (e.g. a Twilio voice/SMS number in E.164). Like `resolveChatChannel`, this is
 * a system-context lookup used before any tenant is known — the inbound provider
 * identifier is the tenant resolver. (`channels` is not under tenant RLS; see
 * migration 0002.)
 */
export async function resolveChannelByIdentifier(
  type: (typeof channels.type.enumValues)[number],
  identifier: string,
  database: Database = getDb(),
): Promise<ResolvedChannel | null> {
  if (!identifier) return null;
  const row = await database.query.channels.findFirst({
    where: and(
      eq(channels.type, type),
      eq(channels.identifier, identifier),
      eq(channels.enabled, true),
    ),
    columns: { id: true, tenantId: true },
  });
  return row ? { tenantId: row.tenantId, channelId: row.id } : null;
}
