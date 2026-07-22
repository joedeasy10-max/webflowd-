import { eq, type Column } from "drizzle-orm";
import type { UserRole } from "@webflowd/shared";
import { withTenantContext, type Database } from "../db/client.js";

/**
 * The identity + tenant every authenticated request runs under. Tenant is
 * resolved from a trusted source (Auth0 `sub`, widget public key, or channel
 * identifier) — NEVER from model output or customer-supplied input.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}

export class TenantError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "TenantError";
    this.status = status;
  }
}

/** Throw unless the context's role is one of `allowed`. */
export function requireRole(ctx: TenantContext, allowed: readonly UserRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new TenantError(`Requires role: ${allowed.join(" or ")}`, 403);
  }
}

/** WHERE fragment binding a tenant-scoped table to the current tenant. */
export function eqTenant(tenantIdColumn: Column, ctx: TenantContext) {
  return eq(tenantIdColumn, ctx.tenantId);
}

/**
 * Defence-in-depth guard for reads: assert a returned row belongs to the
 * current tenant. Any mismatch is a bug or an isolation breach — fail loudly.
 */
export function guardRow<T extends { tenantId: string | null }>(
  ctx: TenantContext,
  row: T | null | undefined,
): T | null {
  if (row == null) return null;
  if (row.tenantId !== ctx.tenantId) {
    throw new TenantError("Cross-tenant access blocked", 403);
  }
  return row;
}

export function guardRows<T extends { tenantId: string | null }>(
  ctx: TenantContext,
  rows: T[],
): T[] {
  for (const row of rows) guardRow(ctx, row);
  return rows;
}

/**
 * Run tenant-scoped work inside a transaction with the RLS session variable
 * set. All repository operations for a request should go through here so that
 * (a) the app-level tenant filter and (b) Postgres RLS both apply.
 */
export async function runInTenant<T>(
  ctx: TenantContext,
  fn: (tx: Database, ctx: TenantContext) => Promise<T>,
  database?: Database,
): Promise<T> {
  return withTenantContext(ctx.tenantId, (tx) => fn(tx, ctx), database);
}
