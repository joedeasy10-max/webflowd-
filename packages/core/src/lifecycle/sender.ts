import { sendEmailViaSendGrid, sendSmsViaTwilio } from "../channels/notify/index.js";
import type { LifecycleSender } from "./index.js";

/**
 * Build a real {@link LifecycleSender} from environment configuration for use in
 * the Inngest cron jobs. The cron scans across tenants, so a platform-level
 * "from" address (`SENDGRID_FROM` / `TWILIO_SMS_FROM`) is used rather than a
 * per-tenant one. Channels that aren't configured are simply omitted, so the
 * processors fall back to whatever channel is available (or skip).
 */
export function buildLifecycleSender(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): LifecycleSender {
  const sender: LifecycleSender = {};

  if (env.SENDGRID_API_KEY && env.SENDGRID_FROM) {
    const apiKey = env.SENDGRID_API_KEY;
    const from = env.SENDGRID_FROM;
    sender.email = (to, subject, text) =>
      sendEmailViaSendGrid({ apiKey, from, to, subject, text }, fetchImpl);
  }

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_SMS_FROM) {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_SMS_FROM;
    sender.sms = (to, body) =>
      sendSmsViaTwilio({ accountSid, authToken, from, to, body }, fetchImpl);
  }

  return sender;
}
