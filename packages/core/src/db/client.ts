import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

export type Database = NeonHttpDatabase<typeof schema>;

let db: Database | null = null;

/** Process-wide Drizzle client over Neon's serverless HTTP driver. */
export function getDb(connectionString = process.env.DATABASE_URL): Database {
  if (db) return db;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const sqlClient = neon(connectionString);
  db = drizzle(sqlClient, { schema });
  return db;
}

/** For tests/tooling that need a fresh, isolated client. */
export function createDb(connectionString: string): Database {
  return drizzle(neon(connectionString), { schema });
}

/**
 * Run work inside a transaction with the RLS session variable `app.tenant_id`
 * set, so Postgres row-level-security policies enforce tenant isolation as
 * defence-in-depth beneath the application-level tenancy guard.
 *
 * `set_config(..., true)` scopes the setting to the transaction only.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
  database: Database = getDb(),
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Database);
  });
}

export { schema };
