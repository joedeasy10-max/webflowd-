import { and, eq } from "drizzle-orm";
import type { ServiceInput } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { services } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { guardRow, TenantError, type TenantContext } from "../tenancy/index.js";

export async function listServices(ctx: TenantContext, database: Database = getDb()) {
  return database.query.services.findMany({
    where: eq(services.tenantId, ctx.tenantId),
    orderBy: (s, { asc }) => [asc(s.name)],
  });
}

export async function createService(
  ctx: TenantContext,
  input: ServiceInput,
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(services)
    .values({ tenantId: ctx.tenantId, ...input })
    .returning();
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "service.created",
      entityType: "service",
      entityId: row!.id,
      metadata: { name: input.name },
    },
    database,
  );
  return row!;
}

export async function updateService(
  ctx: TenantContext,
  serviceId: string,
  patch: Partial<ServiceInput>,
  database: Database = getDb(),
) {
  const rows = await database
    .update(services)
    .set(patch)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, ctx.tenantId)))
    .returning();
  const row = guardRow(ctx, rows[0]);
  if (!row) throw new TenantError("Service not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "service.updated",
      entityType: "service",
      entityId: serviceId,
    },
    database,
  );
  return row;
}

export async function deleteService(
  ctx: TenantContext,
  serviceId: string,
  database: Database = getDb(),
) {
  const rows = await database
    .delete(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, ctx.tenantId)))
    .returning({ id: services.id });
  if (rows.length === 0) throw new TenantError("Service not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "service.deleted",
      entityType: "service",
      entityId: serviceId,
    },
    database,
  );
}
