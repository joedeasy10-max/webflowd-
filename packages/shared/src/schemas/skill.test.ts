import { describe, expect, it } from "vitest";
import { skillManifestSchema } from "./skill.js";

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
