import { getDb, type Database } from "../db/client.js";
import { writeAudit } from "../audit/index.js";
import type { TenantContext } from "../tenancy/index.js";
import { findOrCreateContact } from "../repos/contacts.js";
import { appendMessage, createConversation } from "../repos/conversations.js";
import { getProfile } from "../repos/profile.js";

export interface MissedCallInput {
  callSid: string;
  /** The caller's number (customer) — the SMS recipient. */
  callerNumber: string;
  /** The tenant's business number that was called — the SMS sender. */
  businessNumber: string;
}

export interface MissedCallDeps {
  db?: Database;
  channelId?: string | null;
  /** Send an SMS from the business number to the caller (real Twilio in the webhook). */
  sendSms?(input: { to: string; from: string; body: string }): Promise<void>;
  /** Override the outbound text (defaults to a friendly text-back). */
  messageText?: string;
}

export interface MissedCallResult {
  outcome: "texted" | "skipped_opt_out" | "no_sender";
  conversationId?: string;
}

/**
 * Missed-call text-back: when a customer's call goes unanswered, open a
 * conversation and SMS them back so no lead is lost. Honours STOP/opt-out
 * (PECR/GDPR) before sending, records the exchange for the owner's dashboard,
 * and audit-logs the action. Tenant-scoped — call inside `runInTenant`.
 */
export async function handleMissedCall(
  ctx: TenantContext,
  input: MissedCallInput,
  deps: MissedCallDeps = {},
): Promise<MissedCallResult> {
  const db = deps.db ?? getDb();
  const contact = await findOrCreateContact(ctx, { phone: input.callerNumber }, db);

  // Honour opt-out before any outbound message.
  if (contact.messagingOptOut) return { outcome: "skipped_opt_out" };

  const profile = await getProfile(ctx, db);
  const body =
    deps.messageText ??
    `Hi, sorry we missed your call — this is ${
      profile?.displayName ?? "us"
    }. Reply to this message and we'll help you right away.`;

  const conversation = await createConversation(
    ctx,
    { contactId: contact.id, channelId: deps.channelId ?? null, subject: "Missed call" },
    db,
  );
  await appendMessage(
    ctx,
    {
      conversationId: conversation.id,
      direction: "inbound",
      role: "system",
      body: `Missed call from ${input.callerNumber}`,
    },
    db,
  );

  let outcome: MissedCallResult["outcome"] = "no_sender";
  if (deps.sendSms) {
    await deps.sendSms({ to: input.callerNumber, from: input.businessNumber, body });
    await appendMessage(
      ctx,
      { conversationId: conversation.id, direction: "outbound", role: "ai", body },
      db,
    );
    outcome = "texted";
  }

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "system",
      action: "missed_call.text_back",
      entityType: "conversation",
      entityId: conversation.id,
      metadata: { callSid: input.callSid, outcome },
    },
    db,
  );

  return { outcome, conversationId: conversation.id };
}
