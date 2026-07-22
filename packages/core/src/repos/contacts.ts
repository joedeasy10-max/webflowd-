import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { contacts } from "../db/schema.js";
import type { TenantContext } from "../tenancy/index.js";

export interface ContactIdentity {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}

/**
 * Find an existing contact by email or phone within the tenant, or create one.
 * Best-effort de-duplication; contacts are per-tenant.
 */
export async function findOrCreateContact(
  ctx: TenantContext,
  identity: ContactIdentity,
  database: Database = getDb(),
) {
  const email = identity.email?.trim().toLowerCase() || null;
  const phone = identity.phone?.trim() || null;

  if (email) {
    const byEmail = await database.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.email, email)),
    });
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = await database.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.phone, phone)),
    });
    if (byPhone) return byPhone;
  }

  const [row] = await database
    .insert(contacts)
    .values({
      tenantId: ctx.tenantId,
      name: identity.name ?? null,
      email,
      phone,
      whatsapp: identity.whatsapp ?? null,
    })
    .returning();
  return row!;
}
