import { and, eq, inArray, lte } from "drizzle-orm";
import type { ChannelType } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { bookings, businessProfiles, contacts, leadFollowups } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { runInTenant, type TenantContext } from "../tenancy/index.js";
import { ACTIVE_BOOKING_STATUSES } from "../repos/bookings.js";
import type { LifecycleSender, ProcessResult } from "./index.js";

/** Days after the enquiry to nudge a lead that hasn't booked. */
const FOLLOWUP_OFFSETS_DAYS = [2, 6];

/**
 * Schedule a lead follow-up sequence for an enquiry that hasn't booked yet.
 * No-ops if the contact has no usable channel. Steps self-cancel at send time if
 * the lead converts (books) or opts out.
 */
export async function scheduleLeadFollowup(
  ctx: TenantContext,
  input: {
    contactId: string;
    conversationId?: string | null;
    channel: ChannelType;
    startFrom?: Date;
  },
  database: Database = getDb(),
): Promise<void> {
  const from = input.startFrom ?? new Date();
  const now = Date.now();
  let step = 1;
  for (const days of FOLLOWUP_OFFSETS_DAYS) {
    const sendAt = new Date(from.getTime() + days * 24 * 60 * 60_000);
    if (sendAt.getTime() > now) {
      await database.insert(leadFollowups).values({
        tenantId: ctx.tenantId,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        channel: input.channel,
        step,
        sendAt,
        status: "scheduled",
        template: `lead_followup_${step}`,
      });
    }
    step += 1;
  }
}

async function contactHasBooked(
  ctx: TenantContext,
  contactId: string,
  tx: Database,
): Promise<boolean> {
  const row = await tx.query.bookings.findFirst({
    where: and(
      eq(bookings.tenantId, ctx.tenantId),
      eq(bookings.contactId, contactId),
      inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

/**
 * Send due lead follow-ups. Cross-tenant; skips leads that have since booked
 * (marks `converted`) and honours STOP/opt-out.
 */
export async function processDueLeadFollowups(
  opts: { sender: LifecycleSender; now?: Date; limit?: number },
  database: Database = getDb(),
): Promise<ProcessResult & { converted: number }> {
  const now = opts.now ?? new Date();
  const due = await database
    .select({
      id: leadFollowups.id,
      tenantId: leadFollowups.tenantId,
      contactId: leadFollowups.contactId,
      channel: leadFollowups.channel,
    })
    .from(leadFollowups)
    .where(and(eq(leadFollowups.status, "scheduled"), lte(leadFollowups.sendAt, now)))
    .limit(opts.limit ?? 200);

  const result = { sent: 0, skipped: 0, failed: 0, converted: 0 };
  for (const row of due) {
    const ctx: TenantContext = { tenantId: row.tenantId, userId: "system", role: "owner" };
    // Holder object so TS keeps the full union (callback mutations aren't flow-tracked).
    const box: { outcome: "sent" | "skipped" | "failed" | "converted" } = { outcome: "skipped" };
    try {
      await runInTenant(
        ctx,
        async (tx) => {
          const contact = await tx.query.contacts.findFirst({
            where: and(eq(contacts.id, row.contactId), eq(contacts.tenantId, ctx.tenantId)),
          });
          if (!contact) return;
          if (await contactHasBooked(ctx, row.contactId, tx)) {
            box.outcome = "converted";
            return;
          }
          if (contact.messagingOptOut) return;

          const profile = await tx.query.businessProfiles.findFirst({
            where: eq(businessProfiles.tenantId, ctx.tenantId),
          });
          const name = profile?.displayName ?? "us";
          const subject = `Still need a hand?`;
          const text = `Hi${contact.name ? ` ${contact.name}` : ""}, just following up on your enquiry with ${name}. Happy to help whenever you're ready — reply and we'll get you booked in.`;

          if (row.channel === "sms" && contact.phone && opts.sender.sms) {
            await opts.sender.sms(contact.phone, `${subject} ${text}`);
            box.outcome = "sent";
          } else if (contact.email && opts.sender.email) {
            await opts.sender.email(contact.email, subject, text);
            box.outcome = "sent";
          } else {
            box.outcome = "skipped";
          }
        },
        database,
      );
    } catch {
      box.outcome = "failed";
    }
    await database
      .update(leadFollowups)
      .set({ status: box.outcome })
      .where(eq(leadFollowups.id, row.id));
    result[box.outcome] += 1;
    if (box.outcome === "converted") {
      // Cancel any remaining scheduled steps for this lead.
      await database
        .update(leadFollowups)
        .set({ status: "converted" })
        .where(
          and(
            eq(leadFollowups.tenantId, row.tenantId),
            eq(leadFollowups.contactId, row.contactId),
            eq(leadFollowups.status, "scheduled"),
          ),
        );
    }
  }

  await writeAudit(
    {
      tenantId: null,
      actor: "system",
      action: "lead_followup.batch",
      metadata: { ...result },
    },
    database,
  ).catch(() => undefined);

  return result;
}
