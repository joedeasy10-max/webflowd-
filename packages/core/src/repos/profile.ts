import { eq } from "drizzle-orm";
import type { BusinessProfileInput } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { businessProfiles } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import type { TenantContext } from "../tenancy/index.js";

export async function getProfile(ctx: TenantContext, database: Database = getDb()) {
  const row = await database.query.businessProfiles.findFirst({
    where: eq(businessProfiles.tenantId, ctx.tenantId),
  });
  return row ?? null;
}

/** Create or update the single business profile for a tenant. */
export async function upsertProfile(
  ctx: TenantContext,
  input: BusinessProfileInput,
  database: Database = getDb(),
) {
  const values = { tenantId: ctx.tenantId, ...input, serviceArea: input.serviceArea ?? null };
  const [row] = await database
    .insert(businessProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: businessProfiles.tenantId,
      set: { ...input, serviceArea: input.serviceArea ?? null },
    })
    .returning();

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "profile.updated",
      entityType: "business_profile",
      entityId: row!.id,
      metadata: { displayName: input.displayName },
    },
    database,
  );
  return row!;
}
