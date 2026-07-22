import { eq } from "drizzle-orm";
import type { BookingRulesInput } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { bookingRules } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import type { TenantContext } from "../tenancy/index.js";

export async function getBookingRules(ctx: TenantContext, database: Database = getDb()) {
  const row = await database.query.bookingRules.findFirst({
    where: eq(bookingRules.tenantId, ctx.tenantId),
  });
  return row ?? null;
}

export async function upsertBookingRules(
  ctx: TenantContext,
  input: Partial<BookingRulesInput>,
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(bookingRules)
    .values({ tenantId: ctx.tenantId, ...input })
    .onConflictDoUpdate({ target: bookingRules.tenantId, set: input })
    .returning();
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "booking_rules.updated",
      entityType: "booking_rules",
      entityId: row!.id,
    },
    database,
  );
  return row!;
}
