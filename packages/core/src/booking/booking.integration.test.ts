import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { payments as paymentsTable } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { createService } from "../repos/services.js";
import { getBookingById } from "../repos/bookings.js";
import type { TenantContext } from "../tenancy/index.js";
import {
  BookingConflictError,
  cancelBooking,
  confirmDepositPaid,
  createBooking,
  rescheduleBooking,
  type CalendarPort,
  type NotifyPort,
  type PaymentPort,
} from "./index.js";

function fakeCalendar() {
  const created: Array<{ eventId: string }> = [];
  const cancelled: string[] = [];
  let n = 0;
  const port: CalendarPort = {
    provider: "google",
    async createEvent() {
      const eventId = `evt_${++n}`;
      created.push({ eventId });
      return { eventId };
    },
    async cancelEvent(id) {
      cancelled.push(id);
    },
  };
  return { port, created, cancelled };
}

function fakePayments() {
  const calls: string[] = [];
  const port: PaymentPort = {
    async createDepositCheckout(input) {
      calls.push(input.bookingId);
      return { url: `https://pay.test/${input.bookingId}`, reference: `cs_${input.bookingId}` };
    },
  };
  return { port, calls };
}

function fakeNotify() {
  const sent: string[] = [];
  const port: NotifyPort = {
    async booking(n) {
      sent.push(n.kind);
    },
  };
  return { port, sent };
}

const NOW = new Date("2026-07-01T00:00:00Z");
const TEN_BST = new Date("2026-07-01T09:00:00Z"); // 10:00 Europe/London

describe("createBooking", () => {
  let db: Database;
  let ctx: TenantContext;
  let serviceId: string;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
    const svc = await createService(
      ctx,
      {
        name: "Boiler service",
        defaultDurationMin: 60,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        depositRequired: false,
        active: true,
      },
      db,
    );
    serviceId = svc.id;
  });

  it("books a confirmed slot, writes a calendar event, and notifies", async () => {
    const cal = fakeCalendar();
    const notify = fakeNotify();
    const res = await createBooking(
      ctx,
      {
        serviceId,
        startAt: TEN_BST,
        contact: { name: "Jane", email: "jane@x.com" },
        idempotencyKey: "k1",
      },
      { db, now: NOW, calendar: cal.port, notify: notify.port },
    );
    expect(res.booking.status).toBe("confirmed");
    expect(cal.created).toHaveLength(1);
    expect(notify.sent).toEqual(["confirmed"]);

    const stored = await getBookingById(ctx, res.booking.id, db);
    expect(stored!.calendarEventId).toBe("evt_1");
    expect(stored!.calendarProvider).toBe("google");
  });

  it("is idempotent for a repeated idempotency key", async () => {
    const first = await createBooking(
      ctx,
      { serviceId, startAt: TEN_BST, idempotencyKey: "k1" },
      { db, now: NOW },
    );
    const second = await createBooking(
      ctx,
      { serviceId, startAt: TEN_BST, idempotencyKey: "k1" },
      { db, now: NOW },
    );
    expect(second.idempotentReplay).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
  });

  it("prevents double-booking an overlapping slot", async () => {
    await createBooking(
      ctx,
      { serviceId, startAt: TEN_BST, idempotencyKey: "k1" },
      { db, now: NOW },
    );
    // 10:30 BST overlaps the 10:00–11:00 booking.
    const overlap = new Date("2026-07-01T09:30:00Z");
    await expect(
      createBooking(ctx, { serviceId, startAt: overlap, idempotencyKey: "k2" }, { db, now: NOW }),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("rejects an unavailable (out-of-hours) start", async () => {
    const sixAm = new Date("2026-07-01T05:00:00Z"); // 06:00 BST, before opening
    await expect(
      createBooking(ctx, { serviceId, startAt: sixAm, idempotencyKey: "k3" }, { db, now: NOW }),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("holds a deposit-required booking as proposed until paid", async () => {
    const depositSvc = await createService(
      ctx,
      {
        name: "Big job",
        defaultDurationMin: 60,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        depositRequired: true,
        depositAmountPence: 5000,
        active: true,
      },
      db,
    );
    const cal = fakeCalendar();
    const pay = fakePayments();
    const res = await createBooking(
      ctx,
      {
        serviceId: depositSvc.id,
        startAt: TEN_BST,
        contact: { name: "Jane", email: "jane@x.com" },
        idempotencyKey: "k4",
      },
      { db, now: NOW, calendar: cal.port, payments: pay.port },
    );
    expect(res.booking.status).toBe("proposed");
    expect(res.paymentUrl).toContain("pay.test");
    expect(cal.created).toHaveLength(0); // no calendar event until paid

    const [payment] = await db.select().from(paymentsTable);
    expect(payment!.status).toBe("pending");
    expect(payment!.amountPence).toBe(5000);

    // Deposit paid → confirm.
    await confirmDepositPaid(ctx, res.booking.id, { db, calendar: cal.port });
    const confirmed = await getBookingById(ctx, res.booking.id, db);
    expect(confirmed!.status).toBe("confirmed");
    expect(confirmed!.depositStatus).toBe("paid");
    expect(cal.created).toHaveLength(1);
  });

  it("cancels a booking and removes its calendar event", async () => {
    const cal = fakeCalendar();
    const res = await createBooking(
      ctx,
      { serviceId, startAt: TEN_BST, idempotencyKey: "k5" },
      { db, now: NOW, calendar: cal.port },
    );
    await cancelBooking(ctx, res.booking.id, "customer request", { db, calendar: cal.port });
    const stored = await getBookingById(ctx, res.booking.id, db);
    expect(stored!.status).toBe("cancelled");
    expect(cal.cancelled).toEqual(["evt_1"]);
  });

  it("reschedules to a new free slot", async () => {
    const cal = fakeCalendar();
    const res = await createBooking(
      ctx,
      { serviceId, startAt: TEN_BST, idempotencyKey: "k6" },
      { db, now: NOW, calendar: cal.port },
    );
    const newStart = new Date("2026-07-01T13:00:00Z"); // 14:00 BST
    await rescheduleBooking(ctx, res.booking.id, newStart, { db, now: NOW, calendar: cal.port });
    const stored = await getBookingById(ctx, res.booking.id, db);
    expect(stored!.status).toBe("rescheduled");
    expect(stored!.startAt.toISOString()).toBe(newStart.toISOString());
    expect(cal.cancelled).toEqual(["evt_1"]); // old event removed
    expect(cal.created).toHaveLength(2); // original + rescheduled
  });
});
