import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { contacts, conversations, messages } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { upsertProfile } from "../repos/profile.js";
import type { TenantContext } from "../tenancy/index.js";
import { handleVoicemail } from "./voicemail.js";

describe("handleVoicemail", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|vm", email: "joe@plumb.co" }, db);
    await upsertProfile(ctx, { displayName: "Joe's Plumbing" }, db);
  });

  it("stores the transcription and texts the caller back", async () => {
    const sent: Array<{ to: string; from: string; body: string }> = [];
    const res = await handleVoicemail(
      ctx,
      {
        callSid: "CA1",
        recordingSid: "RE1",
        transcription: "Hi, my boiler is leaking, please call me back.",
        callerNumber: "+447700900001",
        businessNumber: "+441234",
      },
      { db, sendSms: async (m) => void sent.push(m) },
    );

    expect(res.outcome).toBe("texted");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("+447700900001");

    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(2); // inbound voicemail + outbound text-back
    const inbound = msgs.find((m) => m.direction === "inbound")!;
    expect(inbound.body).toContain("boiler is leaking");
    expect(inbound.providerMessageId).toBe("RE1");
  });

  it("still records the voicemail but sends nothing to an opted-out caller", async () => {
    await db
      .insert(contacts)
      .values({ tenantId: ctx.tenantId, phone: "+447700900002", messagingOptOut: true });

    const sent: Array<unknown> = [];
    const res = await handleVoicemail(
      ctx,
      {
        callSid: "CA2",
        recordingSid: "RE2",
        recordingUrl: "https://api.twilio.com/rec/RE2",
        callerNumber: "+447700900002",
        businessNumber: "+441234",
      },
      { db, sendSms: async (m) => void sent.push(m) },
    );

    expect(res.outcome).toBe("skipped_opt_out");
    expect(sent).toHaveLength(0);
    expect(await db.select().from(conversations)).toHaveLength(1);
    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(1); // just the inbound voicemail
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, "+447700900002"));
    expect(c!.messagingOptOut).toBe(true);
  });
});
