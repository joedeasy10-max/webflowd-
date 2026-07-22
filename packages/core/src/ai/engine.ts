import type { ChannelType } from "@webflowd/shared";
import type { TenantContext } from "../tenancy/index.js";
import { logAiAction } from "../repos/ai-actions.js";
import { openEscalation } from "../repos/escalations.js";
import { setConversationStatus } from "../repos/conversations.js";
import type { ConvMessage, ModelClient, ToolResultBlock } from "./client.js";
import { buildSystemPrompt, wrapCustomerMessage, type TenantPromptData } from "./prompt.js";
import { TOOLS } from "./tools.js";
import { executeTool, type ExecutorDeps } from "./executors.js";

export interface EngineHistoryItem {
  role: "customer" | "ai" | "owner";
  body: string;
}

export interface RunInput {
  tenantData: TenantPromptData;
  history: EngineHistoryItem[];
  customerText: string;
  channel: ChannelType;
  model: ModelClient;
  deps: ExecutorDeps;
  maxTurns?: number;
  maxTokens?: number;
  nowIso?: string;
}

export interface RunResult {
  replyText: string;
  escalated: boolean;
  toolCalls: string[];
}

const FALLBACK_REPLY =
  "Thanks for your message — I'll check with the team and get back to you shortly.";

function toConvHistory(history: EngineHistoryItem[]): ConvMessage[] {
  return history.map((h) =>
    h.role === "customer"
      ? ({ role: "user", content: h.body } as ConvMessage)
      : ({ role: "assistant", content: [{ type: "text", text: h.body }] } as ConvMessage),
  );
}

/**
 * Run one assistant turn: builds the tenant system prompt, wraps the untrusted
 * customer message, and drives the model's tool-use loop (bounded). Every tool
 * call is executed server-side and audited. Returns the reply text and whether
 * the conversation was escalated.
 */
export async function runAssistantTurn(ctx: TenantContext, input: RunInput): Promise<RunResult> {
  const maxTurns = input.maxTurns ?? 6;
  const maxTokens = input.maxTokens ?? 1024;
  const system = buildSystemPrompt(input.tenantData, input.nowIso);

  const messages: ConvMessage[] = [
    ...toConvHistory(input.history),
    { role: "user", content: wrapCustomerMessage(input.customerText, input.channel) },
  ];

  const toolCalls: string[] = [];
  let escalated = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await input.model.create({ system, messages, tools: TOOLS, maxTokens });

    if (res.stopReason !== "tool_use") {
      const replyText = res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { replyText: replyText || FALLBACK_REPLY, escalated, toolCalls };
    }

    // Execute every requested tool, then feed all results back in one user turn.
    messages.push({ role: "assistant", content: res.content });
    const results: ToolResultBlock[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const outcome = await executeTool(ctx, block.name, block.input, input.deps);
      toolCalls.push(block.name);
      if (outcome.escalated) escalated = true;
      await logAiAction(
        ctx,
        {
          conversationId: input.deps.conversationId,
          toolName: block.name,
          input: block.input,
          output: { content: outcome.content, isError: outcome.isError ?? false },
          model: res.model ?? null,
          tokensIn: res.usage?.inputTokens ?? null,
          tokensOut: res.usage?.outputTokens ?? null,
          outcome: outcome.escalated ? "escalated" : outcome.isError ? "error" : "ok",
        },
        input.deps.db,
      );
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  // Ran out of tool turns without a final answer — escalate and hold.
  if (!escalated) {
    await openEscalation(
      ctx,
      {
        conversationId: input.deps.conversationId,
        reason: "tool_loop",
        summary: "AI exceeded tool-turn limit",
      },
      input.deps.db,
    );
    await setConversationStatus(ctx, input.deps.conversationId, "needs_human", input.deps.db);
    escalated = true;
  }
  return { replyText: FALLBACK_REPLY, escalated, toolCalls };
}
