import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, redact } from "./redact.js";

describe("redact", () => {
  it("masks sensitive keys regardless of value", () => {
    const out = redact({
      access_token: "ya29.secret",
      refreshToken: "1//secret",
      clientSecret: "shh",
      note: "fine",
    }) as Record<string, unknown>;
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.refreshToken).toBe("[REDACTED]");
    expect(out.clientSecret).toBe("[REDACTED]");
    expect(out.note).toBe("fine");
  });

  it("masks emails and phones inside strings", () => {
    expect(maskEmail("Contact boss@example.com now")).toBe("Contact b****@example.com now");
    expect(maskPhone("Call +44 7700 900123 today")).toContain("***123");
  });

  it("handles nested objects and arrays", () => {
    const out = redact({
      user: { email: "a@b.com", meta: [{ password: "x" }] },
    }) as any;
    expect(out.user.email).toBe("a****@b.com");
    expect(out.user.meta[0].password).toBe("[REDACTED]");
  });

  it("survives circular references", () => {
    const a: any = { name: "x" };
    a.self = a;
    const out = redact(a) as any;
    expect(out.self).toBe("[CIRCULAR]");
  });
});
