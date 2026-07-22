import { describe, expect, it } from "vitest";
import { guardRow, guardRows, requireRole, TenantError, type TenantContext } from "./index.js";

const ctx: TenantContext = { tenantId: "t1", userId: "u1", role: "owner" };

describe("requireRole", () => {
  it("allows a permitted role", () => {
    expect(() => requireRole(ctx, ["owner", "admin"])).not.toThrow();
  });
  it("blocks a disallowed role", () => {
    const staff: TenantContext = { ...ctx, role: "staff" };
    expect(() => requireRole(staff, ["owner"])).toThrow(TenantError);
  });
});

describe("guardRow / guardRows", () => {
  it("passes rows owned by the tenant", () => {
    expect(guardRow(ctx, { tenantId: "t1", x: 1 })).toEqual({ tenantId: "t1", x: 1 });
    expect(guardRows(ctx, [{ tenantId: "t1" }, { tenantId: "t1" }])).toHaveLength(2);
  });

  it("throws on a cross-tenant row", () => {
    expect(() => guardRow(ctx, { tenantId: "t2" })).toThrow(TenantError);
    expect(() => guardRows(ctx, [{ tenantId: "t1" }, { tenantId: "t2" }])).toThrow(TenantError);
  });

  it("returns null for missing rows", () => {
    expect(guardRow(ctx, null)).toBeNull();
    expect(guardRow(ctx, undefined)).toBeNull();
  });
});
