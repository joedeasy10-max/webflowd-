import { beforeEach, describe, expect, it } from "vitest";
import { skillManifestSchema } from "@webflowd/shared";
import type { Database } from "../db/client.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "./tenant.js";
import { exportSkills, listSkills, upsertSkillFromManifest } from "./skills.js";
import type { TenantContext } from "../tenancy/index.js";

describe("exportSkills", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|exp", email: "joe@plumb.co" }, db);
    await upsertSkillFromManifest(
      ctx,
      skillManifestSchema.parse({
        key: "after-hours",
        name: "After hours",
        instructions: "Be reassuring after hours.",
      }),
      "uploaded",
      db,
    );
    await upsertSkillFromManifest(
      ctx,
      skillManifestSchema.parse({
        key: "deposits",
        name: "Deposits",
        category: "feature",
        instructions: "Explain deposits.",
        featureFlags: ["deposits"],
        enabled: false,
      }),
      "uploaded",
      db,
    );
  });

  it("exports every installed skill as a valid manifest", async () => {
    const exported = await exportSkills(ctx, db);
    expect(exported).toHaveLength(2);
    // Each exported item must itself be a valid manifest.
    for (const m of exported) {
      expect(skillManifestSchema.safeParse(m).success).toBe(true);
    }
  });

  it("preserves the key fields (flags, enabled state, instructions)", async () => {
    const exported = await exportSkills(ctx, db);
    const deposits = exported.find((m) => m.key === "deposits")!;
    expect(deposits.featureFlags).toEqual(["deposits"]);
    expect(deposits.enabled).toBe(false);
    const afterHours = exported.find((m) => m.key === "after-hours")!;
    expect(afterHours.instructions).toBe("Be reassuring after hours.");
    expect(afterHours.enabled).toBe(true);
  });

  it("round-trips: exported manifests re-import into another client unchanged", async () => {
    const exported = await exportSkills(ctx, db);
    const other = await provisionTenant({ sub: "auth0|clone", email: "b@x.co" }, db);
    for (const m of exported) {
      await upsertSkillFromManifest(other, m, "uploaded", db);
    }
    const cloned = await listSkills(other, db);
    expect(cloned.map((s) => s.key).sort()).toEqual(["after-hours", "deposits"]);
    const clonedDeposits = cloned.find((s) => s.key === "deposits")!;
    expect(clonedDeposits.enabled).toBe(false);
    expect((clonedDeposits.config as { featureFlags: string[] }).featureFlags).toEqual([
      "deposits",
    ]);
  });
});
