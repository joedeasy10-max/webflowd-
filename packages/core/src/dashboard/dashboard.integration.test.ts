import { beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Database } from "../db/client.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { createService } from "../repos/services.js";
import { openEscalation } from "../repos/escalations.js";
import { createConversation } from "../repos/conversations.js";
import { createBooking, type CalendarPort } from "../booking/index.js";
import type { TenantContext } from "../tenancy/index.js";
import { getDashboard } from "./index.js";

function fakeCalendar(): CalendarPort {
  return {
    provider: "google",
    async createEvent() {
      return { eventId: "evt_1" };
    },
    async cancelEvent() {},
  };
}

function futureStart(days: number): Date {
  let d = DateTime.now()
    .setZone("Europe/London")
    .plus({ days })
    .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toJSDate();
}

describe("getDashboard", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|dash", email: "joe@plumb.co" }, db);
  });

  it("returns upcoming bookings, open escalations and counts", async () => {
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
    const startAt = futureStart(10);
    await createBooking(
      ctx,
      {
        serviceId: svc.id,
        startAt,
        contact: { name: "Jane", email: "jane@x.com" },
        idempotencyKey: "k1",
      },
      { db, calendar: fakeCalendar() },
    );

    const convo = await createConversation(ctx, {}, db);
    await openEscalation(
      ctx,
      { conversationId: convo.id, reason: "unsure", summary: "check price" },
      db,
    );

    const data = await getDashboard(ctx, { db });

    expect(data.upcomingBookings).toHaveLength(1);
    expect(data.upcomingBookings[0]!.serviceName).toBe("Boiler service");
    expect(data.upcomingBookings[0]!.contactName).toBe("Jane");
    expect(data.counts.upcoming).toBe(1);
    expect(data.openEscalations).toHaveLength(1);
    expect(data.counts.openEscalations).toBe(1);
    expect(data.connections).toHaveLength(0);
  });

  it("excludes past bookings from upcoming", async () => {
    const svc = await createService(
      ctx,
      {
        name: "Callout",
        defaultDurationMin: 60,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        depositRequired: false,
        active: true,
      },
      db,
    );
    // A booking well in the future, then query with `now` set past it.
    const startAt = futureStart(10);
    await createBooking(
      ctx,
      { serviceId: svc.id, startAt, idempotencyKey: "k2" },
      { db, calendar: fakeCalendar() },
    );

    const data = await getDashboard(ctx, {
      db,
      now: new Date(startAt.getTime() + 24 * 3600_000),
    });
    expect(data.upcomingBookings).toHaveLength(0);
    expect(data.counts.upcoming).toBe(0);
  });
});
