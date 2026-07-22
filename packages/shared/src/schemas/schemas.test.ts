import { describe, expect, it } from "vitest";
import { businessProfileSchema } from "./profile.js";
import { serviceSchema } from "./service.js";
import { businessHoursSchema, hoursExceptionSchema } from "./hours.js";
import { bookingRulesSchema } from "./booking-rules.js";
import { knowledgeItemSchema } from "./knowledge.js";

describe("businessProfileSchema", () => {
  it("accepts a minimal profile and rejects unknown keys", () => {
    expect(businessProfileSchema.parse({ displayName: "Joe's Plumbing" }).displayName).toBe(
      "Joe's Plumbing",
    );
    expect(() => businessProfileSchema.parse({ displayName: "X", nope: 1 } as unknown)).toThrow();
  });

  it("lowercases and validates reply email", () => {
    const p = businessProfileSchema.parse({ displayName: "X", replyEmail: "BOSS@Example.com" });
    expect(p.replyEmail).toBe("boss@example.com");
  });
});

describe("serviceSchema", () => {
  it("requires a deposit amount when depositRequired", () => {
    expect(() =>
      serviceSchema.parse({
        name: "Boiler service",
        defaultDurationMin: 60,
        depositRequired: true,
      }),
    ).toThrow();
    expect(
      serviceSchema.parse({
        name: "Boiler service",
        defaultDurationMin: 60,
        depositRequired: true,
        depositAmountPence: 5000,
      }).depositAmountPence,
    ).toBe(5000);
  });

  it("applies buffer and active defaults", () => {
    const s = serviceSchema.parse({ name: "Callout", defaultDurationMin: 30 });
    expect(s.bufferBeforeMin).toBe(0);
    expect(s.active).toBe(true);
  });
});

describe("businessHoursSchema", () => {
  it("rejects duplicate weekdays", () => {
    expect(() =>
      businessHoursSchema.parse([
        { weekday: 1, open: "08:00", close: "17:00" },
        { weekday: 1, open: "09:00", close: "12:00" },
      ]),
    ).toThrow();
  });

  it("requires open before close", () => {
    expect(() =>
      businessHoursSchema.parse([{ weekday: 1, open: "18:00", close: "09:00" }]),
    ).toThrow();
  });

  it("allows a closed day without times", () => {
    const rows = businessHoursSchema.parse([{ weekday: 0, closed: true }]);
    expect(rows[0]?.closed).toBe(true);
  });
});

describe("hoursExceptionSchema", () => {
  it("defaults to closed for a bank holiday", () => {
    expect(hoursExceptionSchema.parse({ date: "2026-12-25" }).closed).toBe(true);
  });
});

describe("bookingRulesSchema", () => {
  it("applies sensible defaults and constrains granularity", () => {
    const r = bookingRulesSchema.parse({});
    expect(r.slotGranularityMin).toBe(30);
    expect(r.autoConfirm).toBe(true);
    expect(() => bookingRulesSchema.parse({ slotGranularityMin: 7 })).toThrow();
  });
});

describe("knowledgeItemSchema", () => {
  it("requires a non-empty answer", () => {
    expect(() => knowledgeItemSchema.parse({ question: "Do you do gas?", answer: "" })).toThrow();
  });
});
