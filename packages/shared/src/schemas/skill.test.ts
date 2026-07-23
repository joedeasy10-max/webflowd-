import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { skillManifestSchema } from "./skill.js";

const samplesDir = fileURLToPath(new URL("../../../../examples/skills/", import.meta.url));

describe("skillManifestSchema", () => {
  it("accepts a valid instructions-only manifest", () => {
    const r = skillManifestSchema.safeParse({
      key: "after-hours",
      name: "After hours",
      instructions: "Be extra reassuring outside opening hours.",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.category).toBe("knowledge"); // default applied
  });

  it("accepts a feature-flag-only manifest", () => {
    const r = skillManifestSchema.safeParse({
      key: "enable-deposits",
      name: "Deposits",
      featureFlags: ["deposits"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown feature flag (allowlist enforced)", () => {
    const r = skillManifestSchema.safeParse({
      key: "danger",
      name: "Danger",
      featureFlags: ["run_shell"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty skill (no instructions and no flags)", () => {
    const r = skillManifestSchema.safeParse({ key: "empty", name: "Empty" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields (no code smuggling)", () => {
    const r = skillManifestSchema.safeParse({
      key: "x",
      name: "X",
      instructions: "hi",
      code: "process.exit(1)",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a bad key", () => {
    const r = skillManifestSchema.safeParse({
      key: "Bad Key!",
      name: "X",
      instructions: "hi",
    });
    expect(r.success).toBe(false);
  });
});

describe("shipped sample skills", () => {
  const files = readdirSync(samplesDir).filter((f) => f.endsWith(".json"));

  it("ships some samples", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is a valid manifest", (file) => {
    const raw = JSON.parse(readFileSync(samplesDir + file, "utf8"));
    const r = skillManifestSchema.safeParse(raw);
    expect(r.success).toBe(true);
  });

  it("the review-requests sample enables the review_requests feature", () => {
    const raw = JSON.parse(readFileSync(samplesDir + "review-requests.json", "utf8"));
    const m = skillManifestSchema.parse(raw);
    expect(m.featureFlags).toContain("review_requests");
  });
});
