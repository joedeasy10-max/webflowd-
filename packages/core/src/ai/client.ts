import Anthropic from "@anthropic-ai/sdk";

/**
 * A thin, testable seam over the Anthropic Messages API. The engine depends on
 * `ModelClient`, not the SDK, so tests inject a fake and no network/API key is
 * required.
 */

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type AssistantBlock = TextBlock | ToolUseBlock;

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ConvMessage =
  | { role: "user"; content: string | ToolResultBlock[] }
  | { role: "assistant"; content: AssistantBlock[] };

export type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

export interface CreateParams {
  system: SystemBlock[];
  messages: ConvMessage[];
  tools: ToolDef[];
  maxTokens: number;
}

export interface ModelResult {
  stopReason: string;
  content: AssistantBlock[];
  usage?: { inputTokens?: number; outputTokens?: number };
  model?: string;
}

export interface ModelClient {
  create(params: CreateParams): Promise<ModelResult>;
}

/**
 * Real Anthropic-backed client. Model comes from `ANTHROPIC_MODEL`
 * (default `claude-sonnet-5`). Thinking is disabled on this customer-reply path
 * to keep chat latency low; prompt caching is applied to the system prefix by
 * the prompt builder.
 */
export function anthropicClient(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  const sdk = new Anthropic({ apiKey });

  return {
    async create({ system, messages, tools, maxTokens }) {
      const res = await sdk.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        system: system as Anthropic.TextBlockParam[],
        messages: messages as unknown as Anthropic.MessageParam[],
        tools: tools as Anthropic.Tool[],
      });

      const content: AssistantBlock[] = [];
      for (const block of res.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") {
          content.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      return {
        stopReason: res.stop_reason ?? "end_turn",
        content,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        model: res.model,
      };
    },
  };
}
