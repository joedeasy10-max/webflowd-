import { getDb, type Database } from "../db/client.js";
import { writeAudit } from "../audit/index.js";
import type { TenantContext } from "../tenancy/index.js";
import { findOrCreateContact } from "../repos/contacts.js";
import { appendMessage, createConversation } from "../repos/conversations.js";
import { getProfile } from "../repos/profile.js";

export interface VoicemailInput {
  callSid: string;
  recordingSid: string;
  recordingUrl?: string | null;
  transcription?: string | null;
  /** The caller's number (customer) — the SMS recipient. */
  callerNumber: string;
  /** The tenant's business number that was called — the SMS sender. */
  businessNumber: string;
}

export interface VoicemailDeps {
  db?: Database;
  channelId?: string | null;
  /** Send an SMS from the business number to the caller (real Twilio in the webhook). */
  sendSms?(input: { to: string; from: string; body: string }): Promise<void>;
  /** Override the courtesy text-back sent to the caller. */
  messageText?: string;
}

export interface VoicemailResult {
  outcome: "texted" | "skipped_opt_out" | "no_sender";
  conversationId: string;
}

/**
 * Voicemail receptionist: store an unanswered call's voicemail (transcription +
 * recording link) as an inbound message the owner can see, then SMS the caller a
 * courtesy follow-up. Honours STOP/opt-out before sending; audit-logged.
 * Tenant-scoped — call inside `runInTenant`.
 */
export async function handleVoicemail(
  ctx: TenantContext,
  input: VoicemailInput,
  deps: VoicemailDeps = {},
): Promise<VoicemailResult> {
  const db = deps.db ?? getDb();
  const contact = await findOrCreateContact(ctx, { phone: input.callerNumber }, db);

  const conversation = await createConversation(
    ctx,
    { contactId: contact.id, channelId: deps.channelId ?? null, subject: "Voicemail" },
    db,
  );

  const transcript = input.transcription?.trim();
  const body = transcript
    ? `Voicemail from ${input.callerNumber}: "${transcript}"`
    : `Voicemail from ${input.callerNumber}${
        input.recordingUrl ? ` — recording: ${input.recordingUrl}` : " (no transcription)"
      }`;
  await appendMessage(
    ctx,
    {
      conversationId: conversation.id,
      direction: "inbound",
      role: "customer",
      body,
      providerMessageId: input.recordingSid,
    },
    db,
  );

  const profile = await getProfile(ctx, db);
  const text =
    deps.messageText ??
    `Hi, thanks for your voicemail — this is ${
      profile?.displayName ?? "us"
    }. We've got your message and will be in touch shortly. You can also reply here.`;

  let outcome: VoicemailResult["outcome"] = "no_sender";
  if (contact.messagingOptOut) {
    outcome = "skipped_opt_out";
  } else if (deps.sendSms) {
    await deps.sendSms({ to: input.callerNumber, from: input.businessNumber, body: text });
    await appendMessage(
      ctx,
      { conversationId: conversation.id, direction: "outbound", role: "ai", body: text },
      db,
    );
    outcome = "texted";
  }

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "system",
      action: "voicemail.received",
      entityType: "conversation",
      entityId: conversation.id,
      metadata: { callSid: input.callSid, recordingSid: input.recordingSid, outcome },
    },
    db,
  );

  return { outcome, conversationId: conversation.id };
}
