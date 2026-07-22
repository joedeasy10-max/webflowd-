import { and, eq } from "drizzle-orm";
import type { ConnectionProvider } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { channels, connections } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { Cryptor, getCryptor } from "../crypto/index.js";
import { guardRow, TenantError, type TenantContext } from "../tenancy/index.js";

/** Public shape of a connection — NEVER includes token material. */
export interface SafeConnection {
  id: string;
  provider: ConnectionProvider;
  externalAccountId: string | null;
  scopes: unknown;
  status: string;
  tokenExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSafe(row: typeof connections.$inferSelect): SafeConnection {
  return {
    id: row.id,
    provider: row.provider,
    externalAccountId: row.externalAccountId,
    scopes: row.scopes,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function aad(ctx: TenantContext, provider: ConnectionProvider): string {
  // Binds ciphertext to tenant+provider so a stolen row can't be replayed elsewhere.
  return `${ctx.tenantId}:${provider}`;
}

export interface StoreConnectionInput {
  provider: ConnectionProvider;
  externalAccountId?: string;
  scopes?: string[];
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

/**
 * Upsert a provider connection with tokens encrypted at rest (AES-256-GCM).
 * One connection per (tenant, provider, account). Returns the SAFE view.
 */
export async function storeConnection(
  ctx: TenantContext,
  input: StoreConnectionInput,
  database: Database = getDb(),
  cryptor: Cryptor = getCryptor(),
): Promise<SafeConnection> {
  const externalAccountId = input.externalAccountId ?? "primary";
  const accessTokenEnc = cryptor.encrypt(input.accessToken, aad(ctx, input.provider));
  const refreshTokenEnc = input.refreshToken
    ? cryptor.encrypt(input.refreshToken, aad(ctx, input.provider))
    : null;

  const values = {
    tenantId: ctx.tenantId,
    provider: input.provider,
    externalAccountId,
    scopes: input.scopes ?? [],
    accessTokenEnc,
    refreshTokenEnc,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    status: "active" as const,
    lastSyncedAt: new Date(),
  };

  const [row] = await database
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({
      target: [connections.tenantId, connections.provider, connections.externalAccountId],
      set: {
        scopes: values.scopes,
        accessTokenEnc,
        // Providers may omit a new refresh token on re-consent; keep the old one.
        ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
        tokenExpiresAt: values.tokenExpiresAt,
        status: "active",
        lastSyncedAt: values.lastSyncedAt,
      },
    })
    .returning();

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "connection.created",
      entityType: "connection",
      entityId: row!.id,
      metadata: { provider: input.provider, externalAccountId },
    },
    database,
  );
  return toSafe(row!);
}

export async function listConnections(
  ctx: TenantContext,
  database: Database = getDb(),
): Promise<SafeConnection[]> {
  const rows = await database.query.connections.findMany({
    where: eq(connections.tenantId, ctx.tenantId),
    orderBy: (c, { asc }) => [asc(c.provider)],
  });
  return rows.map(toSafe);
}

/** Internal: load a connection WITH ciphertext (for the token manager only). */
export async function getConnectionInternal(
  ctx: TenantContext,
  connectionId: string,
  database: Database = getDb(),
) {
  const row = await database.query.connections.findFirst({
    where: and(eq(connections.id, connectionId), eq(connections.tenantId, ctx.tenantId)),
  });
  return guardRow(ctx, row ?? null);
}

/** Decrypt a stored token value using the tenant+provider AAD. */
export function decryptToken(
  ctx: TenantContext,
  provider: ConnectionProvider,
  ciphertext: string,
  cryptor: Cryptor = getCryptor(),
): string {
  return cryptor.decrypt(ciphertext, aad(ctx, provider));
}

export async function updateStoredTokens(
  ctx: TenantContext,
  connectionId: string,
  provider: ConnectionProvider,
  tokens: { accessToken: string; refreshToken?: string; tokenExpiresAt?: Date },
  database: Database = getDb(),
  cryptor: Cryptor = getCryptor(),
): Promise<void> {
  const set: Record<string, unknown> = {
    accessTokenEnc: cryptor.encrypt(tokens.accessToken, aad(ctx, provider)),
    tokenExpiresAt: tokens.tokenExpiresAt ?? null,
    status: "active",
    lastSyncedAt: new Date(),
  };
  if (tokens.refreshToken) {
    set.refreshTokenEnc = cryptor.encrypt(tokens.refreshToken, aad(ctx, provider));
  }
  await database
    .update(connections)
    .set(set)
    .where(and(eq(connections.id, connectionId), eq(connections.tenantId, ctx.tenantId)));
}

export async function markNeedsReauth(
  ctx: TenantContext,
  connectionId: string,
  database: Database = getDb(),
): Promise<void> {
  await database
    .update(connections)
    .set({ status: "needs_reauth" })
    .where(and(eq(connections.id, connectionId), eq(connections.tenantId, ctx.tenantId)));
}

/** Revoke a connection: mark revoked and wipe token ciphertext. */
export async function revokeConnection(
  ctx: TenantContext,
  connectionId: string,
  database: Database = getDb(),
): Promise<void> {
  const rows = await database
    .update(connections)
    .set({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null })
    .where(and(eq(connections.id, connectionId), eq(connections.tenantId, ctx.tenantId)))
    .returning({ id: connections.id, provider: connections.provider });
  if (rows.length === 0) throw new TenantError("Connection not found", 404);

  // Detach any channels that referenced this connection.
  await database
    .update(channels)
    .set({ enabled: false, connectionId: null })
    .where(and(eq(channels.connectionId, connectionId), eq(channels.tenantId, ctx.tenantId)));

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "connection.revoked",
      entityType: "connection",
      entityId: connectionId,
    },
    database,
  );
}
