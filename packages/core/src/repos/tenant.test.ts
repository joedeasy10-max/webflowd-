import { describe, expect, it } from "vitest";
import { defaultWeeklyHours, slugify } from "./tenant.js";

describe("slugify", () => {
  it("produces a url-safe slug with a unique suffix", () => {
    const a = slugify("Joe's Plumbing & Heating");
    expect(a).toMatch(/^joe-s-plumbing-heating-[0-9a-f]{8}$/);
  });

  it("falls back to 'business' for empty/symbol-only input", () => {
    expect(slugify("!!!")).toMatch(/^business-[0-9a-f]{8}$/);
  });

  it("is unique across calls for the same name", () => {
    expect(slugify("Acme")).not.toBe(slugify("Acme"));
  });

  it("caps the base length", () => {
    const long = "a".repeat(100);
    const slug = slugify(long);
    // base is capped at 40 chars, plus "-" and 8 hex chars.
    expect(slug.length).toBeLessThanOrEqual(40 + 1 + 8);
  });
});

describe("defaultWeeklyHours", () => {
  const rows = defaultWeeklyHours("t-1");

  it("returns one row per weekday tagged with the tenant", () => {
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.tenantId === "t-1")).toBe(true);
  });

  it("opens Mon–Fri 08:00–17:00 and closes weekends", () => {
    const sunday = rows.find((r) => r.weekday === 0)!;
    const monday = rows.find((r) => r.weekday === 1)!;
    const saturday = rows.find((r) => r.weekday === 6)!;
    expect(sunday.closed).toBe(true);
    expect(sunday.open).toBeNull();
    expect(saturday.closed).toBe(true);
    expect(monday.closed).toBe(false);
    expect(monday.open).toBe("08:00");
    expect(monday.close).toBe("17:00");
  });
});
