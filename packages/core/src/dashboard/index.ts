import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, type Database } from "../db/client.js";
import { aiActions, bookings, contacts, escalations, services } from "../db/schema.js";
import { listConnections } from "../repos/connections.js";
import { ACTIVE_BOOKING_STATUSES } from "../repos/bookings.js";
import type { TenantContext } from "../tenancy/index.js";

export interface DashboardBooking {
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  tz: string;
  serviceName: string | null;
  contactName: string | null;
}

export interface DashboardEscalation {
  id: string;
  reason: string;
  summary: string | null;
  conversationId: string;
  createdAt: Date;
}

export interface DashboardConnection {
  provider: string;
  status: string;
  lastSyncedAt: Date | null;
  tokenExpiresAt: Date | null;
  needsReauth: boolean;
}

export interface DashboardActivity {
  toolName: string;
  outcome: string | null;
  conversationId: string | null;
  createdAt: Date;
}

export interface DashboardData {
  upcomingBookings: DashboardBooking[];
  openEscalations: DashboardEscalation[];
  connections: DashboardConnection[];
  recentActivity: DashboardActivity[];
  counts: {
    upcoming: number;
    openEscalations: number;
    connectionsNeedingReauth: number;
  };
}

/**
 * Aggregate the owner dashboard: upcoming jobs, open escalations, connection
 * health, and recent AI activity. Tenant-scoped — call inside `runInTenant`.
 */
export async function getDashboard(
  ctx: TenantContext,
  opts: { db?: Database; now?: Date; limit?: number } = {},
): Promise<DashboardData> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 10;

  const upcomingRows = await db
    .select({
      id: bookings.id,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
      tz: bookings.tz,
      serviceName: services.name,
      contactName: contacts.name,
    })
    .from(bookings)
    .leftJoin(services, eq(services.id, bookings.serviceId))
    .leftJoin(contacts, eq(contacts.id, bookings.contactId))
    .where(
      and(
        eq(bookings.tenantId, ctx.tenantId),
        inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
        gte(bookings.startAt, now),
      ),
    )
    .orderBy(bookings.startAt)
    .limit(limit);

  const escalationRows = await db.query.escalations.findMany({
    where: and(eq(escalations.tenantId, ctx.tenantId), eq(escalations.status, "open")),
    orderBy: (e, { desc: d }) => [d(e.createdAt)],
    limit,
  });

  const connectionRows = await listConnections(ctx, db);

  const activityRows = await db
    .select({
      toolName: aiActions.toolName,
      outcome: aiActions.outcome,
      conversationId: aiActions.conversationId,
      createdAt: aiActions.createdAt,
    })
    .from(aiActions)
    .where(eq(aiActions.tenantId, ctx.tenantId))
    .orderBy(desc(aiActions.createdAt))
    .limit(limit);

  const connections: DashboardConnection[] = connectionRows.map((c) => ({
    provider: c.provider,
    status: c.status,
    lastSyncedAt: c.lastSyncedAt,
    tokenExpiresAt: c.tokenExpiresAt,
    needsReauth: c.status === "needs_reauth",
  }));

  return {
    upcomingBookings: upcomingRows,
    openEscalations: escalationRows.map((e) => ({
      id: e.id,
      reason: e.reason,
      summary: e.summary,
      conversationId: e.conversationId,
      createdAt: e.createdAt,
    })),
    connections,
    recentActivity: activityRows,
    counts: {
      upcoming: upcomingRows.length,
      openEscalations: escalationRows.length,
      connectionsNeedingReauth: connections.filter((c) => c.needsReauth).length,
    },
  };
}
