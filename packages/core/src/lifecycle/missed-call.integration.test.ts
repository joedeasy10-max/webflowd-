import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { contacts, conversations, messages } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { upsertProfile } from "../repos/profile.js";
import type { TenantContext } from "../tenancy/index.js";
import { handleMissedCall } from "./missed-call.js";

describe("handleMissedCall", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|mc", email: "joe@plumb.co" }, db);
    await upsertProfile(ctx, { displayName: "Joe's Plumbing" }, db);
  });

  it("texts the caller back and records the conversation", async () => {
    const sent: Array<{ to: string; from: string; body: string }> = [];
    const res = await handleMissedCall(
      ctx,
      { callSid: "CA1", callerNumber: "+447700900001", businessNumber: "+441234" },
      { db, sendSms: async (m) => void sent.push(m) },
    );

    expect(res.outcome).toBe("texted");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("+447700900001");
    expect(sent[0]!.from).toBe("+441234");
    expect(sent[0]!.body).toContain("Joe's Plumbing");

    const convos = await db.select().from(conversations);
    expect(convos).toHaveLength(1);
    const msgs = await db.select().from(messages);
    // one inbound "missed call" note + one outbound SMS
    expect(msgs).toHaveLength(2);
  });

  it("skips an opted-out caller and sends nothing", async () => {
    // Pre-create the contact as opted out.
    await db
      .insert(contacts)
      .values({ tenantId: ctx.tenantId, phone: "+447700900002", messagingOptOut: true });

    const sent: Array<unknown> = [];
    const res = await handleMissedCall(
      ctx,
      { callSid: "CA2", callerNumber: "+447700900002", businessNumber: "+441234" },
      { db, sendSms: async (m) => void sent.push(m) },
    );

    expect(res.outcome).toBe("skipped_opt_out");
    expect(sent).toHaveLength(0);
    expect(await db.select().from(conversations)).toHaveLength(0);
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, "+447700900002"));
    expect(c!.messagingOptOut).toBe(true);
  });
});
