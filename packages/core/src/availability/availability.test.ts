import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  computeAvailableSlots,
  isSlotBookable,
  type AvailabilityInput,
  type WeeklyHour,
} from "./index.js";

const WEEKDAYS_8_TO_5: WeeklyHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
  const weekend = weekday === 0 || weekday === 6;
  return {
    weekday,
    closed: weekend,
    open: weekend ? null : "08:00",
    close: weekend ? null : "17:00",
  };
});

function dayRange(dateIso: string): { from: Date; to: Date } {
  return {
    from: new Date(`${dateIso}T00:00:00.000Z`),
    to: new Date(`${dateIso}T23:59:59.999Z`),
  };
}

function base(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    timezone: "Europe/London",
    hours: WEEKDAYS_8_TO_5,
    rules: {
      minNoticeMin: 0,
      maxAdvanceDays: 365,
      defaultBufferMin: 0,
      slotGranularityMin: 60,
      maxJobsPerDay: 0,
    },
    service: { durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0 },
    busy: [],
    now: new Date("2026-01-01T00:00:00.000Z"),
    ...dayRange("2026-07-01"),
    ...overrides,
  };
}

describe("computeAvailableSlots — basics", () => {
  it("produces hourly slots 08:00–16:00 on a weekday", () => {
    const slots = computeAvailableSlots(base());
    expect(slots).toHaveLength(9); // 08..16 inclusive
    expect(slots[0]!.localDate).toBe("2026-07-01");
    // Local start times run 08:00..16:00
    const localHours = slots.map((s) => DateTime.fromJSDate(s.start).setZone("Europe/London").hour);
    expect(localHours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("returns nothing on a closed weekend day", () => {
    // 2026-07-04 is a Saturday.
    expect(computeAvailableSlots(base({ ...dayRange("2026-07-04") }))).toHaveLength(0);
  });
});

describe("computeAvailableSlots — DST correctness (Europe/London)", () => {
  it("maps 08:00 local to 07:00 UTC in BST (summer)", () => {
    const slots = computeAvailableSlots(base({ ...dayRange("2026-07-01") }));
    expect(slots[0]!.start.toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });

  it("maps 08:00 local to 08:00 UTC in GMT (winter)", () => {
    // 2026-01-14 is a Wednesday, in GMT.
    const slots = computeAvailableSlots(base({ ...dayRange("2026-01-14") }));
    expect(slots[0]!.start.toISOString()).toBe("2026-01-14T08:00:00.000Z");
  });

  it("handles the spring-forward day correctly (Mon after the change)", () => {
    // BST begins 2026-03-29 (Sun). 2026-03-30 is the Monday, already in BST.
    const slots = computeAvailableSlots(base({ ...dayRange("2026-03-30") }));
    expect(slots).toHaveLength(9);
    expect(slots[0]!.start.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });

  it("handles the autumn fall-back day correctly (Mon after the change)", () => {
    // GMT resumes 2026-10-25 (Sun). 2026-10-26 is the Monday, back in GMT.
    const slots = computeAvailableSlots(base({ ...dayRange("2026-10-26") }));
    expect(slots).toHaveLength(9);
    expect(slots[0]!.start.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("keeps a 60-minute slot exactly 60 minutes across seasons", () => {
    for (const d of ["2026-01-14", "2026-07-01", "2026-03-30", "2026-10-26"]) {
      const s = computeAvailableSlots(base({ ...dayRange(d) }))[0]!;
      expect(s.end.getTime() - s.start.getTime()).toBe(60 * 60_000);
    }
  });
});

describe("computeAvailableSlots — conflicts & buffers", () => {
  it("blocks slots overlapping a busy interval", () => {
    // Busy 09:00–10:00 BST = 08:00–09:00 UTC blocks the 09:00 local slot.
    const busy = [
      { start: new Date("2026-07-01T08:00:00Z"), end: new Date("2026-07-01T09:00:00Z") },
    ];
    const slots = computeAvailableSlots(base({ busy }));
    const localHours = slots.map((s) => DateTime.fromJSDate(s.start).setZone("Europe/London").hour);
    expect(localHours).not.toContain(9);
    expect(localHours).toContain(8);
  });

  it("applies the after-buffer when detecting conflicts", () => {
    // Busy 09:00–10:00 BST. With a 30-min after-buffer, the 08:00 slot's
    // occupied window runs to 09:30 and now conflicts.
    const busy = [
      { start: new Date("2026-07-01T08:00:00Z"), end: new Date("2026-07-01T09:00:00Z") },
    ];
    const slots = computeAvailableSlots(
      base({ busy, service: { durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 30 } }),
    );
    const localHours = slots.map((s) => DateTime.fromJSDate(s.start).setZone("Europe/London").hour);
    expect(localHours).not.toContain(8);
    expect(localHours).not.toContain(9);
  });
});

describe("computeAvailableSlots — rules", () => {
  it("respects minimum notice", () => {
    // now = 06:00 UTC on the day; 3h notice → earliest 09:00 UTC = 10:00 BST.
    const slots = computeAvailableSlots(
      base({
        now: new Date("2026-07-01T06:00:00Z"),
        rules: {
          minNoticeMin: 180,
          maxAdvanceDays: 365,
          defaultBufferMin: 0,
          slotGranularityMin: 60,
          maxJobsPerDay: 0,
        },
      }),
    );
    const firstLocalHour = DateTime.fromJSDate(slots[0]!.start).setZone("Europe/London").hour;
    expect(firstLocalHour).toBe(10);
  });

  it("respects max advance days", () => {
    const slots = computeAvailableSlots(
      base({
        now: new Date("2026-06-30T00:00:00Z"),
        from: new Date("2026-07-01T00:00:00Z"),
        to: new Date("2026-07-31T23:59:59Z"),
        rules: {
          minNoticeMin: 0,
          maxAdvanceDays: 2,
          defaultBufferMin: 0,
          slotGranularityMin: 60,
          maxJobsPerDay: 0,
        },
      }),
    );
    const dates = new Set(slots.map((s) => s.localDate));
    // now 2026-06-30 + 2 days = 2026-07-02; only 07-01 and 07-02 possible.
    expect([...dates].every((d) => d <= "2026-07-02")).toBe(true);
  });

  it("caps jobs per day", () => {
    const slots = computeAvailableSlots(
      base({
        rules: {
          minNoticeMin: 0,
          maxAdvanceDays: 365,
          defaultBufferMin: 0,
          slotGranularityMin: 60,
          maxJobsPerDay: 2,
        },
      }),
    );
    expect(slots).toHaveLength(2);
  });

  it("seeds jobsPerDay from existing bookings", () => {
    const slots = computeAvailableSlots(
      base({
        rules: {
          minNoticeMin: 0,
          maxAdvanceDays: 365,
          defaultBufferMin: 0,
          slotGranularityMin: 60,
          maxJobsPerDay: 3,
        },
        jobsPerDay: { "2026-07-01": 2 },
      }),
    );
    expect(slots).toHaveLength(1);
  });
});

describe("computeAvailableSlots — exceptions", () => {
  it("closes the business on an exception day", () => {
    const slots = computeAvailableSlots(
      base({ exceptions: [{ date: "2026-07-01", closed: true }] }),
    );
    expect(slots).toHaveLength(0);
  });

  it("overrides hours on an exception day", () => {
    const slots = computeAvailableSlots(
      base({ exceptions: [{ date: "2026-07-01", closed: false, open: "10:00", close: "12:00" }] }),
    );
    expect(slots).toHaveLength(2); // 10:00 and 11:00
    expect(DateTime.fromJSDate(slots[0]!.start).setZone("Europe/London").hour).toBe(10);
  });
});

describe("isSlotBookable", () => {
  const input = base();

  it("accepts an exact available start", () => {
    const nineBst = new Date("2026-07-01T08:00:00Z"); // 09:00 BST
    expect(isSlotBookable(input, nineBst)).toBe(true);
  });

  it("rejects a start that lands in a busy interval", () => {
    const busy = [
      { start: new Date("2026-07-01T08:00:00Z"), end: new Date("2026-07-01T09:00:00Z") },
    ];
    expect(isSlotBookable({ ...input, busy }, new Date("2026-07-01T08:00:00Z"))).toBe(false);
  });

  it("rejects an off-grid start", () => {
    expect(isSlotBookable(input, new Date("2026-07-01T08:30:00Z"))).toBe(false);
  });
});
