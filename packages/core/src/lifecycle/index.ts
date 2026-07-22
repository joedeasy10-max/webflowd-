import { and, eq, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { DEFAULT_TIMEZONE } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import {
  bookings,
  businessProfiles,
  contacts,
  reminders,
  reviewRequests,
  services,
} from "../db/schema.js";
import { runInTenant, type TenantContext } from "../tenancy/index.js";

type LifecycleChannel = "email" | "sms";

/** Injected senders (real ones from env in the Inngest job; fakes in tests). */
export interface LifecycleSender {
  email?(to: string, subject: string, text: string): Promise<void>;
  sms?(to: string, body: string): Promise<void>;
}

export interface ContactLike {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  messagingOptOut?: boolean;
}

const REMINDER_OFFSETS_MIN = [24 * 60, 2 * 60];
const REVIEW_DELAY_MIN = 120;

function pickChannel(contact: ContactLike | null): LifecycleChannel | null {
  if (contact?.phone) return "sms";
  if (contact?.email) return "email";
  return null;
}

/**
 * Schedule reminders + a review request when a booking is confirmed. Called from
 * the booking engine. No-ops if the contact has no usable channel.
 */
export async function scheduleBookingLifecycle(
  ctx: TenantContext,
  input: { bookingId: string; startAt: Date; contact: ContactLike | null },
  database: Database = getDb(),
): Promise<void> {
  const channel = pickChannel(input.contact);
  if (!channel) return;
  const now = Date.now();

  for (const off of REMINDER_OFFSETS_MIN) {
    const sendAt = new Date(input.startAt.getTime() - off * 60_000);
    if (sendAt.getTime() > now) {
      await database.insert(reminders).values({
        tenantId: ctx.tenantId,
        bookingId: input.bookingId,
        channel,
        sendAt,
        status: "scheduled",
        template: `reminder_${off}`,
      });
    }
  }
  await database
    .insert(reviewRequests)
    .values({ tenantId: ctx.tenantId, bookingId: input.bookingId, channel, status: "scheduled" });
}

function localTime(d: Date, tz = DEFAULT_TIMEZONE): string {
  return DateTime.fromJSDate(d).setZone(tz).toFormat("cccc d LLLL, HH:mm");
}

async function loadForBooking(ctx: TenantContext, bookingId: string, tx: Database) {
  const booking = await tx.query.bookings.findFirst({
    where: and(eq(bookings.id, bookingId), eq(bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) return null;
  const contact = booking.contactId
    ? await tx.query.contacts.findFirst({ where: eq(contacts.id, booking.contactId) })
    : null;
  const service = booking.serviceId
    ? await tx.query.services.findFirst({ where: eq(services.id, booking.serviceId) })
    : null;
  const profile = await tx.query.businessProfiles.findFirst({
    where: eq(businessProfiles.tenantId, ctx.tenantId),
  });
  return { booking, contact, service, profile };
}

async function deliver(
  channel: string,
  contact: { email?: string | null; phone?: string | null },
  subject: string,
  text: string,
  sender: LifecycleSender,
): Promise<boolean> {
  if (channel === "sms" && contact.phone && sender.sms) {
    await sender.sms(contact.phone, `${subject}: ${text}`);
    return true;
  }
  if (contact.email && sender.email) {
    await sender.email(contact.email, subject, text);
    return true;
  }
  return false;
}

export interface ProcessResult {
  sent: number;
  skipped: number;
  failed: number;
}

/** Send all due appointment reminders. Cross-tenant; honours STOP/opt-out. */
export async function processDueReminders(
  opts: { sender: LifecycleSender; now?: Date; limit?: number },
  database: Database = getDb(),
): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const due = await database
    .select({
      id: reminders.id,
      tenantId: reminders.tenantId,
      bookingId: reminders.bookingId,
      template: reminders.template,
    })
    .from(reminders)
    .where(and(eq(reminders.status, "scheduled"), lte(reminders.sendAt, now)))
    .limit(opts.limit ?? 200);

  const result: ProcessResult = { sent: 0, skipped: 0, failed: 0 };
  for (const row of due) {
    const ctx: TenantContext = { tenantId: row.tenantId, userId: "system", role: "owner" };
    let status: "sent" | "skipped" | "failed" = "skipped";
    try {
      await runInTenant(
        ctx,
        async (tx) => {
          const data = await loadForBooking(ctx, row.bookingId, tx);
          if (!data || ["cancelled", "no_show"].includes(data.booking.status)) return;
          if (data.contact?.messagingOptOut) return;
          const subject = `Reminder: ${data.service?.name ?? "your appointment"}`;
          const text = `Hi${data.contact?.name ? ` ${data.contact.name}` : ""}, this is a reminder for ${localTime(
            data.booking.startAt,
          )} with ${data.profile?.displayName ?? "us"}.`;
          const delivered = await deliver(
            reminderChannel(row.template),
            data.contact ?? {},
            subject,
            text,
            opts.sender,
          );
          status = delivered ? "sent" : "skipped";
        },
        database,
      );
    } catch {
      status = "failed";
    }
    await database.update(reminders).set({ status }).where(eq(reminders.id, row.id));
    result[status] += 1;
  }
  return result;
}

function reminderChannel(template: string | null): string {
  return template?.includes("sms") ? "sms" : "email";
}

/** Send review requests for jobs that have finished. Cross-tenant; honours opt-out. */
export async function processDueReviewRequests(
  opts: {
    sender: LifecycleSender;
    now?: Date;
    limit?: number;
    reviewLink?: (tenantId: string) => string | undefined;
  },
  database: Database = getDb(),
): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const due = await database
    .select({
      id: reviewRequests.id,
      tenantId: reviewRequests.tenantId,
      bookingId: reviewRequests.bookingId,
    })
    .from(reviewRequests)
    .where(eq(reviewRequests.status, "scheduled"))
    .limit(opts.limit ?? 200);

  const result: ProcessResult = { sent: 0, skipped: 0, failed: 0 };
  for (const row of due) {
    const ctx: TenantContext = { tenantId: row.tenantId, userId: "system", role: "owner" };
    // Holder object so TS keeps the full union (callback mutations aren't flow-tracked).
    const box: { outcome: "sent" | "skipped" | "failed" | "pending" } = { outcome: "pending" };
    try {
      await runInTenant(
        ctx,
        async (tx) => {
          const data = await loadForBooking(ctx, row.bookingId, tx);
          if (!data || ["cancelled", "no_show", "proposed"].includes(data.booking.status)) {
            box.outcome = "skipped";
            return;
          }
          // Only after the job has finished (+ delay).
          if (data.booking.endAt.getTime() + REVIEW_DELAY_MIN * 60_000 > now.getTime()) {
            box.outcome = "pending";
            return;
          }
          if (data.contact?.messagingOptOut) {
            box.outcome = "skipped";
            return;
          }
          const link = opts.reviewLink?.(row.tenantId);
          const subject = `How did we do?`;
          const text = `Hi${data.contact?.name ? ` ${data.contact.name}` : ""}, thanks for choosing ${
            data.profile?.displayName ?? "us"
          }. We'd really appreciate a review${link ? `: ${link}` : "."}`;
          const delivered = await deliver("", data.contact ?? {}, subject, text, opts.sender);
          box.outcome = delivered ? "sent" : "skipped";
        },
        database,
      );
    } catch {
      box.outcome = "failed";
    }
    if (box.outcome === "pending") continue; // leave scheduled for a later run
    await database
      .update(reviewRequests)
      .set({ status: box.outcome, sentAt: box.outcome === "sent" ? now : null })
      .where(eq(reviewRequests.id, row.id));
    result[box.outcome] += 1;
  }
  return result;
}
