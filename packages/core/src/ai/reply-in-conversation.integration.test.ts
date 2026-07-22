import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { messages } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { appendMessage, createConversation } from "../repos/conversations.js";
import type { TenantContext } from "../tenancy/index.js";
import type { CreateParams, ModelClient, ModelResult } from "./client.js";
import type { TenantPromptData } from "./prompt.js";
import { replyInConversation } from "./ingest.js";

const TENANT_DATA: TenantPromptData = {
  profile: { displayName: "Joe's Plumbing" },
  services: [],
  hours: [],
  bookingRules: null,
  knowledge: [],
};

describe("replyInConversation", () => {
  let db: Database;
  let ctx: TenantContext;
  let conversationId: string;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|voice", email: "joe@plumb.co" }, db);
    const conv = await createConversation(ctx, { subject: "Inbound call" }, db);
    conversationId = conv.id;
  });

  it("carries prior history to the model and persists the turn", async () => {
    // Seed a prior exchange.
    await appendMessage(
      ctx,
      { conversationId, direction: "inbound", role: "customer", body: "Do you do boilers?" },
      db,
    );
    await appendMessage(
      ctx,
      { conversationId, direction: "outbound", role: "ai", body: "Yes, we do." },
      db,
    );

    let seen: CreateParams | undefined;
    const model: ModelClient = {
      async create(params): Promise<ModelResult> {
        seen = params;
        return {
          stopReason: "end_turn",
          content: [{ type: "text", text: "Tuesday at 10 works." }],
        };
      },
    };

    const res = await replyInConversation(ctx, {
      conversationId,
      customerText: "Can you come Tuesday?",
      channel: "voice",
      tenantData: TENANT_DATA,
      model,
      db,
    });

    expect(res.reply).toContain("Tuesday");
    expect(res.escalated).toBe(false);
    // The model saw the two prior turns as history (before the new user message).
    expect(seen!.messages.length).toBeGreaterThanOrEqual(3);

    const rows = await db.select().from(messages);
    // 2 seeded + inbound + outbound = 4
    expect(rows).toHaveLength(4);
    expect(rows.filter((m) => m.direction === "outbound")).toHaveLength(2);
  });
});
