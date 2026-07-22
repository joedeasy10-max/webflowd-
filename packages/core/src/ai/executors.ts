import { DateTime } from "luxon";
import { DEFAULT_TIMEZONE } from "@webflowd/shared";
import type { Database } from "../db/client.js";
import type { TenantContext } from "../tenancy/index.js";
import { listServices } from "../repos/services.js";
import { getBookingRules, getHours } from "../repos/index.js";
import { listConnections } from "../repos/connections.js";
import { openEscalation } from "../repos/escalations.js";
import { setConversationStatus } from "../repos/conversations.js";
import { getValidAccessToken, ConnectionReauthError } from "../channels/oauth/token-manager.js";
import { readFreeBusy } from "../channels/calendar/index.js";
import { createBooking, BookingConflictError } from "../booking/index.js";
import { buildBookingDeps } from "../booking/ports.js";

export interface ExecutorDeps {
  db: Database;
  conversationId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  escalated?: boolean;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_RANGE_DAYS = 14;

function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function getServiceInfo(
  ctx: TenantContext,
  input: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<ToolOutcome> {
  const all = await listServices(ctx, deps.db);
  const active = all.filter((s) => s.active);
  const filter = typeof input.service_name === "string" ? input.service_name.toLowerCase() : null;
  const chosen = filter ? active.filter((s) => s.name.toLowerCase().includes(filter)) : active;
  if (chosen.length === 0) {
    return {
      content: filter ? `No service matching "${filter}" is listed.` : "No services are listed.",
    };
  }
  const lines = chosen.map(
    (s) =>
      `- ${s.name}: ${s.defaultDurationMin} min` +
      `${s.priceNote ? `, ${s.priceNote}` : ""}` +
      `${s.depositRequired ? ", deposit required" : ""}` +
      `${s.description ? ` — ${s.description}` : ""}`,
  );
  return { content: lines.join("\n") };
}

async function checkAvailability(
  ctx: TenantContext,
  input: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<ToolOutcome> {
  if (!isDate(input.date_from) || !isDate(input.date_to)) {
    return { content: "date_from and date_to must be YYYY-MM-DD.", isError: true };
  }
  const from = DateTime.fromISO(input.date_from, { zone: DEFAULT_TIMEZONE }).startOf("day");
  let to = DateTime.fromISO(input.date_to, { zone: DEFAULT_TIMEZONE }).endOf("day");
  if (!from.isValid || !to.isValid || to < from) {
    return { content: "Invalid date range.", isError: true };
  }
  if (to.diff(from, "days").days > MAX_RANGE_DAYS) {
    to = from.plus({ days: MAX_RANGE_DAYS }).endOf("day");
  }

  const [hours, rules] = await Promise.all([getHours(ctx, deps.db), getBookingRules(ctx, deps.db)]);
  const hoursText = hours
    .slice()
    .sort((a, b) => a.weekday - b.weekday)
    .map((h) =>
      h.closed ? `${WEEKDAYS[h.weekday]}: closed` : `${WEEKDAYS[h.weekday]}: ${h.open}–${h.close}`,
    )
    .join("\n");
  const noticeNote = rules ? ` Minimum notice: ${rules.minNoticeMin} minutes.` : "";

  // Find a connected calendar, if any.
  const connections = await listConnections(ctx, deps.db);
  const calendar = connections.find(
    (c) => c.status === "active" && (c.provider === "google" || c.provider === "microsoft"),
  );
  if (!calendar) {
    return {
      content:
        `Opening hours:\n${hoursText || "not set"}.${noticeNote}\n` +
        `No calendar is connected, so exact free slots can't be confirmed automatically — ` +
        `offer opening hours and tell the customer the team will confirm the exact time.`,
    };
  }

  try {
    const token = await getValidAccessToken(ctx, calendar.id, {
      database: deps.db,
      ...(deps.env ? { env: deps.env } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    const busy = await readFreeBusy(
      calendar.provider as "google" | "microsoft",
      token,
      { timeMin: from.toJSDate(), timeMax: to.toJSDate() },
      deps.fetchImpl ?? fetch,
    );
    const busyText =
      busy.length > 0
        ? busy
            .map((b) => {
              const s = DateTime.fromJSDate(b.start).setZone(DEFAULT_TIMEZONE);
              const e = DateTime.fromJSDate(b.end).setZone(DEFAULT_TIMEZONE);
              return `- busy ${s.toFormat("ccc d LLL HH:mm")}–${e.toFormat("HH:mm")}`;
            })
            .join("\n")
        : "- no existing bookings in this range";
    return {
      content:
        `Opening hours:\n${hoursText || "not set"}.${noticeNote}\n` +
        `Existing calendar commitments ${from.toFormat("d LLL")}–${to.toFormat("d LLL")}:\n${busyText}\n` +
        `Propose one or two specific times that fall within opening hours and outside the busy periods, ` +
        `and say the team will confirm.`,
    };
  } catch (err) {
    if (err instanceof ConnectionReauthError) {
      return {
        content:
          `Opening hours:\n${hoursText || "not set"}.${noticeNote}\n` +
          `The connected calendar needs re-authorising, so exact availability can't be checked right now — ` +
          `tell the customer the team will confirm the time.`,
      };
    }
    throw err;
  }
}

async function flagForHuman(
  ctx: TenantContext,
  input: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<ToolOutcome> {
  const reason = typeof input.reason === "string" ? input.reason : "unspecified";
  const summary = typeof input.summary === "string" ? input.summary : undefined;
  await openEscalation(
    ctx,
    { conversationId: deps.conversationId, reason, ...(summary ? { summary } : {}) },
    deps.db,
  );
  await setConversationStatus(ctx, deps.conversationId, "needs_human", deps.db);
  return {
    content:
      "Escalation opened. Reply politely that you'll check with the team and get back to them shortly. " +
      "Do not invent an answer or make firm promises.",
    escalated: true,
  };
}

async function createBookingTool(
  ctx: TenantContext,
  input: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<ToolOutcome> {
  const startAtStr = typeof input.start_at === "string" ? input.start_at : null;
  const name = typeof input.customer_name === "string" ? input.customer_name : null;
  if (!startAtStr || !name) {
    return { content: "Need a start time and the customer's name to book.", isError: true };
  }
  const startAt = new Date(startAtStr);
  if (Number.isNaN(startAt.getTime())) {
    return { content: "start_at must be a valid ISO-8601 datetime.", isError: true };
  }
  const email = typeof input.customer_email === "string" ? input.customer_email : undefined;
  const phone = typeof input.customer_phone === "string" ? input.customer_phone : undefined;
  if (!email && !phone) {
    return {
      content: "Ask the customer for an email or phone number before booking.",
      isError: true,
    };
  }

  // Resolve the service (by name, or the only active one).
  const active = (await listServices(ctx, deps.db)).filter((s) => s.active);
  const filter = typeof input.service_name === "string" ? input.service_name.toLowerCase() : null;
  const svc = filter
    ? active.find((s) => s.name.toLowerCase().includes(filter))
    : active.length === 1
      ? active[0]
      : undefined;
  if (!svc) {
    return {
      content:
        active.length === 0
          ? "No services are configured, so booking isn't possible — flag for a human."
          : "Which service is this for? Ask the customer to pick one before booking.",
      isError: true,
    };
  }

  const end = new Date(startAt.getTime() + svc.defaultDurationMin * 60_000);
  const bookingDeps = await buildBookingDeps(ctx, {
    db: deps.db,
    ...(deps.env ? { env: deps.env } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    busyRange: {
      from: new Date(startAt.getTime() - 12 * 3600_000),
      to: new Date(end.getTime() + 12 * 3600_000),
    },
  });

  try {
    const idempotencyKey = `${deps.conversationId}:${svc.id}:${startAt.toISOString()}`;
    const res = await createBooking(
      ctx,
      {
        serviceId: svc.id,
        startAt,
        contact: { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
        conversationId: deps.conversationId,
        idempotencyKey,
      },
      bookingDeps,
    );
    const whenLocal = DateTime.fromJSDate(startAt)
      .setZone(DEFAULT_TIMEZONE)
      .toFormat("cccc d LLLL, HH:mm");
    if (res.paymentUrl) {
      return {
        content:
          `The ${svc.name} slot on ${whenLocal} is reserved pending a deposit. Give the customer this ` +
          `secure payment link and tell them the slot is held until it's paid: ${res.paymentUrl}`,
      };
    }
    return {
      content: `Booked and confirmed: ${svc.name} on ${whenLocal}. A confirmation has been sent. Let the customer know.`,
    };
  } catch (err) {
    if (err instanceof BookingConflictError) {
      return { content: "That time was just taken. Offer the customer another available time." };
    }
    throw err;
  }
}

/** Dispatch a model tool call to its server-side executor. */
export async function executeTool(
  ctx: TenantContext,
  name: string,
  input: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<ToolOutcome> {
  switch (name) {
    case "get_service_info":
      return getServiceInfo(ctx, input, deps);
    case "check_availability":
      return checkAvailability(ctx, input, deps);
    case "create_booking":
      return createBookingTool(ctx, input, deps);
    case "flag_for_human":
      return flagForHuman(ctx, input, deps);
    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}
