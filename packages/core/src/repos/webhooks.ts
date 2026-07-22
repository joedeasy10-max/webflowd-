import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { webhookEvents } from "../db/schema.js";

/**
 * Claim a provider webhook event for processing. Returns true if this call
 * inserted the row (first delivery), false if it already existed (a retry/dupe).
 * Global table — not tenant-scoped.
 */
export async function claimWebhookEvent(
  provider: string,
  providerEventId: string,
  database: Database = getDb(),
): Promise<boolean> {
  const rows = await database
    .insert(webhookEvents)
    .values({ provider, providerEventId, status: "processing" })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.providerEventId] })
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}

export async function markWebhookProcessed(
  provider: string,
  providerEventId: string,
  database: Database = getDb(),
): Promise<void> {
  await database
    .update(webhookEvents)
    .set({ status: "processed", processedAt: new Date() })
    .where(
      and(eq(webhookEvents.provider, provider), eq(webhookEvents.providerEventId, providerEventId)),
    );
}

/** Release a claimed event (delete the row) so a failed delivery can be retried. */
export async function releaseWebhookEvent(
  provider: string,
  providerEventId: string,
  database: Database = getDb(),
): Promise<void> {
  await database
    .delete(webhookEvents)
    .where(
      and(eq(webhookEvents.provider, provider), eq(webhookEvents.providerEventId, providerEventId)),
    );
}
