import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, escapeXml, publicUrl, sayAndGather, sayAndHangup, twiml } from "./twilio.js";

afterEach(() => {
  delete process.env.TWILIO_PUBLIC_BASE_URL;
});

describe("escapeXml", () => {
  it("escapes XML metacharacters", () => {
    expect(escapeXml(`Tom & "Jerry" <b> 'x'`)).toBe(
      "Tom &amp; &quot;Jerry&quot; &lt;b&gt; &apos;x&apos;",
    );
  });
});

describe("twiml", () => {
  it("wraps a body in a Response envelope with xml content-type", async () => {
    const res = twiml("<Hangup/>");
    expect(res.headers.get("content-type")).toContain("text/xml");
    const text = await res.text();
    expect(text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });
});

describe("sayAndGather", () => {
  it("builds a speech Gather that posts to the action url and escapes the prompt", () => {
    const out = sayAndGather({
      say: "Hi & welcome",
      actionUrl: "https://x/webhooks/twilio/voice-turn?cid=abc&r=1",
    });
    expect(out).toContain('input="speech"');
    expect(out).toContain('method="POST"');
    // both the prompt and the URL ampersands are escaped
    expect(out).toContain("Hi &amp; welcome");
    expect(out).toContain("cid=abc&amp;r=1");
  });
});

describe("sayAndHangup", () => {
  it("says then hangs up", () => {
    expect(sayAndHangup("Bye")).toBe('<Say voice="Polly.Amy" language="en-GB">Bye</Say><Hangup/>');
  });
});

describe("publicUrl / absoluteUrl", () => {
  const req = new Request("https://internal.local/webhooks/twilio/voice-turn?cid=abc");

  it("returns the request url when no base override is set", () => {
    expect(publicUrl(req)).toBe("https://internal.local/webhooks/twilio/voice-turn?cid=abc");
  });

  it("pins the host from TWILIO_PUBLIC_BASE_URL, preserving path + query", () => {
    process.env.TWILIO_PUBLIC_BASE_URL = "https://webflowd.com";
    expect(publicUrl(req)).toBe("https://webflowd.com/webhooks/twilio/voice-turn?cid=abc");
    expect(absoluteUrl(req, "/webhooks/twilio/voice-turn?cid=xyz")).toBe(
      "https://webflowd.com/webhooks/twilio/voice-turn?cid=xyz",
    );
  });

  it("uses the request origin for absolute urls without an override", () => {
    expect(absoluteUrl(req, "/a?b=1")).toBe("https://internal.local/a?b=1");
  });
});
