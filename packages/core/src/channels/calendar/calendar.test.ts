import { describe, expect, it } from "vitest";
import { parseGoogleFreeBusy } from "./google.js";
import { parseMicrosoftCalendarView } from "./microsoft.js";
import { normaliseBusy } from "./types.js";

describe("normaliseBusy", () => {
  it("merges overlapping and adjacent intervals", () => {
    const merged = normaliseBusy([
      { start: new Date("2026-07-22T09:00:00Z"), end: new Date("2026-07-22T10:00:00Z") },
      { start: new Date("2026-07-22T09:30:00Z"), end: new Date("2026-07-22T11:00:00Z") },
      { start: new Date("2026-07-22T11:00:00Z"), end: new Date("2026-07-22T11:30:00Z") },
      { start: new Date("2026-07-22T13:00:00Z"), end: new Date("2026-07-22T14:00:00Z") },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.start.toISOString()).toBe("2026-07-22T09:00:00.000Z");
    expect(merged[0]!.end.toISOString()).toBe("2026-07-22T11:30:00.000Z");
  });

  it("drops zero/negative-length intervals", () => {
    expect(
      normaliseBusy([
        { start: new Date("2026-07-22T09:00:00Z"), end: new Date("2026-07-22T09:00:00Z") },
      ]),
    ).toHaveLength(0);
  });
});

describe("parseGoogleFreeBusy", () => {
  it("extracts busy blocks for the primary calendar", () => {
    const busy = parseGoogleFreeBusy({
      calendars: {
        primary: {
          busy: [{ start: "2026-07-22T09:00:00Z", end: "2026-07-22T10:00:00Z" }],
        },
      },
    });
    expect(busy).toHaveLength(1);
    expect(busy[0]!.start.toISOString()).toBe("2026-07-22T09:00:00.000Z");
  });

  it("returns empty when the calendar has no busy field", () => {
    expect(parseGoogleFreeBusy({ calendars: { primary: {} } })).toHaveLength(0);
    expect(parseGoogleFreeBusy({})).toHaveLength(0);
  });
});

describe("parseMicrosoftCalendarView", () => {
  it("keeps busy-like events and treats zone-less times as UTC", () => {
    const busy = parseMicrosoftCalendarView({
      value: [
        {
          start: { dateTime: "2026-07-22T09:00:00.0000000" },
          end: { dateTime: "2026-07-22T10:00:00.0000000" },
          showAs: "busy",
        },
        {
          start: { dateTime: "2026-07-22T12:00:00" },
          end: { dateTime: "2026-07-22T12:30:00" },
          showAs: "free", // excluded
        },
        {
          start: { dateTime: "2026-07-22T14:00:00" },
          end: { dateTime: "2026-07-22T15:00:00" },
          showAs: "busy",
          isCancelled: true, // excluded
        },
      ],
    });
    expect(busy).toHaveLength(1);
    expect(busy[0]!.start.toISOString()).toBe("2026-07-22T09:00:00.000Z");
    expect(busy[0]!.end.toISOString()).toBe("2026-07-22T10:00:00.000Z");
  });
});
