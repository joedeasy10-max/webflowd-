import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { connections as connectionsTable } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { Cryptor } from "../crypto/index.js";
import { provisionTenant } from "./tenant.js";
import { decryptToken, listConnections, revokeConnection, storeConnection } from "./connections.js";
import { ConnectionReauthError, getValidAccessToken } from "../channels/oauth/token-manager.js";
import type { TenantContext } from "../tenancy/index.js";

const cryptor = new Cryptor({ currentVersion: 1, keys: { 1: randomBytes(32) } });
const ENV = {
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  APP_BASE_URL: "https://webflowd.com",
} as NodeJS.ProcessEnv;

function futureDate(msFromNow: number) {
  return new Date(Date.now() + msFromNow);
}

describe("connections storage", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
  });

  it("stores tokens encrypted at rest and never returns them", async () => {
    const safe = await storeConnection(
      ctx,
      {
        provider: "google",
        externalAccountId: "joe@plumb.co",
        scopes: ["calendar"],
        accessToken: "ACCESS-123",
        refreshToken: "REFRESH-456",
        tokenExpiresAt: futureDate(3600_000),
      },
      db,
      cryptor,
    );

    expect(safe).not.toHaveProperty("accessTokenEnc");
    expect(safe.provider).toBe("google");

    // On-disk ciphertext must not contain the plaintext, but must decrypt back.
    const [row] = await db.select().from(connectionsTable);
    expect(row!.accessTokenEnc).not.toContain("ACCESS-123");
    expect(decryptToken(ctx, "google", row!.accessTokenEnc!, cryptor)).toBe("ACCESS-123");
    expect(decryptToken(ctx, "google", row!.refreshTokenEnc!, cryptor)).toBe("REFRESH-456");

    const list = await listConnections(ctx, db);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("ACCESS-123");
  });

  it("revokes a connection and wipes token ciphertext", async () => {
    const safe = await storeConnection(
      ctx,
      { provider: "google", accessToken: "A", refreshToken: "R" },
      db,
      cryptor,
    );
    await revokeConnection(ctx, safe.id, db);
    const [row] = await db.select().from(connectionsTable);
    expect(row!.status).toBe("revoked");
    expect(row!.accessTokenEnc).toBeNull();
    expect(row!.refreshTokenEnc).toBeNull();
  });
});

describe("token manager", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
  });

  it("returns the stored token while it is still valid", async () => {
    const safe = await storeConnection(
      ctx,
      { provider: "google", accessToken: "STILL-GOOD", tokenExpiresAt: futureDate(3600_000) },
      db,
      cryptor,
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const token = await getValidAccessToken(ctx, safe.id, {
      database: db,
      cryptor,
      env: ENV,
      fetchImpl,
    });
    expect(token).toBe("STILL-GOOD");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the new one", async () => {
    const safe = await storeConnection(
      ctx,
      {
        provider: "google",
        accessToken: "OLD",
        refreshToken: "REFRESH",
        tokenExpiresAt: new Date(Date.now() - 1000),
      },
      db,
      cryptor,
    );
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "NEW", expires_in: 3600 }),
    })) as unknown as typeof fetch;

    const token = await getValidAccessToken(ctx, safe.id, {
      database: db,
      cryptor,
      env: ENV,
      fetchImpl,
    });
    expect(token).toBe("NEW");

    const [row] = await db.select().from(connectionsTable);
    expect(decryptToken(ctx, "google", row!.accessTokenEnc!, cryptor)).toBe("NEW");
  });

  it("marks the connection needs_reauth when refresh fails", async () => {
    const safe = await storeConnection(
      ctx,
      {
        provider: "google",
        accessToken: "OLD",
        refreshToken: "BAD",
        tokenExpiresAt: new Date(Date.now() - 1000),
      },
      db,
      cryptor,
    );
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    })) as unknown as typeof fetch;

    await expect(
      getValidAccessToken(ctx, safe.id, { database: db, cryptor, env: ENV, fetchImpl }),
    ).rejects.toBeInstanceOf(ConnectionReauthError);

    const [row] = await db.select().from(connectionsTable);
    expect(row!.status).toBe("needs_reauth");
  });
});
