import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { contacts, quotes } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { TenantError, guardRow, type TenantContext } from "../tenancy/index.js";

export interface CreateQuoteInput {
  contactId?: string | null;
  conversationId?: string | null;
  serviceId?: string | null;
  description: string;
  amountPence: number;
  currency?: string;
  validUntil?: Date | null;
}

export async function createQuote(
  ctx: TenantContext,
  input: CreateQuoteInput,
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(quotes)
    .values({
      tenantId: ctx.tenantId,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      serviceId: input.serviceId ?? null,
      description: input.description,
      amountPence: input.amountPence,
      currency: input.currency ?? "gbp",
      status: "draft",
      validUntil: input.validUntil ?? null,
    })
    .returning();
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "quote.created",
      entityType: "quote",
      entityId: row!.id,
      metadata: { amountPence: input.amountPence },
    },
    database,
  );
  return row!;
}

export async function listQuotes(ctx: TenantContext, database: Database = getDb()) {
  return database.query.quotes.findMany({
    where: eq(quotes.tenantId, ctx.tenantId),
    orderBy: (q, { desc }) => [desc(q.createdAt)],
    limit: 200,
  });
}

export async function getQuote(ctx: TenantContext, quoteId: string, database: Database = getDb()) {
  const row = await database.query.quotes.findFirst({
    where: and(eq(quotes.id, quoteId), eq(quotes.tenantId, ctx.tenantId)),
  });
  return guardRow(ctx, row ?? null);
}

export async function updateQuoteStatus(
  ctx: TenantContext,
  quoteId: string,
  status: "accepted" | "declined" | "expired",
  database: Database = getDb(),
) {
  const rows = await database
    .update(quotes)
    .set({ status })
    .where(and(eq(quotes.id, quoteId), eq(quotes.tenantId, ctx.tenantId)))
    .returning({ id: quotes.id });
  if (rows.length === 0) throw new TenantError("Quote not found", 404);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "quote.updated",
      entityType: "quote",
      entityId: quoteId,
      metadata: { status },
    },
    database,
  );
}

/** Injected sender so quotes can be delivered without importing provider details. */
export interface QuoteSender {
  email?(to: string, subject: string, text: string): Promise<void>;
  sms?(to: string, body: string): Promise<void>;
}

/**
 * Mark a quote as sent and deliver it to the contact. Honours STOP/opt-out
 * before any outbound message. Returns whether a message was actually delivered.
 */
export async function sendQuote(
  ctx: TenantContext,
  quoteId: string,
  deps: { sender: QuoteSender; businessName?: string; now?: Date },
  database: Database = getDb(),
): Promise<{ delivered: boolean }> {
  const quote = await getQuote(ctx, quoteId, database);
  if (!quote) throw new TenantError("Quote not found", 404);

  const contact = quote.contactId
    ? await database.query.contacts.findFirst({
        where: and(eq(contacts.id, quote.contactId), eq(contacts.tenantId, ctx.tenantId)),
      })
    : null;

  const amount = `£${(quote.amountPence / 100).toFixed(2)}`;
  const subject = `Your quote from ${deps.businessName ?? "us"}`;
  const text = `Hi${contact?.name ? ` ${contact.name}` : ""}, here's your quote: ${quote.description} — ${amount}.${
    quote.validUntil ? ` Valid until ${quote.validUntil.toDateString()}.` : ""
  } Reply to book it in.`;

  let delivered = false;
  if (!contact?.messagingOptOut) {
    if (contact?.phone && deps.sender.sms) {
      await deps.sender.sms(contact.phone, `${subject}: ${text}`);
      delivered = true;
    } else if (contact?.email && deps.sender.email) {
      await deps.sender.email(contact.email, subject, text);
      delivered = true;
    }
  }

  await database
    .update(quotes)
    .set({ status: "sent", sentAt: deps.now ?? new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.tenantId, ctx.tenantId)));
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "quote.sent",
      entityType: "quote",
      entityId: quoteId,
      metadata: { delivered },
    },
    database,
  );
  return { delivered };
}
