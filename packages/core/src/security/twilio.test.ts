import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTwilioSignature } from "./twilio.js";

function sign(url: string, params: Record<string, string>, token: string): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64");
}

describe("verifyTwilioSignature", () => {
  const token = "auth_token_test";
  const url = "https://webflowd.com/webhooks/twilio/voice";
  const params = {
    CallSid: "CA123",
    CallStatus: "no-answer",
    From: "+447700900001",
    To: "+441234",
  };

  it("accepts a valid signature", () => {
    expect(verifyTwilioSignature(url, params, token, sign(url, params, token))).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    const good = sign(url, params, token);
    const tampered = { ...params, From: "+440000000000" };
    expect(verifyTwilioSignature(url, tampered, token, good)).toBe(false);
  });

  it("rejects the wrong auth token", () => {
    expect(verifyTwilioSignature(url, params, token, sign(url, params, "other"))).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyTwilioSignature(url, params, token, "")).toBe(false);
  });

  it("is order-independent (params sorted)", () => {
    const reordered = {
      To: "+441234",
      From: "+447700900001",
      CallStatus: "no-answer",
      CallSid: "CA123",
    };
    expect(verifyTwilioSignature(url, reordered, token, sign(url, params, token))).toBe(true);
  });
});
