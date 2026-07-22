import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Database } from "../db/client.js";
import { contacts, reminders, reviewRequests } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { createService } from "../repos/services.js";
import { createBooking, type CalendarPort } from "../booking/index.js";
import type { TenantContext } from "../tenancy/index.js";
import { processDueReminders, processDueReviewRequests, type LifecycleSender } from "./index.js";

function fakeCalendar(): CalendarPort {
  let n = 0;
  return {
    provider: "google",
    async createEvent() {
      return { eventId: `evt_${++n}` };
    },
    async cancelEvent() {},
  };
}

function fakeSender() {
  const emails: Array<{ to: string; subject: string }> = [];
  const sms: Array<{ to: string; body: string }> = [];
  const sender: LifecycleSender = {
    async email(to, subject) {
      emails.push({ to, subject });
    },
    async sms(to, body) {
      sms.push({ to, body });
    },
  };
  return { sender, emails, sms };
}

/** A weekday ~10 days out at 10:00 Europe/London, on the 30-min grid. */
function futureStart(): Date {
  let d = DateTime.now()
    .setZone("Europe/London")
    .plus({ days: 10 })
    .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toJSDate();
}

describe("lifecycle", () => {
  let db: Database;
  let ctx: TenantContext;
  let serviceId: string;
  let startAt: Date;
  let endAt: Date;

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
    startAt = futureStart();
    endAt = new Date(startAt.getTime() + 60 * 60_000);
    await createBooking(
      ctx,
      { serviceId, startAt, contact: { name: "Jane", email: "jane@x.com" }, idempotencyKey: "k1" },
      { db, calendar: fakeCalendar() },
    );
  });

  it("schedules two reminders and a review request on confirm", async () => {
    expect(await db.select().from(reminders)).toHaveLength(2);
    expect(await db.select().from(reviewRequests)).toHaveLength(1);
  });

  it("sends due reminders and marks them sent", async () => {
    const s = fakeSender();
    const res = await processDueReminders(
      { sender: s.sender, now: new Date(startAt.getTime() - 60 * 60_000) },
      db,
    );
    expect(res.sent).toBe(2);
    expect(s.emails).toHaveLength(2);
    const rows = await db.select().from(reminders);
    expect(rows.every((r) => r.status === "sent")).toBe(true);
  });

  it("skips reminders for an opted-out contact", async () => {
    await db
      .update(contacts)
      .set({ messagingOptOut: true })
      .where(eq(contacts.tenantId, ctx.tenantId));
    const s = fakeSender();
    const res = await processDueReminders(
      { sender: s.sender, now: new Date(startAt.getTime() - 60 * 60_000) },
      db,
    );
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(2);
    expect(s.emails).toHaveLength(0);
  });

  it("holds a review request until the job has finished", async () => {
    const s = fakeSender();
    // Before the appointment: not yet eligible.
    const early = await processDueReviewRequests({ sender: s.sender, now: startAt }, db);
    expect(early.sent).toBe(0);
    expect((await db.select().from(reviewRequests))[0]!.status).toBe("scheduled");

    // A few hours after it ends: sent.
    const late = await processDueReviewRequests(
      { sender: s.sender, now: new Date(endAt.getTime() + 3 * 3600_000) },
      db,
    );
    expect(late.sent).toBe(1);
    expect(s.emails).toHaveLength(1);
    expect((await db.select().from(reviewRequests))[0]!.status).toBe("sent");
  });
});
