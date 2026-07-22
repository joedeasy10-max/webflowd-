import { getDb, type Database } from "../db/client.js";
import { aiActions } from "../db/schema.js";
import { redact } from "../security/redact.js";
import type { TenantContext } from "../tenancy/index.js";

/** Record a model tool invocation (input/output redacted) for audit + analytics. */
export async function logAiAction(
  ctx: TenantContext,
  input: {
    conversationId?: string | null;
    toolName: string;
    input?: unknown;
    output?: unknown;
    model?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    latencyMs?: number | null;
    outcome?: string | null;
  },
  database: Database = getDb(),
): Promise<void> {
  await database.insert(aiActions).values({
    tenantId: ctx.tenantId,
    conversationId: input.conversationId ?? null,
    toolName: input.toolName,
    input: input.input === undefined ? null : (redact(input.input) as object),
    output: input.output === undefined ? null : (redact(input.output) as object),
    model: input.model ?? null,
    tokensIn: input.tokensIn ?? null,
    tokensOut: input.tokensOut ?? null,
    latencyMs: input.latencyMs ?? null,
    outcome: input.outcome ?? null,
  });
}
