import type { Config } from "@netlify/functions";
import {
  buildBookingDeps,
  claimWebhookEvent,
  confirmDepositPaid,
  idsFromStripeEvent,
  markWebhookProcessed,
  releaseWebhookEvent,
  runInTenant,
  verifyStripeSignature,
  type TenantContext,
} from "@webflowd/core";

const HANDLED_EVENTS = new Set(["checkout.session.completed", "payment_intent.succeeded"]);

/**
 * POST /webhooks/stripe — deposit payment confirmation.
 * Verifies the Stripe signature, dedupes by event id, and confirms the booking
 * (which writes the calendar event and sends confirmations). On a processing
 * failure the claim is released so Stripe's retry can reprocess.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(payload, sig, secret)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { id?: string; type?: string };
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  if (!event.id || !event.type) return new Response("Bad payload", { status: 400 });

  const claimed = await claimWebhookEvent("stripe", event.id);
  if (!claimed) return new Response("Already processed", { status: 200 });

  try {
    if (HANDLED_EVENTS.has(event.type)) {
      const ids = idsFromStripeEvent(event);
      if (ids) {
        const ctx: TenantContext = { tenantId: ids.tenantId, userId: "system", role: "owner" };
        await runInTenant(ctx, async (tx) => {
          const deps = await buildBookingDeps(ctx, { db: tx, env: process.env });
          await confirmDepositPaid(ctx, ids.bookingId, deps);
        });
      }
    }
    await markWebhookProcessed("stripe", event.id);
    return new Response("ok", { status: 200 });
  } catch (err) {
    await releaseWebhookEvent("stripe", event.id).catch(() => undefined);
    console.error("Stripe webhook processing failed:", (err as Error).message);
    return new Response("Processing error", { status: 500 });
  }
};

export const config: Config = { path: "/webhooks/stripe" };
