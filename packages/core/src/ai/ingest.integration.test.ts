import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { conversations, messages } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import type { TenantContext } from "../tenancy/index.js";
import type { ModelClient, ModelResult } from "./client.js";
import type { TenantPromptData } from "./prompt.js";
import { ingestInboundMessage } from "./ingest.js";

function scriptedModel(responses: ModelResult[]): ModelClient {
  let i = 0;
  return {
    async create() {
      const r = responses[i++];
      if (!r) throw new Error("scripted model ran out of responses");
      return r;
    },
  };
}

const TENANT_DATA: TenantPromptData = {
  profile: { displayName: "Joe's Plumbing" },
  services: [],
  hours: [],
  bookingRules: null,
  knowledge: [],
};

describe("ingestInboundMessage", () => {
  let db: Database;
  let ctx: TenantContext;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|gbp", email: "joe@plumb.co" }, db);
  });

  it("opens a conversation, runs the engine, and persists the reply", async () => {
    const model = scriptedModel([
      { stopReason: "end_turn", content: [{ type: "text", text: "Hi! Yes, we cover boilers." }] },
    ]);
    const res = await ingestInboundMessage(
      ctx,
      {
        channel: "google_business",
        message: "Do you fix boilers?",
        visitor: { name: "Dana" },
        subject: "GBP enquiry",
      },
      { db, model, tenantData: TENANT_DATA },
    );

    expect(res.spam).toBe(false);
    expect(res.reply).toContain("boilers");
    expect(await db.select().from(conversations)).toHaveLength(1);
    const msgs = await db.select().from(messages);
    expect(msgs.map((m) => m.direction).sort()).toEqual(["inbound", "outbound"]);
  });

  it("marks obvious spam and does not call the model", async () => {
    const model = scriptedModel([]); // would throw if called
    const res = await ingestInboundMessage(
      ctx,
      {
        channel: "google_business",
        message: "Buy cheap viagra now http://spam.example http://x.example http://y.example",
      },
      { db, model, tenantData: TENANT_DATA },
    );
    expect(res.spam).toBe(true);
    const [conv] = await db.select().from(conversations);
    expect(conv!.status).toBe("spam");
  });
});
