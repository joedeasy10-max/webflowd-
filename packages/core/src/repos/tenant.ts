import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { bookingRules, businessHours, channels, tenants, users } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { generateChatPublicKey } from "./channels.js";
import type { TenantContext } from "../tenancy/index.js";

export interface Auth0Identity {
  sub: string;
  email: string;
  /** Optional business name captured at signup; falls back to a placeholder. */
  name?: string;
}

/** Default Mon–Fri 08:00–17:00, weekends closed. */
export function defaultWeeklyHours(tenantId: string) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const isWeekend = weekday === 0 || weekday === 6;
    return {
      tenantId,
      weekday,
      closed: isWeekend,
      open: isWeekend ? null : "08:00",
      close: isWeekend ? null : "17:00",
    };
  });
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${base || "business"}-${randomUUID().slice(0, 8)}`;
}

/** Look up the tenant context for an Auth0 subject, or null if not provisioned. */
export async function getContextForAuth0Sub(
  sub: string,
  database: Database = getDb(),
): Promise<TenantContext | null> {
  const row = await database.query.users.findFirst({
    where: eq(users.auth0Sub, sub),
    columns: { id: true, tenantId: true, role: true },
  });
  if (!row) return null;
  return { tenantId: row.tenantId, userId: row.id, role: row.role };
}

/**
 * Idempotently provision a tenant for a first-time Auth0 user: creates the
 * tenant, an `owner` user, default booking rules, and a default weekly
 * schedule. Returns the tenant context. Safe to call on every login — if the
 * user already exists it just updates `last_login_at`.
 */
export async function provisionTenant(
  identity: Auth0Identity,
  database: Database = getDb(),
): Promise<TenantContext> {
  const existing = await getContextForAuth0Sub(identity.sub, database);
  if (existing) {
    await database
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, existing.userId));
    return existing;
  }

  const businessName = identity.name?.trim() || identity.email.split("@")[0] || "New business";

  return database.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: businessName, slug: slugify(businessName) })
      .returning({ id: tenants.id });
    const tenantId = tenant!.id;

    const [user] = await tx
      .insert(users)
      .values({
        tenantId,
        auth0Sub: identity.sub,
        email: identity.email,
        role: "owner",
        lastLoginAt: new Date(),
      })
      .returning({ id: users.id });

    await tx.insert(bookingRules).values({ tenantId });
    await tx.insert(businessHours).values(defaultWeeklyHours(tenantId));
    // Seed a chat-widget channel so the owner has an embeddable public key.
    await tx
      .insert(channels)
      .values({ tenantId, type: "chat", publicKey: generateChatPublicKey(), enabled: true });

    await writeAudit(
      {
        tenantId,
        actor: "system",
        action: "tenant.provisioned",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { email: identity.email },
      },
      tx as unknown as Database,
    );

    return { tenantId, userId: user!.id, role: "owner" as const };
  });
}
