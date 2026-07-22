import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { DEFAULT_TIMEZONE, type ConnectionProvider } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { payments, services } from "../db/schema.js";
import { writeAudit } from "../audit/index.js";
import { TenantError, type TenantContext } from "../tenancy/index.js";
import { getBookingRules } from "../repos/booking-rules.js";
import { getHours, listExceptions } from "../repos/hours.js";
import { findOrCreateContact, type ContactIdentity } from "../repos/contacts.js";
import {
  findBookingByIdempotencyKey,
  getBookingById,
  getBookingsInRange,
  insertBooking,
  updateBooking,
} from "../repos/bookings.js";
import {
  computeAvailableSlots,
  isSlotBookable,
  type AvailabilityInput,
  type Interval,
} from "../availability/index.js";
import type { CalendarEventInput } from "../channels/calendar/write.js";
import { scheduleBookingLifecycle } from "../lifecycle/index.js";

export class BookingError extends TenantError {}
export class BookingConflictError extends TenantError {
  constructor(message = "That time is no longer available") {
    super(message, 409);
  }
}

/** Injected side-effect ports (real impls wired in the functions layer; fakes in tests). */
export interface CalendarPort {
  provider: ConnectionProvider;
  createEvent(evt: CalendarEventInput): Promise<{ eventId: string }>;
  cancelEvent(eventId: string): Promise<void>;
}
export interface PaymentPort {
  createDepositCheckout(input: {
    amountPence: number;
    currency: string;
    bookingId: string;
    description: string;
  }): Promise<{ url: string; reference: string }>;
}
export interface BookingNotification {
  kind: "confirmed" | "rescheduled" | "cancelled";
  booking: { id: string; startAt: Date; endAt: Date; tz: string };
  serviceName: string;
  contact: { name?: string | null; email?: string | null; phone?: string | null } | null;
}
export interface NotifyPort {
  booking(n: BookingNotification): Promise<void>;
}

export interface BookingDeps {
  db?: Database;
  now?: Date;
  calendar?: CalendarPort | null;
  payments?: PaymentPort | null;
  notify?: NotifyPort | null;
  /** Extra busy intervals (e.g. from the connected calendar's free/busy). */
  externalBusy?: Interval[];
}

export interface CreateBookingInput {
  serviceId: string;
  startAt: Date;
  contact?: ContactIdentity;
  conversationId?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

export interface CreateBookingResult {
  booking: Awaited<ReturnType<typeof insertBooking>>;
  paymentUrl?: string;
  idempotentReplay?: boolean;
}

async function loadService(ctx: TenantContext, serviceId: string, db: Database) {
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.tenantId, ctx.tenantId)),
  });
  if (!svc || !svc.active) throw new BookingError("Service not found", 404);
  return svc;
}

async function buildAvailabilityInput(
  ctx: TenantContext,
  svc: Awaited<ReturnType<typeof loadService>>,
  startAt: Date,
  deps: BookingDeps,
  db: Database,
  excludeBookingId?: string,
): Promise<AvailabilityInput> {
  const tz = DEFAULT_TIMEZONE;
  const day = DateTime.fromJSDate(startAt).setZone(tz);
  const dayStart = day.startOf("day").toJSDate();
  const dayEnd = day.endOf("day").toJSDate();

  const [hours, exceptions, rules, dayBookings] = await Promise.all([
    getHours(ctx, db),
    listExceptions(ctx, db),
    getBookingRules(ctx, db),
    getBookingsInRange(ctx, dayStart, dayEnd, db),
  ]);

  const existing = dayBookings.filter((b) => b.id !== excludeBookingId);
  const busy: Interval[] = [
    ...existing.map((b) => ({ start: b.startAt, end: b.endAt })),
    ...(deps.externalBusy ?? []),
  ];
  const localDate = day.toFormat("yyyy-MM-dd");

  return {
    timezone: tz,
    hours,
    exceptions: exceptions.map((e) => ({
      date: e.date,
      closed: e.closed,
      open: e.open,
      close: e.close,
    })),
    rules: rules ?? {
      minNoticeMin: 120,
      maxAdvanceDays: 60,
      defaultBufferMin: 0,
      slotGranularityMin: 30,
      maxJobsPerDay: 0,
    },
    service: {
      durationMin: svc.defaultDurationMin,
      bufferBeforeMin: svc.bufferBeforeMin,
      bufferAfterMin: svc.bufferAfterMin,
    },
    busy,
    from: dayStart,
    to: dayEnd,
    ...(deps.now ? { now: deps.now } : {}),
    jobsPerDay: { [localDate]: existing.length },
  };
}

/** Preview bookable slots for a service across a date range. */
export async function previewAvailability(
  ctx: TenantContext,
  input: { serviceId: string; from: Date; to: Date; externalBusy?: Interval[] },
  deps: BookingDeps = {},
) {
  const db = deps.db ?? getDb();
  const svc = await loadService(ctx, input.serviceId, db);
  const dayBookings = await getBookingsInRange(ctx, input.from, input.to, db);
  const availability = await buildAvailabilityInput(ctx, svc, input.from, deps, db);
  return computeAvailableSlots({
    ...availability,
    from: input.from,
    to: input.to,
    busy: [
      ...dayBookings.map((b) => ({ start: b.startAt, end: b.endAt })),
      ...(input.externalBusy ?? deps.externalBusy ?? []),
    ],
    jobsPerDay: {},
  });
}

/**
 * Create a booking. Re-validates the slot at write time against opening hours,
 * rules, existing bookings, and (optionally) the connected calendar's busy times
 * — so a slot can't be double-booked. Idempotent per idempotencyKey.
 * Deposit-required services are held `proposed` until Stripe payment.
 */
export async function createBooking(
  ctx: TenantContext,
  input: CreateBookingInput,
  deps: BookingDeps = {},
): Promise<CreateBookingResult> {
  const db = deps.db ?? getDb();

  const existing = await findBookingByIdempotencyKey(ctx, input.idempotencyKey, db);
  if (existing) return { booking: existing, idempotentReplay: true };

  const svc = await loadService(ctx, input.serviceId, db);
  const endAt = new Date(input.startAt.getTime() + svc.defaultDurationMin * 60_000);

  const availability = await buildAvailabilityInput(ctx, svc, input.startAt, deps, db);
  if (!isSlotBookable(availability, input.startAt)) {
    throw new BookingConflictError();
  }

  const contact =
    input.contact && (input.contact.email || input.contact.phone || input.contact.name)
      ? await findOrCreateContact(ctx, input.contact, db)
      : null;

  const depositRequired = svc.depositRequired && (svc.depositAmountPence ?? 0) > 0;
  // Deposit → hold as proposed until paid. Otherwise honour booking_rules.auto_confirm.
  const status = depositRequired
    ? "proposed"
    : (await autoConfirm(ctx, db))
      ? "confirmed"
      : "proposed";

  const booking = await insertBooking(
    ctx,
    {
      contactId: contact?.id ?? null,
      serviceId: svc.id,
      conversationId: input.conversationId ?? null,
      status,
      startAt: input.startAt,
      endAt,
      tz: DEFAULT_TIMEZONE,
      notes: input.notes ?? null,
      depositStatus: depositRequired ? "pending" : null,
      idempotencyKey: input.idempotencyKey,
    },
    db,
  );

  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "ai",
      action: "booking.created",
      entityType: "booking",
      entityId: booking.id,
      metadata: { serviceId: svc.id, depositRequired },
    },
    db,
  );

  if (depositRequired) {
    let paymentUrl: string | undefined;
    if (deps.payments) {
      const checkout = await deps.payments.createDepositCheckout({
        amountPence: svc.depositAmountPence!,
        currency: "gbp",
        bookingId: booking.id,
        description: `Deposit for ${svc.name}`,
      });
      paymentUrl = checkout.url;
      await db.insert(payments).values({
        tenantId: ctx.tenantId,
        bookingId: booking.id,
        stripePaymentIntentId: checkout.reference,
        amountPence: svc.depositAmountPence!,
        currency: "gbp",
        type: "deposit",
        status: "pending",
      });
    }
    return { booking, ...(paymentUrl ? { paymentUrl } : {}) };
  }

  // Confirmed immediately: write the calendar event + notify. If the tenant
  // requires manual approval (auto_confirm off), it stays `proposed` with no
  // calendar write until the owner confirms.
  if (status === "confirmed") {
    await finalizeConfirmed(ctx, booking.id, svc.name, input.startAt, endAt, contact, deps, db);
  }
  return { booking };
}

async function autoConfirm(ctx: TenantContext, db: Database): Promise<boolean> {
  const rules = await getBookingRules(ctx, db);
  return rules ? rules.autoConfirm : true;
}

/** Create the calendar event and send confirmations for a confirmed booking. */
async function finalizeConfirmed(
  ctx: TenantContext,
  bookingId: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  contact: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null,
  deps: BookingDeps,
  db: Database,
): Promise<void> {
  if (deps.calendar) {
    const { eventId } = await deps.calendar.createEvent({
      summary: `${serviceName}${contact?.name ? ` — ${contact.name}` : ""}`,
      start: startAt,
      end: endAt,
      timezone: DEFAULT_TIMEZONE,
    });
    await updateBooking(
      ctx,
      bookingId,
      { calendarEventId: eventId, calendarProvider: deps.calendar.provider },
      db,
    );
  }
  if (deps.notify) {
    await deps.notify
      .booking({
        kind: "confirmed",
        booking: { id: bookingId, startAt, endAt, tz: DEFAULT_TIMEZONE },
        serviceName,
        contact,
      })
      .catch(() => undefined); // notifications are best-effort
  }
  // Schedule reminders + a review request for this confirmed booking.
  await scheduleBookingLifecycle(ctx, { bookingId, startAt, contact }, db);
}

/** Confirm a booking after its deposit is paid (called from the Stripe webhook). */
export async function confirmDepositPaid(
  ctx: TenantContext,
  bookingId: string,
  deps: BookingDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const booking = await getBookingById(ctx, bookingId, db);
  if (!booking) throw new BookingError("Booking not found", 404);
  if (booking.status === "confirmed") return; // idempotent

  await updateBooking(ctx, bookingId, { status: "confirmed", depositStatus: "paid" }, db);
  await db
    .update(payments)
    .set({ status: "paid" })
    .where(and(eq(payments.tenantId, ctx.tenantId), eq(payments.bookingId, bookingId)));

  const svc = booking.serviceId
    ? await db.query.services.findFirst({ where: eq(services.id, booking.serviceId) })
    : null;
  const contact = booking.contactId
    ? await db.query.contacts.findFirst({ where: (c, { eq: e }) => e(c.id, booking.contactId!) })
    : null;
  await finalizeConfirmed(
    ctx,
    bookingId,
    svc?.name ?? "Appointment",
    booking.startAt,
    booking.endAt,
    contact ?? null,
    deps,
    db,
  );
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: "system",
      action: "booking.created",
      entityType: "booking",
      entityId: bookingId,
      metadata: { depositPaid: true },
    },
    db,
  );
}

export async function cancelBooking(
  ctx: TenantContext,
  bookingId: string,
  reason: string | undefined,
  deps: BookingDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const booking = await getBookingById(ctx, bookingId, db);
  if (!booking) throw new BookingError("Booking not found", 404);

  if (deps.calendar && booking.calendarEventId) {
    await deps.calendar.cancelEvent(booking.calendarEventId).catch(() => undefined);
  }
  await updateBooking(ctx, bookingId, { status: "cancelled" }, db);
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "booking.cancelled",
      entityType: "booking",
      entityId: bookingId,
      metadata: { reason: reason ?? null },
    },
    db,
  );
}

export async function rescheduleBooking(
  ctx: TenantContext,
  bookingId: string,
  newStart: Date,
  deps: BookingDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const booking = await getBookingById(ctx, bookingId, db);
  if (!booking) throw new BookingError("Booking not found", 404);
  if (!booking.serviceId) throw new BookingError("Booking has no service", 400);

  const svc = await loadService(ctx, booking.serviceId, db);
  const newEnd = new Date(newStart.getTime() + svc.defaultDurationMin * 60_000);

  const availability = await buildAvailabilityInput(ctx, svc, newStart, deps, db, bookingId);
  if (!isSlotBookable(availability, newStart)) throw new BookingConflictError();

  // Replace the calendar event.
  let calendarEventId = booking.calendarEventId;
  if (deps.calendar) {
    if (booking.calendarEventId)
      await deps.calendar.cancelEvent(booking.calendarEventId).catch(() => undefined);
    const { eventId } = await deps.calendar.createEvent({
      summary: svc.name,
      start: newStart,
      end: newEnd,
      timezone: DEFAULT_TIMEZONE,
    });
    calendarEventId = eventId;
  }
  await updateBooking(
    ctx,
    bookingId,
    {
      status: "rescheduled",
      startAt: newStart,
      endAt: newEnd,
      calendarEventId,
      calendarProvider: deps.calendar?.provider ?? booking.calendarProvider,
    },
    db,
  );
  await writeAudit(
    {
      tenantId: ctx.tenantId,
      actor: ctx.userId,
      action: "booking.rescheduled",
      entityType: "booking",
      entityId: bookingId,
    },
    db,
  );
}
