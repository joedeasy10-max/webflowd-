import { and, eq } from "drizzle-orm";
import type { BusinessHoursInput, HoursExceptionInput } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { businessHours, hoursExceptions } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { TenantError, type TenantContext } from "../tenancy/index.js";

export async function getHours(ctx: TenantContext, database: Database = getDb()) {
  return database.query.businessHours.findMany({
    where: eq(businessHours.tenantId, ctx.tenantId),
    orderBy: (h, { asc }) => [asc(h.weekday)],
  });
}

/** Replace the whole weekly schedule atomically. */
export async function setHours(
  ctx: TenantContext,
  rows: BusinessHoursInput,
  database: Database = getDb(),
) {
  await database.transaction(async (tx) => {
    await tx.delete(businessHours).where(eq(businessHours.tenantId, ctx.tenantId));
    if (rows.length > 0) {
      await tx.insert(businessHours).values(
        rows.map((r) => ({
          tenantId: ctx.tenantId,
          weekday: r.weekday,
          closed: r.closed,
          open: r.closed ? null : (r.open ?? null),
          close: r.closed ? null : (r.close ?? null),
        })),
      );
    }
  });
  await writeAudit(
    { tenantId: ctx.tenantId, actor: ctx.userId, action: "hours.updated", entityType: "business_hours" },
    database,
  );
  return getHours(ctx, database);
}

export async function listExceptions(ctx: TenantContext, database: Database = getDb()) {
  return database.query.hoursExceptions.findMany({
    where: eq(hoursExceptions.tenantId, ctx.tenantId),
    orderBy: (h, { asc }) => [asc(h.date)],
  });
}

export async function upsertException(
  ctx: TenantContext,
  input: HoursExceptionInput,
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(hoursExceptions)
    .values({
      tenantId: ctx.tenantId,
      date: input.date,
      closed: input.closed,
      open: input.closed ? null : (input.open ?? null),
      close: input.closed ? null : (input.close ?? null),
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [hoursExceptions.tenantId, hoursExceptions.date],
      set: {
        closed: input.closed,
        open: input.closed ? null : (input.open ?? null),
        close: input.closed ? null : (input.close ?? null),
        note: input.note ?? null,
      },
    })
    .returning();
  await writeAudit(
    { tenantId: ctx.tenantId, actor: ctx.userId, action: "hours.updated", entityType: "hours_exception", entityId: row!.id },
    database,
  );
  return row!;
}

export async function deleteException(
  ctx: TenantContext,
  date: string,
  database: Database = getDb(),
) {
  const rows = await database
    .delete(hoursExceptions)
    .where(and(eq(hoursExceptions.tenantId, ctx.tenantId), eq(hoursExceptions.date, date)))
    .returning({ id: hoursExceptions.id });
  if (rows.length === 0) throw new TenantError("Exception not found", 404);
}
