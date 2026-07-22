/**
 * Integration tests against a real Postgres running in-process (PGlite/WASM).
 * These apply the actual migrations — schema, RLS policies, and the audit
 * append-only trigger — then exercise provisioning, CRUD, tenant isolation, and
 * database-level RLS. No external database or secrets required.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ServiceInput } from "@webflowd/shared";
import * as schema from "./schema.js";
import type { Database } from "./client.js";
import { getProfile, upsertProfile } from "../repos/profile.js";
import { createService, listServices } from "../repos/services.js";
import { getBookingRules, getHours, provisionTenant } from "../repos/index.js";
import { runInTenant, type TenantContext } from "../tenancy/index.js";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

const SAMPLE_SERVICE: ServiceInput = {
  name: "Boiler service",
  defaultDurationMin: 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  depositRequired: false,
  active: true,
};

async function freshDb(): Promise<{ client: PGlite; db: Database }> {
  const client = new PGlite();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await client.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
  }
  // A non-superuser role so RLS is actually enforced (superusers bypass RLS).
  await client.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
  `);
  const db = drizzle(client, { schema }) as unknown as Database;
  return { client, db };
}

/** Run a script as the restricted app_user with a tenant GUC, return SELECTed rows. */
async function asTenant(client: PGlite, tenantId: string, selectSql: string) {
  const results = await client.exec(`
    BEGIN;
    SET LOCAL ROLE app_user;
    SET LOCAL app.tenant_id = '${tenantId}';
    ${selectSql};
    ROLLBACK;
  `);
  return results.flatMap((r) => r.rows ?? []);
}

describe("provisioning", () => {
  let db: Database;
  beforeEach(async () => {
    ({ db } = await freshDb());
  });

  it("creates tenant, owner, booking rules and a default week", async () => {
    const ctx = await provisionTenant(
      { sub: "auth0|1", email: "joe@plumb.co", name: "Joe Plumbing" },
      db,
    );
    expect(ctx.role).toBe("owner");

    const rules = await runInTenant(ctx, (tx) => getBookingRules(ctx, tx), db);
    expect(rules?.slotGranularityMin).toBe(30);

    const hours = await runInTenant(ctx, (tx) => getHours(ctx, tx), db);
    expect(hours).toHaveLength(7);
    expect(hours.find((h) => h.weekday === 1)?.open).toBe("08:00:00");
    expect(hours.find((h) => h.weekday === 0)?.closed).toBe(true);
  });

  it("is idempotent for a returning user", async () => {
    const a = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
    const b = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
    expect(b.tenantId).toBe(a.tenantId);
    expect(b.userId).toBe(a.userId);
  });

  it("records an audit entry for provisioning", async () => {
    await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
    const rows = await db.select().from(schema.auditLog);
    expect(rows.some((r) => r.action === "tenant.provisioned")).toBe(true);
  });
});

describe("CRUD roundtrip", () => {
  it("upserts a profile and creates a service scoped to the tenant", async () => {
    const { db } = await freshDb();
    const ctx = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);

    await runInTenant(ctx, (tx) => upsertProfile(ctx, { displayName: "Joe's Plumbing" }, tx), db);
    const profile = await runInTenant(ctx, (tx) => getProfile(ctx, tx), db);
    expect(profile?.displayName).toBe("Joe's Plumbing");

    await runInTenant(ctx, (tx) => createService(ctx, SAMPLE_SERVICE, tx), db);
    const services = await runInTenant(ctx, (tx) => listServices(ctx, tx), db);
    expect(services).toHaveLength(1);
    expect(services[0]?.name).toBe("Boiler service");
  });
});

describe("tenant isolation", () => {
  let db: Database;
  let client: PGlite;
  let a: TenantContext;
  let b: TenantContext;

  beforeEach(async () => {
    ({ db, client } = await freshDb());
    a = await provisionTenant({ sub: "auth0|A", email: "a@x.com" }, db);
    b = await provisionTenant({ sub: "auth0|B", email: "b@x.com" }, db);
    await runInTenant(a, (tx) => createService(a, SAMPLE_SERVICE, tx), db);
  });

  it("app-level filter: tenant B cannot list tenant A's services", async () => {
    const bServices = await runInTenant(b, (tx) => listServices(b, tx), db);
    expect(bServices).toHaveLength(0);
    const aServices = await runInTenant(a, (tx) => listServices(a, tx), db);
    expect(aServices).toHaveLength(1);
  });

  it("RLS: an unfiltered query only sees the current tenant's rows", async () => {
    const seenByA = await asTenant(client, a.tenantId, "SELECT count(*)::int AS c FROM services");
    const seenByB = await asTenant(client, b.tenantId, "SELECT count(*)::int AS c FROM services");
    expect((seenByA[0] as { c: number }).c).toBe(1);
    expect((seenByB[0] as { c: number }).c).toBe(0);
  });

  it("RLS WITH CHECK: cannot insert a row for another tenant", async () => {
    await expect(
      client.exec(`
        BEGIN;
        SET LOCAL ROLE app_user;
        SET LOCAL app.tenant_id = '${b.tenantId}';
        INSERT INTO services (tenant_id, name, default_duration_min)
          VALUES ('${a.tenantId}', 'sneaky', 30);
        ROLLBACK;
      `),
    ).rejects.toThrow();
  });
});

describe("audit log is append-only", () => {
  it("blocks UPDATE and DELETE at the database level", async () => {
    const { db, client } = await freshDb();
    await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
    await expect(client.exec("UPDATE audit_log SET action = 'x'")).rejects.toThrow(/append-only/);
    await expect(client.exec("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
  });
});
