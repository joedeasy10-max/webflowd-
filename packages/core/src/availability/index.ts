import { DateTime } from "luxon";
import { DEFAULT_TIMEZONE } from "@webflowd/shared";

/**
 * Availability computation. Pure and deterministic: given opening hours,
 * exceptions, booking rules, a service's duration/buffers, and the calendar's
 * busy intervals, it produces bookable start times.
 *
 * All wall-clock reasoning is done in the business timezone (Europe/London) via
 * Luxon, so BST/GMT and DST boundaries are handled correctly; results are
 * returned as UTC instants (what gets stored/booked).
 */

export interface WeeklyHour {
  weekday: number; // 0=Sun..6=Sat
  closed: boolean;
  open: string | null; // "HH:mm"
  close: string | null; // "HH:mm"
}

export interface HoursException {
  date: string; // YYYY-MM-DD (local)
  closed: boolean;
  open?: string | null;
  close?: string | null;
}

export interface AvailabilityRules {
  minNoticeMin: number;
  maxAdvanceDays: number;
  defaultBufferMin: number;
  slotGranularityMin: number;
  maxJobsPerDay: number; // 0 = unlimited
}

export interface ServiceTiming {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface AvailabilityInput {
  timezone?: string;
  hours: WeeklyHour[];
  exceptions?: HoursException[];
  rules: AvailabilityRules;
  service: ServiceTiming;
  /** Busy intervals from the calendar (and/or existing bookings). */
  busy?: Interval[];
  from: Date;
  to: Date;
  now?: Date;
  /** Existing job counts keyed by local date (YYYY-MM-DD), for maxJobsPerDay. */
  jobsPerDay?: Record<string, number>;
  limit?: number;
}

export interface Slot {
  /** Event start (UTC instant). */
  start: Date;
  /** Event end = start + duration (UTC instant). */
  end: Date;
  /** Local date (YYYY-MM-DD) the slot falls on. */
  localDate: string;
}

function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(":");
  return { hour: Number(h), minute: Number(m) };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Opening window for a specific local date, honouring exceptions. */
function windowForDate(
  dateIso: string,
  weekday: number,
  hours: WeeklyHour[],
  exceptions: HoursException[],
): { open: string; close: string } | null {
  const exc = exceptions.find((e) => e.date === dateIso);
  if (exc) {
    if (exc.closed || !exc.open || !exc.close) return null;
    return { open: exc.open, close: exc.close };
  }
  const wh = hours.find((h) => h.weekday === weekday);
  if (!wh || wh.closed || !wh.open || !wh.close) return null;
  return { open: wh.open, close: wh.close };
}

/**
 * Compute bookable slots. Returns event start/end as UTC instants; buffers are
 * applied only to conflict detection against busy intervals, not to the opening
 * window (the event itself must fit within opening hours).
 */
export function computeAvailableSlots(input: AvailabilityInput): Slot[] {
  const tz = input.timezone ?? DEFAULT_TIMEZONE;
  const now = input.now ?? new Date();
  const rules = input.rules;
  const svc = input.service;
  const busy = input.busy ?? [];
  const jobsPerDay = { ...(input.jobsPerDay ?? {}) };
  const limit = input.limit ?? 500;

  const bufferBefore = svc.bufferBeforeMin;
  const bufferAfter = svc.bufferAfterMin || rules.defaultBufferMin;

  const earliest = Math.max(input.from.getTime(), now.getTime() + rules.minNoticeMin * 60_000);
  const maxAdvance = now.getTime() + rules.maxAdvanceDays * 24 * 3600_000;
  const latest = Math.min(input.to.getTime(), maxAdvance);
  if (latest <= earliest) return [];

  const busyMs = busy.map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }));

  const slots: Slot[] = [];
  let cursor = DateTime.fromMillis(earliest, { zone: tz }).startOf("day");
  const lastDay = DateTime.fromMillis(latest, { zone: tz }).startOf("day");

  while (cursor <= lastDay && slots.length < limit) {
    const dateIso = cursor.toFormat("yyyy-MM-dd");
    const weekday = cursor.weekday % 7; // Luxon: 1=Mon..7=Sun → 0=Sun..6=Sat
    const window = windowForDate(dateIso, weekday, input.hours, input.exceptions ?? []);
    if (!window) {
      cursor = cursor.plus({ days: 1 });
      continue;
    }
    const { hour: oh, minute: om } = parseHm(window.open);
    const { hour: ch, minute: cm } = parseHm(window.close);
    const openLocal = cursor.set({ hour: oh, minute: om, second: 0, millisecond: 0 });
    const closeLocal = cursor.set({ hour: ch, minute: cm, second: 0, millisecond: 0 });

    for (
      let start = openLocal;
      start.plus({ minutes: svc.durationMin }) <= closeLocal && slots.length < limit;
      start = start.plus({ minutes: rules.slotGranularityMin })
    ) {
      const eventStartMs = start.toMillis();
      const eventEndMs = start.plus({ minutes: svc.durationMin }).toMillis();
      if (eventStartMs < earliest || eventEndMs > latest) continue;

      const cap = rules.maxJobsPerDay;
      if (cap > 0 && (jobsPerDay[dateIso] ?? 0) >= cap) break;

      const occStart = eventStartMs - bufferBefore * 60_000;
      const occEnd = eventEndMs + bufferAfter * 60_000;
      const conflict = busyMs.some((b) => overlaps(occStart, occEnd, b.start, b.end));
      if (conflict) continue;

      slots.push({
        start: new Date(eventStartMs),
        end: new Date(eventEndMs),
        localDate: dateIso,
      });
      jobsPerDay[dateIso] = (jobsPerDay[dateIso] ?? 0) + 1;
    }
    cursor = cursor.plus({ days: 1 });
  }
  return slots;
}

/**
 * Is a specific proposed start bookable? Used at write time to prevent
 * double-booking after the customer picked a slot. Recomputes against the same
 * inputs and checks the exact start is present.
 */
export function isSlotBookable(input: AvailabilityInput, proposedStart: Date): boolean {
  const startMs = proposedStart.getTime();
  const slots = computeAvailableSlots({
    ...input,
    from: new Date(startMs),
    to: new Date(startMs + input.service.durationMin * 60_000),
    limit: 50,
  });
  return slots.some((s) => s.start.getTime() === startMs);
}
