import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe deposit checkout + webhook signature verification (via fetch/crypto). */

export interface DepositCheckoutInput {
  amountPence: number;
  currency: string; // e.g. "gbp"
  bookingId: string;
  tenantId: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createStripeCheckout(
  secretKey: string,
  input: DepositCheckoutInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; url: string }> {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", input.currency);
  form.set("line_items[0][price_data][unit_amount]", String(input.amountPence));
  form.set("line_items[0][price_data][product_data][name]", input.description);
  form.set("metadata[booking_id]", input.bookingId);
  form.set("metadata[tenant_id]", input.tenantId);
  form.set("payment_intent_data[metadata][booking_id]", input.bookingId);
  form.set("payment_intent_data[metadata][tenant_id]", input.tenantId);

  const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.id || !body.url) {
    throw new Error(`Stripe checkout failed: ${body.error?.message ?? res.status}`);
  }
  return { id: body.id, url: body.url };
}

/**
 * Verify a Stripe webhook signature (`Stripe-Signature: t=...,v1=...`). Returns
 * true only if a v1 signature matches and the timestamp is within tolerance.
 */
export function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  toleranceSec = 300,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v] as const;
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function metadataFromStripeEvent(event: unknown): Record<string, unknown> {
  const obj = (event as { data?: { object?: Record<string, unknown> } })?.data?.object;
  return (obj?.metadata ?? {}) as Record<string, unknown>;
}

/** Extract booking + tenant ids from a checkout.session / payment_intent event. */
export function idsFromStripeEvent(event: unknown): { bookingId: string; tenantId: string } | null {
  const meta = metadataFromStripeEvent(event);
  const bookingId = meta.booking_id;
  const tenantId = meta.tenant_id;
  return typeof bookingId === "string" && typeof tenantId === "string"
    ? { bookingId, tenantId }
    : null;
}
