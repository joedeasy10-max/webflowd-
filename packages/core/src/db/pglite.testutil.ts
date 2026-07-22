/**
 * Shared PGlite (in-process Postgres) harness for integration tests. Applies the
 * real migrations and provides a Drizzle client plus a restricted role so RLS is
 * actually enforced. Not part of the published build (see tsconfig.build).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";
import type { Database } from "./client.js";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

export async function freshTestDb(): Promise<{ client: PGlite; db: Database }> {
  const client = new PGlite();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await client.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
  }
  await client.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
  `);
  const db = drizzle(client, { schema }) as unknown as Database;
  return { client, db };
}

/** Run a SELECT as the restricted app_user with a tenant GUC set; return rows. */
export async function selectAsTenant(client: PGlite, tenantId: string, selectSql: string) {
  const results = await client.exec(`
    BEGIN;
    SET LOCAL ROLE app_user;
    SET LOCAL app.tenant_id = '${tenantId}';
    ${selectSql};
    ROLLBACK;
  `);
  return results.flatMap((r) => r.rows ?? []);
}
