import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripeCheckout, idsFromStripeEvent, verifyStripeSignature } from "./stripe.js";

function sign(payload: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts a valid, fresh signature", () => {
    const now = 1_800_000_000;
    const header = sign(payload, secret, now);
    expect(verifyStripeSignature(payload, header, secret, 300, now)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const now = 1_800_000_000;
    const header = sign(payload, secret, now);
    expect(verifyStripeSignature(payload + " ", header, secret, 300, now)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const now = 1_800_000_000;
    const header = sign(payload, secret, now);
    expect(verifyStripeSignature(payload, header, "whsec_other", 300, now)).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const t = 1_800_000_000;
    const header = sign(payload, secret, t);
    expect(verifyStripeSignature(payload, header, secret, 300, t + 10_000)).toBe(false);
  });
});

describe("idsFromStripeEvent", () => {
  it("extracts booking and tenant ids from metadata", () => {
    const event = { data: { object: { metadata: { booking_id: "b1", tenant_id: "t1" } } } };
    expect(idsFromStripeEvent(event)).toEqual({ bookingId: "b1", tenantId: "t1" });
  });
  it("returns null when metadata is missing", () => {
    expect(idsFromStripeEvent({ data: { object: {} } })).toBeNull();
  });
});

describe("createStripeCheckout", () => {
  it("posts amount, currency, and metadata, and returns the url", async () => {
    let capturedBody: URLSearchParams | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
      capturedBody = init.body;
      return { ok: true, status: 200, json: async () => ({ id: "cs_1", url: "https://pay/1" }) };
    }) as unknown as typeof fetch;

    const res = await createStripeCheckout(
      "sk_test",
      {
        amountPence: 5000,
        currency: "gbp",
        bookingId: "b1",
        tenantId: "t1",
        description: "Deposit",
        successUrl: "https://x/ok",
        cancelUrl: "https://x/no",
      },
      fetchImpl,
    );
    expect(res).toEqual({ id: "cs_1", url: "https://pay/1" });
    expect(capturedBody!.get("line_items[0][price_data][unit_amount]")).toBe("5000");
    expect(capturedBody!.get("metadata[booking_id]")).toBe("b1");
    expect(capturedBody!.get("metadata[tenant_id]")).toBe("t1");
  });
});
