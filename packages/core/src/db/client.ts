import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import * as schema from "./schema.js";

// The neon-serverless (WebSocket Pool) driver is used rather than neon-http
// because we need real interactive transactions — for tenant provisioning, the
// atomic hours replace, and setting the `app.tenant_id` GUC that RLS relies on.
// In Node 22 a global WebSocket exists; fall back to `ws` where it doesn't.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

export type Database = NeonDatabase<typeof schema>;

let pool: Pool | null = null;
let db: Database | null = null;

/** Process-wide Drizzle client (reused across warm invocations). */
export function getDb(connectionString = process.env.DATABASE_URL): Database {
  if (db) return db;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  pool = new Pool({ connectionString });
  db = drizzle(pool, { schema });
  return db;
}

/** For tests/tooling that need a fresh, isolated client. */
export function createDb(connectionString: string): Database {
  return drizzle(new Pool({ connectionString }), { schema });
}

/**
 * Run work inside a transaction with the RLS session variable `app.tenant_id`
 * set, so Postgres row-level-security policies enforce tenant isolation as
 * defence-in-depth beneath the application-level tenancy guard.
 *
 * `set_config(..., true)` scopes the setting to this transaction only.
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
