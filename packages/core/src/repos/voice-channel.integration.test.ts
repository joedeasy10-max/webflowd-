import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "./tenant.js";
import { getVoiceChannel, resolveChannelByIdentifier, upsertVoiceChannel } from "./channels.js";
import type { TenantContext } from "../tenancy/index.js";

describe("voice channel", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|ph", email: "joe@plumb.co" }, db);
  });

  it("creates then updates a single voice channel (idempotent per tenant)", async () => {
    await upsertVoiceChannel(
      ctx,
      { identifier: "+441234567890", enabled: true, config: { voice: "Polly.Amy" } },
      db,
    );
    await upsertVoiceChannel(
      ctx,
      { identifier: "+449999999999", enabled: false, config: { voice: "Polly.Brian" } },
      db,
    );

    const ch = await getVoiceChannel(ctx, db);
    expect(ch).not.toBeNull();
    expect(ch!.identifier).toBe("+449999999999");
    expect(ch!.enabled).toBe(false);
    expect((ch!.inboundConfig as { voice: string }).voice).toBe("Polly.Brian");
  });

  it("resolves the tenant from the saved number when enabled", async () => {
    await upsertVoiceChannel(ctx, { identifier: "+441111111111", enabled: true, config: {} }, db);
    const resolved = await resolveChannelByIdentifier("voice", "+441111111111", db);
    expect(resolved?.tenantId).toBe(ctx.tenantId);
  });

  it("does not resolve a disabled number", async () => {
    await upsertVoiceChannel(ctx, { identifier: "+442222222222", enabled: false, config: {} }, db);
    const resolved = await resolveChannelByIdentifier("voice", "+442222222222", db);
    expect(resolved).toBeNull();
  });
});
