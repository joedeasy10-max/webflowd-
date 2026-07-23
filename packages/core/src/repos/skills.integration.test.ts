import { beforeEach, describe, expect, it } from "vitest";
import { skillManifestSchema } from "@webflowd/shared";
import type { PGlite } from "@electric-sql/pglite";
import type { Database } from "../db/client.js";
import { freshTestDb, selectAsTenant } from "../db/pglite.testutil.js";
import { provisionTenant } from "./tenant.js";
import {
  deleteSkill,
  listSkills,
  loadActiveFeatureFlags,
  loadEnabledSkillInstructions,
  setSkillEnabled,
  upsertSkillFromManifest,
} from "./skills.js";
import type { TenantContext } from "../tenancy/index.js";

function manifest(over: Record<string, unknown>) {
  return skillManifestSchema.parse({
    key: "k",
    name: "Skill",
    instructions: "do a thing",
    ...over,
  });
}

describe("skills repo", () => {
  let client: PGlite;
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ client, db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|sk", email: "joe@plumb.co" }, db);
  });

  it("installs, updates (upsert), toggles and deletes a skill", async () => {
    await upsertSkillFromManifest(
      ctx,
      manifest({ key: "greeting", name: "Greeting" }),
      "uploaded",
      db,
    );
    // Re-upload same key updates in place.
    await upsertSkillFromManifest(
      ctx,
      manifest({ key: "greeting", name: "Greeting v2", instructions: "updated" }),
      "uploaded",
      db,
    );
    let rows = await listSkills(ctx, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Greeting v2");

    await setSkillEnabled(ctx, "greeting", false, db);
    expect(await loadEnabledSkillInstructions(ctx, db)).toHaveLength(0);

    await setSkillEnabled(ctx, "greeting", true, db);
    expect((await loadEnabledSkillInstructions(ctx, db))[0]!.instructions).toBe("updated");

    await deleteSkill(ctx, "greeting", db);
    rows = await listSkills(ctx, db);
    expect(rows).toHaveLength(0);
  });

  it("collects active feature flags from enabled skills only", async () => {
    await upsertSkillFromManifest(
      ctx,
      manifest({ key: "dep", name: "Deposits", featureFlags: ["deposits"] }),
      "uploaded",
      db,
    );
    await upsertSkillFromManifest(
      ctx,
      manifest({ key: "voice", name: "Voice", featureFlags: ["voice"], enabled: false }),
      "uploaded",
      db,
    );
    const flags = await loadActiveFeatureFlags(ctx, db);
    expect(flags).toEqual(["deposits"]); // the disabled 'voice' skill is excluded
  });

  it("isolates skills per tenant (RLS)", async () => {
    await upsertSkillFromManifest(ctx, manifest({ key: "mine", name: "Mine" }), "uploaded", db);
    const other = await provisionTenant({ sub: "auth0|other", email: "b@x.co" }, db);
    await upsertSkillFromManifest(
      other,
      manifest({ key: "theirs", name: "Theirs" }),
      "uploaded",
      db,
    );

    // App-level scoping: each tenant sees only their own.
    expect((await listSkills(ctx, db)).map((s) => s.key)).toEqual(["mine"]);
    expect((await listSkills(other, db)).map((s) => s.key)).toEqual(["theirs"]);

    // DB-level: RLS blocks cross-tenant reads even without an app filter.
    const rows = await selectAsTenant(client, ctx.tenantId, "SELECT key FROM skills");
    expect(rows.map((r) => (r as { key: string }).key)).toEqual(["mine"]);
  });
});
