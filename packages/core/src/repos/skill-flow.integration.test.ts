import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { skillManifestSchema } from "@webflowd/shared";
import type { Database } from "../db/client.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "./tenant.js";
import {
  loadActiveFeatureFlags,
  loadEnabledSkillInstructions,
  setSkillEnabled,
  upsertSkillFromManifest,
} from "./skills.js";
import { buildSystemPrompt, type TenantPromptData } from "../ai/prompt.js";
import type { TenantContext } from "../tenancy/index.js";

/** Load a real sample manifest shipped in /examples/skills. */
function loadSample(name: string) {
  const path = fileURLToPath(new URL(`../../../../examples/skills/${name}`, import.meta.url));
  return skillManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const BASE: TenantPromptData = {
  profile: { displayName: "Joe's Plumbing" },
  services: [],
  hours: [],
  bookingRules: null,
  knowledge: [],
};

/** Drives the whole admin flow with a shipped sample skill. */
describe("skill flow (sample manifest → prompt → toggle)", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|flow", email: "joe@plumb.co" }, db);
  });

  it("installs a sample skill and surfaces it in the system prompt, then hides it when disabled", async () => {
    // 1) Admin uploads the sample manifest.
    const manifest = loadSample("after-hours-reassurance.json");
    await upsertSkillFromManifest(ctx, manifest, "uploaded", db);

    // 2) The engine picks up the enabled skill's instructions...
    const enabled = await loadEnabledSkillInstructions(ctx, db);
    expect(enabled.map((s) => s.name)).toContain("After-hours reassurance");

    // 3) ...and they appear in the built system prompt.
    const onText = buildSystemPrompt({ ...BASE, skills: enabled })
      .map((b) => b.text)
      .join("\n");
    expect(onText).toContain("<enabled_skills>");
    expect(onText).toContain("After-hours reassurance");
    expect(onText).toContain("we're currently closed");

    // 4) Admin disables it — it drops out of the prompt immediately.
    await setSkillEnabled(ctx, manifest.key, false, db);
    const offSkills = await loadEnabledSkillInstructions(ctx, db);
    expect(offSkills).toHaveLength(0);
    const offText = buildSystemPrompt({ ...BASE, skills: offSkills })
      .map((b) => b.text)
      .join("\n");
    expect(offText).not.toContain("<enabled_skills>");
  });

  it("activates a feature flag from a sample feature-skill and clears it on disable", async () => {
    const manifest = loadSample("deposit-collection.json");
    await upsertSkillFromManifest(ctx, manifest, "uploaded", db);
    expect(await loadActiveFeatureFlags(ctx, db)).toContain("deposits");

    await setSkillEnabled(ctx, manifest.key, false, db);
    expect(await loadActiveFeatureFlags(ctx, db)).not.toContain("deposits");
  });
});
