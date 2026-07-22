import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Twilio webhook signature (`X-Twilio-Signature`).
 *
 * Twilio builds the signature by taking the full request URL, appending each
 * POST parameter's name and value in alphabetical order (no separators), then
 * HMAC-SHA1 with the account auth token and base64-encoding the result. See
 * https://www.twilio.com/docs/usage/security#validating-requests.
 *
 * `params` are the application/x-www-form-urlencoded body fields.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  signature: string,
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
