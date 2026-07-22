import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { escalations } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { TenantError, type TenantContext } from "../tenancy/index.js";

/** Open a human-review escalation for a conversation and audit it. */
export async function openEscalation(
  ctx: TenantContext,
  input: { conversationId: string; reason: string; summary?: string },
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(escalations)
    .values({
      tenantId: ctx.tenantId,
      conversationId: input.conversationId,
      reason: input.reason,
      summary: input.summary ?? null,
      status: "open",
    })
    .returning();
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "ai",
      action: "escalation.opened",
      entityType: "escalation",
      entityId: row!.id,
      metadata: { reason: input.reason },
    },
    database,
  );
  return row!;
}

export async function listEscalations(
  ctx: TenantContext,
  status: "open" | "resolved" | undefined,
  database: Database = getDb(),
) {
  return database.query.escalations.findMany({
    where: status
      ? and(eq(escalations.tenantId, ctx.tenantId), eq(escalations.status, status))
      : eq(escalations.tenantId, ctx.tenantId),
    orderBy: (e, { desc }) => [desc(e.createdAt)],
  });
}

export async function resolveEscalation(
  ctx: TenantContext,
  escalationId: string,
  database: Database = getDb(),
) {
  const rows = await database
    .update(escalations)
    .set({ status: "resolved", resolvedBy: ctx.userId, resolvedAt: new Date() })
    .where(and(eq(escalations.id, escalationId), eq(escalations.tenantId, ctx.tenantId)))
    .returning({ id: escalations.id });
  if (rows.length === 0) throw new TenantError("Escalation not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "escalation.resolved",
      entityType: "escalation",
      entityId: escalationId,
    },
    database,
  );
}
