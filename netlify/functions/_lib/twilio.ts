import { verifyTwilioSignature } from "@webflowd/core";

/** Escape text for inclusion in TwiML/XML (Say/Gather bodies). */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap a TwiML `<Response>` body in a text/xml HTTP response. */
export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

/**
 * The exact public URL Twilio signed. Twilio signs the full URL it requested
 * (including query string), which behind a rewriting proxy may differ from
 * `req.url`'s host. Set TWILIO_PUBLIC_BASE_URL (scheme + host, no trailing slash)
 * to pin the host while preserving the real path + query.
 */
export function publicUrl(req: Request): string {
  const base = process.env.TWILIO_PUBLIC_BASE_URL;
  if (!base) return req.url;
  const u = new URL(req.url);
  return `${base.replace(/\/$/, "")}${u.pathname}${u.search}`;
}

/**
 * Build an absolute URL for a Twilio action callback (path + query), on the same
 * public host as the current request. Absolute URLs keep the next request's
 * signature verification stable (Twilio signs the exact URL it calls).
 */
export function absoluteUrl(req: Request, pathAndQuery: string): string {
  const base = process.env.TWILIO_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}${pathAndQuery}`;
}

/**
 * Parse a Twilio form POST and verify its signature in one step. Returns the
 * decoded params on success, or null if the signature is invalid/misconfigured.
 */
export async function readVerifiedTwilio(req: Request): Promise<Record<string, string> | null> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return null;
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!verifyTwilioSignature(publicUrl(req), params, authToken, signature)) return null;
  return params;
}

/**
 * Build a `<Say>` + `<Gather input="speech">` turn. The gather posts the caller's
 * speech to `actionPath` (which carries the conversation id + reprompt count),
 * so the flow is fully stateless across Netlify function invocations.
 */
export function sayAndGather(opts: {
  say: string;
  actionUrl: string;
  voice?: string;
  language?: string;
  /** Seconds of silence to end a turn, or null/undefined for adaptive "auto". */
  speechTimeoutSec?: number | null;
}): string {
  const voice = opts.voice ?? "Polly.Amy"; // UK English neural voice
  const language = opts.language ?? "en-GB";
  const speechTimeout = opts.speechTimeoutSec ? String(opts.speechTimeoutSec) : "auto";
  return (
    `<Gather input="speech" action="${escapeXml(opts.actionUrl)}" method="POST"` +
    ` speechTimeout="${speechTimeout}" language="${language}" actionOnEmptyResult="true">` +
    `<Say voice="${voice}" language="${language}">${escapeXml(opts.say)}</Say>` +
    `</Gather>`
  );
}

/** Build a `<Say>` + `<Hangup/>` closing turn. */
export function sayAndHangup(say: string, voice = "Polly.Amy", language = "en-GB"): string {
  return `<Say voice="${voice}" language="${language}">${escapeXml(say)}</Say><Hangup/>`;
}
