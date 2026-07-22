import { DateTime } from "luxon";
import { DEFAULT_TIMEZONE, type ConnectionProvider } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import type { TenantContext } from "../tenancy/index.js";
import { getProfile } from "../repos/profile.js";
import { listConnections } from "../repos/connections.js";
import { getValidAccessToken, ConnectionReauthError } from "../channels/oauth/token-manager.js";
import { readFreeBusy } from "../channels/calendar/index.js";
import { createCalendarEvent, cancelCalendarEvent } from "../channels/calendar/write.js";
import { createStripeCheckout } from "../channels/payments/stripe.js";
import { sendEmailViaSendGrid, sendSmsViaTwilio } from "../channels/notify/index.js";
import type { BookingDeps, CalendarPort, NotifyPort, PaymentPort } from "./index.js";
import type { Interval } from "../availability/index.js";

export interface BuildDepsOptions {
  db?: Database;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** If set, preload the connected calendar's busy times for this range. */
  busyRange?: { from: Date; to: Date };
}

/**
 * Assemble real booking side-effect ports from env + the tenant's connections.
 * Returns `null` ports when the corresponding integration isn't configured, so
 * the booking engine degrades gracefully (e.g. no calendar → no event written).
 */
export async function buildBookingDeps(
  ctx: TenantContext,
  opts: BuildDepsOptions = {},
): Promise<BookingDeps> {
  const db = opts.db ?? getDb();
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Calendar port (first active Google/Microsoft connection).
  let calendar: CalendarPort | null = null;
  let externalBusy: Interval[] = [];
  const connections = await listConnections(ctx, db);
  const conn = connections.find(
    (c) => c.status === "active" && (c.provider === "google" || c.provider === "microsoft"),
  );
  if (conn) {
    try {
      const accessToken = await getValidAccessToken(ctx, conn.id, { database: db, env, fetchImpl });
      const provider = conn.provider as ConnectionProvider;
      calendar = {
        provider,
        createEvent: (evt) => createCalendarEvent(provider, accessToken, evt, fetchImpl),
        cancelEvent: (eventId) => cancelCalendarEvent(provider, accessToken, eventId, fetchImpl),
      };
      if (opts.busyRange) {
        externalBusy = await readFreeBusy(
          provider,
          accessToken,
          { timeMin: opts.busyRange.from, timeMax: opts.busyRange.to },
          fetchImpl,
        );
      }
    } catch (err) {
      if (!(err instanceof ConnectionReauthError)) throw err;
      // Calendar needs re-auth: proceed without it (booking still records in DB).
    }
  }

  // Stripe payments port.
  const stripeKey = env.STRIPE_SECRET_KEY;
  const appBase = (env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const payments: PaymentPort | null = stripeKey
    ? {
        createDepositCheckout: (input) =>
          createStripeCheckout(
            stripeKey,
            {
              ...input,
              tenantId: ctx.tenantId,
              successUrl: `${appBase}/app/?paid=${input.bookingId}`,
              cancelUrl: `${appBase}/app/?paycancel=${input.bookingId}`,
            },
            fetchImpl,
          ).then((r) => ({ url: r.url, reference: r.id })),
      }
    : null;

  // Notifications (email + SMS), best-effort.
  const profile = await getProfile(ctx, db);
  const notify: NotifyPort = {
    async booking(n) {
      const when = DateTime.fromJSDate(n.booking.startAt)
        .setZone(n.booking.tz || DEFAULT_TIMEZONE)
        .toFormat("cccc d LLLL, HH:mm");
      const verb =
        n.kind === "cancelled"
          ? "cancelled"
          : n.kind === "rescheduled"
            ? "rescheduled"
            : "confirmed";
      const subject = `Your ${n.serviceName} booking is ${verb}`;
      const text = `Hi${n.contact?.name ? ` ${n.contact.name}` : ""},\n\nYour ${n.serviceName} appointment is ${verb} for ${when}.\n\n— ${profile?.displayName ?? "The team"}`;

      const jobs: Array<Promise<unknown>> = [];
      if (env.SENDGRID_API_KEY && profile?.replyEmail && n.contact?.email) {
        jobs.push(
          sendEmailViaSendGrid(
            {
              apiKey: env.SENDGRID_API_KEY,
              from: profile.replyEmail,
              to: n.contact.email,
              subject,
              text,
            },
            fetchImpl,
          ),
        );
      }
      if (
        env.TWILIO_ACCOUNT_SID &&
        env.TWILIO_AUTH_TOKEN &&
        env.TWILIO_SMS_FROM &&
        n.contact?.phone
      ) {
        jobs.push(
          sendSmsViaTwilio(
            {
              accountSid: env.TWILIO_ACCOUNT_SID,
              authToken: env.TWILIO_AUTH_TOKEN,
              from: env.TWILIO_SMS_FROM,
              to: n.contact.phone,
              body: `${subject}: ${when}`,
            },
            fetchImpl,
          ),
        );
      }
      await Promise.allSettled(jobs);
    },
  };

  return {
    db,
    ...(opts.now ? { now: opts.now } : {}),
    calendar,
    payments,
    notify,
    externalBusy,
  };
}
