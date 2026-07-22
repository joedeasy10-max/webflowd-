import { beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Database } from "../db/client.js";
import { leadFollowups } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { createService } from "../repos/services.js";
import { findOrCreateContact } from "../repos/contacts.js";
import { createBooking, type CalendarPort } from "../booking/index.js";
import type { TenantContext } from "../tenancy/index.js";
import type { LifecycleSender } from "./index.js";
import { processDueLeadFollowups, scheduleLeadFollowup } from "./lead-followup.js";

function fakeSender() {
  const emails: Array<{ to: string; subject: string }> = [];
  const sender: LifecycleSender = {
    async email(to, subject) {
      emails.push({ to, subject });
    },
  };
  return { sender, emails };
}

function fakeCalendar(): CalendarPort {
  return {
    provider: "google",
    async createEvent() {
      return { eventId: "evt_1" };
    },
    async cancelEvent() {},
  };
}

function futureStart(): Date {
  let d = DateTime.now()
    .setZone("Europe/London")
    .plus({ days: 12 })
    .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toJSDate();
}

describe("lead follow-up", () => {
  let db: Database;
  let ctx: TenantContext;
  let contactId: string;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|lf", email: "joe@plumb.co" }, db);
    const contact = await findOrCreateContact(ctx, { name: "Sam", email: "sam@x.com" }, db);
    contactId = contact.id;
  });

  it("schedules a two-step sequence", async () => {
    await scheduleLeadFollowup(ctx, { contactId, channel: "email" }, db);
    expect(await db.select().from(leadFollowups)).toHaveLength(2);
  });

  it("sends a due follow-up to a lead that hasn't booked", async () => {
    await scheduleLeadFollowup(ctx, { contactId, channel: "email" }, db);
    const s = fakeSender();
    const res = await processDueLeadFollowups(
      { sender: s.sender, now: new Date(Date.now() + 3 * 24 * 3600_000) },
      db,
    );
    expect(res.sent).toBe(1); // only step 1 (+2d) is due at +3d
    expect(s.emails).toHaveLength(1);
  });

  it("marks the sequence converted once the lead books", async () => {
    await scheduleLeadFollowup(ctx, { contactId, channel: "email" }, db);
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
    await createBooking(
      ctx,
      {
        serviceId: svc.id,
        startAt: futureStart(),
        contact: { email: "sam@x.com" },
        idempotencyKey: "k1",
      },
      { db, calendar: fakeCalendar() },
    );

    const s = fakeSender();
    const res = await processDueLeadFollowups(
      { sender: s.sender, now: new Date(Date.now() + 30 * 24 * 3600_000) },
      db,
    );
    expect(res.sent).toBe(0);
    expect(res.converted).toBeGreaterThanOrEqual(1);
    expect(s.emails).toHaveLength(0);
    const rows = await db.select().from(leadFollowups);
    expect(rows.every((r) => r.status === "converted")).toBe(true);
  });
});
