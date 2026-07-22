import { and, eq, gt, inArray, lt } from "drizzle-orm";
import type { BookingStatus, ConnectionProvider } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { bookings } from "../db/schema.js";
import { guardRow, type TenantContext } from "../tenancy/index.js";

/** Statuses that occupy a time slot (block double-booking / count toward caps). */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["proposed", "confirmed", "rescheduled"];

/** Active bookings overlapping [from, to). */
export async function getBookingsInRange(
  ctx: TenantContext,
  from: Date,
  to: Date,
  database: Database = getDb(),
) {
  return database.query.bookings.findMany({
    where: and(
      eq(bookings.tenantId, ctx.tenantId),
      inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
      lt(bookings.startAt, to),
      gt(bookings.endAt, from),
    ),
  });
}

export async function findBookingByIdempotencyKey(
  ctx: TenantContext,
  key: string,
  database: Database = getDb(),
) {
  const row = await database.query.bookings.findFirst({
    where: and(eq(bookings.tenantId, ctx.tenantId), eq(bookings.idempotencyKey, key)),
  });
  return row ?? null;
}

export async function getBookingById(
  ctx: TenantContext,
  bookingId: string,
  database: Database = getDb(),
) {
  const row = await database.query.bookings.findFirst({
    where: and(eq(bookings.id, bookingId), eq(bookings.tenantId, ctx.tenantId)),
  });
  return guardRow(ctx, row ?? null);
}

export async function listBookings(ctx: TenantContext, database: Database = getDb()) {
  return database.query.bookings.findMany({
    where: eq(bookings.tenantId, ctx.tenantId),
    orderBy: (b, { desc }) => [desc(b.startAt)],
    limit: 200,
  });
}

export interface InsertBookingInput {
  contactId?: string | null;
  serviceId: string;
  conversationId?: string | null;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  tz: string;
  location?: string | null;
  notes?: string | null;
  depositStatus?: string | null;
  idempotencyKey: string;
}

export async function insertBooking(
  ctx: TenantContext,
  input: InsertBookingInput,
  database: Database = getDb(),
) {
  const [row] = await database
    .insert(bookings)
    .values({ tenantId: ctx.tenantId, ...input })
    .returning();
  return row!;
}

export async function updateBooking(
  ctx: TenantContext,
  bookingId: string,
  patch: Partial<{
    status: BookingStatus;
    startAt: Date;
    endAt: Date;
    calendarEventId: string | null;
    calendarProvider: ConnectionProvider | null;
    depositStatus: string | null;
    notes: string | null;
  }>,
  database: Database = getDb(),
) {
  const [row] = await database
    .update(bookings)
    .set(patch)
    .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, ctx.tenantId)))
    .returning();
  return row ?? null;
}
