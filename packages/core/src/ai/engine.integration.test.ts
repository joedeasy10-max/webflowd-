import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { aiActions, conversations as conversationsTable, escalations } from "../db/schema.js";
import { freshTestDb } from "../db/pglite.testutil.js";
import { provisionTenant } from "../repos/tenant.js";
import { createService } from "../repos/services.js";
import { createConversation } from "../repos/conversations.js";
import type { TenantContext } from "../tenancy/index.js";
import type { ModelClient, ModelResult } from "./client.js";
import { runAssistantTurn } from "./engine.js";
import type { TenantPromptData } from "./prompt.js";

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

describe("runAssistantTurn", () => {
  let db: Database;
  let ctx: TenantContext;
  let conversationId: string;

  beforeEach(async () => {
    ({ db } = await freshTestDb());
    ctx = await provisionTenant({ sub: "auth0|1", email: "joe@plumb.co" }, db);
    await createService(
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
    const conv = await createConversation(ctx, {}, db);
    conversationId = conv.id;
  });

  const baseInput = (model: ModelClient) => ({
    tenantData: TENANT_DATA,
    history: [],
    customerText: "Hi",
    channel: "chat" as const,
    model,
    deps: { db, conversationId },
  });

  it("answers directly with no tools", async () => {
    const model = scriptedModel([
      { stopReason: "end_turn", content: [{ type: "text", text: "Hello!" }] },
    ]);
    const res = await runAssistantTurn(ctx, baseInput(model));
    expect(res.replyText).toBe("Hello!");
    expect(res.toolCalls).toHaveLength(0);
    expect(res.escalated).toBe(false);
  });

  it("runs a read-only tool then replies, and logs the tool call", async () => {
    const model = scriptedModel([
      {
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "get_service_info", input: {} }],
      },
      { stopReason: "end_turn", content: [{ type: "text", text: "We offer a boiler service." }] },
    ]);
    const res = await runAssistantTurn(ctx, {
      ...baseInput(model),
      customerText: "What do you offer?",
    });
    expect(res.replyText).toContain("boiler service");
    expect(res.toolCalls).toEqual(["get_service_info"]);
    expect(res.escalated).toBe(false);

    const actions = await db.select().from(aiActions);
    expect(actions.some((a) => a.toolName === "get_service_info")).toBe(true);
  });

  it("checks availability without a calendar (opening hours only)", async () => {
    const model = scriptedModel([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "check_availability",
            input: { date_from: "2026-07-23", date_to: "2026-07-24" },
          },
        ],
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "The team will confirm a time." }],
      },
    ]);
    const res = await runAssistantTurn(ctx, {
      ...baseInput(model),
      customerText: "Can you come this week?",
    });
    expect(res.toolCalls).toEqual(["check_availability"]);
    expect(res.escalated).toBe(false);
    expect(res.replyText).toContain("confirm");
  });

  it("escalates via flag_for_human and marks the conversation needs_human", async () => {
    const model = scriptedModel([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "flag_for_human",
            input: { reason: "missing_info", summary: "asked about warranty" },
          },
        ],
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "I'll check with the team and come back to you." }],
      },
    ]);
    const res = await runAssistantTurn(ctx, {
      ...baseInput(model),
      customerText: "What's your warranty?",
    });
    expect(res.escalated).toBe(true);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
    expect(conv!.status).toBe("needs_human");
    const esc = await db.select().from(escalations);
    expect(esc).toHaveLength(1);
    expect(esc[0]!.reason).toBe("missing_info");
  });

  it("escalates when the tool loop is exhausted", async () => {
    // Model keeps calling a tool forever; engine caps turns then escalates.
    const model: ModelClient = {
      async create() {
        return {
          stopReason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "get_service_info", input: {} }],
        };
      },
    };
    const res = await runAssistantTurn(ctx, { ...baseInput(model), maxTurns: 3 });
    expect(res.escalated).toBe(true);
    const esc = await db.select().from(escalations);
    expect(esc.some((e) => e.reason === "tool_loop")).toBe(true);
  });
});
