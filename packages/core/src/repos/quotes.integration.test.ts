import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { contacts } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "./tenant.js";
import { findOrCreateContact } from "./contacts.js";
import {
  createQuote,
  listQuotes,
  sendQuote,
  updateQuoteStatus,
  type QuoteSender,
} from "./quotes.js";
import type { TenantContext } from "../tenancy/index.js";

describe("quotes", () => {
  let db: Database;
  let ctx: TenantContext;
  let contactId: string;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|q", email: "joe@plumb.co" }, db);
    const c = await findOrCreateContact(ctx, { name: "Pat", email: "pat@x.com" }, db);
    contactId = c.id;
  });

  it("creates and lists a quote as draft", async () => {
    await createQuote(ctx, { contactId, description: "New boiler", amountPence: 250000 }, db);
    const list = await listQuotes(ctx, db);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("draft");
    expect(list[0]!.amountPence).toBe(250000);
  });

  it("sends a quote and marks it sent", async () => {
    const q = await createQuote(ctx, { contactId, description: "Repair", amountPence: 9000 }, db);
    const emails: Array<{ to: string }> = [];
    const sender: QuoteSender = {
      async email(to) {
        emails.push({ to });
      },
    };
    const res = await sendQuote(ctx, q.id, { sender, businessName: "Joe's" }, db);
    expect(res.delivered).toBe(true);
    expect(emails).toEqual([{ to: "pat@x.com" }]);
    const [row] = await listQuotes(ctx, db);
    expect(row!.status).toBe("sent");
    expect(row!.sentAt).not.toBeNull();
  });

  it("does not deliver to an opted-out contact but still records sent", async () => {
    const opted = await findOrCreateContact(ctx, { phone: "+447700900050" }, db);
    await db.update(contacts).set({ messagingOptOut: true }).where(eq(contacts.id, opted.id));
    const q = await createQuote(
      ctx,
      { contactId: opted.id, description: "X", amountPence: 100 },
      db,
    );
    const sms: string[] = [];
    const sender: QuoteSender = {
      async sms(to) {
        sms.push(to);
      },
    };
    const res = await sendQuote(ctx, q.id, { sender }, db);
    expect(res.delivered).toBe(false);
    expect(sms).toHaveLength(0);
  });

  it("updates a quote status", async () => {
    const q = await createQuote(ctx, { contactId, description: "Y", amountPence: 100 }, db);
    await updateQuoteStatus(ctx, q.id, "accepted", db);
    const [row] = await listQuotes(ctx, db);
    expect(row!.status).toBe("accepted");
  });
});
