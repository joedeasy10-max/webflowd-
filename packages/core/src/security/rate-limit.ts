import { sql } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { rateLimits } from "../db/schema.js";

export interface RateLimitOptions {
  /** Stable identifier for the bucket, e.g. `chat:<publicKey>` or `ip:<addr>`. */
  key: string;
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
}

/**
 * Fixed-window rate limit backed by Postgres. Atomic per window via an upsert
 * that increments the counter; concurrent calls serialise on the unique
 * (key, window_start) row. Suitable for the request volumes of public webhook
 * and chat-widget endpoints. (For very high volume, swap the store for Redis.)
 */
export async function checkRateLimit(
  opts: RateLimitOptions,
  database: Database = getDb(),
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  const rows = await database
    .insert(rateLimits)
    .values({ key: opts.key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = rows[0]?.count ?? 1;
  const allowed = count <= opts.limit;
  return {
    allowed,
    remaining: Math.max(0, opts.limit - count),
    limit: opts.limit,
    resetAt,
  };
}
