import { and, eq } from "drizzle-orm";
import type { KnowledgeItemInput } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { knowledgeItems } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { TenantError, type TenantContext } from "../tenancy/index.js";

export async function listKnowledge(ctx: TenantContext, database: Database = getDb()) {
  return database.query.knowledgeItems.findMany({
    where: eq(knowledgeItems.tenantId, ctx.tenantId),
    orderBy: (k, { desc }) => [desc(k.updatedAt)],
  });
}

export async function createKnowledge(
  ctx: TenantContext,
  input: KnowledgeItemInput,
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(knowledgeItems)
    .values({
      tenantId: ctx.tenantId,
      question: input.question,
      answer: input.answer,
      tags: input.tags,
      active: input.active,
    })
    .returning();
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "knowledge.created",
      entityType: "knowledge_item",
      entityId: row!.id,
    },
    database,
  );
  return row!;
}

export async function updateKnowledge(
  ctx: TenantContext,
  itemId: string,
  patch: Partial<KnowledgeItemInput>,
  database: Database = getDb(),
) {
  const rows = await database
    .update(knowledgeItems)
    .set(patch)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.tenantId, ctx.tenantId)))
    .returning();
  if (rows.length === 0) throw new TenantError("Knowledge item not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "knowledge.updated",
      entityType: "knowledge_item",
      entityId: itemId,
    },
    database,
  );
  return rows[0]!;
}

export async function deleteKnowledge(
  ctx: TenantContext,
  itemId: string,
  database: Database = getDb(),
) {
  const rows = await database
    .delete(knowledgeItems)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.tenantId, ctx.tenantId)))
    .returning({ id: knowledgeItems.id });
  if (rows.length === 0) throw new TenantError("Knowledge item not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "knowledge.deleted",
      entityType: "knowledge_item",
      entityId: itemId,
    },
    database,
  );
}
