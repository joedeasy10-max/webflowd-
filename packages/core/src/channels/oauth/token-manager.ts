import type { ConnectionProvider } from "@webflowd/shared";
import { getDb, type Database } from "../../db/client.js";
import { Cryptor, getCryptor } from "../../crypto/index.js";
import { TenantError, type TenantContext } from "../../tenancy/index.js";
import {
  decryptToken,
  getConnectionInternal,
  markNeedsReauth,
  updateStoredTokens,
} from "../../repos/connections.js";
import { refreshAccessToken, resolveCredentials } from "./providers.js";

/** Refresh a token this many ms before it actually expires. */
const EXPIRY_SKEW_MS = 60_000;

export class ConnectionReauthError extends Error {
  readonly status = 409;
  readonly connectionId: string;
  constructor(connectionId: string, message: string) {
    super(message);
    this.name = "ConnectionReauthError";
    this.connectionId = connectionId;
  }
}

export interface TokenManagerOptions {
  database?: Database;
  cryptor?: Cryptor;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Return a valid access token for a connection, refreshing it if it is expired
 * or about to expire. On a failed/absent refresh the connection is flagged
 * `needs_reauth` and a ConnectionReauthError is thrown so callers can escalate
 * (rather than guessing availability).
 */
export async function getValidAccessToken(
  ctx: TenantContext,
  connectionId: string,
  opts: TokenManagerOptions = {},
): Promise<string> {
  const database = opts.database ?? getDb();
  const cryptor = opts.cryptor ?? getCryptor();
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;

  const conn = await getConnectionInternal(ctx, connectionId, database);
  if (!conn) throw new TenantError("Connection not found", 404);
  if (conn.status === "revoked" || !conn.accessTokenEnc) {
    throw new ConnectionReauthError(connectionId, "Connection is revoked; reconnect required");
  }

  const provider = conn.provider as ConnectionProvider;
  const expiresAt = conn.tokenExpiresAt ? conn.tokenExpiresAt.getTime() : Infinity;
  const stillValid = expiresAt - now() > EXPIRY_SKEW_MS;

  if (stillValid) {
    return decryptToken(ctx, provider, conn.accessTokenEnc, cryptor);
  }

  // Needs refresh.
  if (!conn.refreshTokenEnc) {
    await markNeedsReauth(ctx, connectionId, database);
    throw new ConnectionReauthError(connectionId, "Access token expired and no refresh token");
  }

  try {
    const refreshToken = decryptToken(ctx, provider, conn.refreshTokenEnc, cryptor);
    const tokens = await refreshAccessToken({
      provider,
      credentials: resolveCredentials(provider, env),
      refreshToken,
      fetchImpl: opts.fetchImpl ?? fetch,
    });
    await updateStoredTokens(
      ctx,
      connectionId,
      provider,
      {
        accessToken: tokens.accessToken,
        // Some providers rotate the refresh token; persist it if returned.
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
      },
      database,
      cryptor,
    );
    return tokens.accessToken;
  } catch (err) {
    await markNeedsReauth(ctx, connectionId, database);
    throw new ConnectionReauthError(
      connectionId,
      `Token refresh failed: ${(err as Error).message}`,
    );
  }
}
