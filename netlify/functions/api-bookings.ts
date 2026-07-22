import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import {
  buildBookingDeps,
  cancelBooking,
  listBookings,
  rescheduleBooking,
  runInTenant,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

const patchSchema = z.union([
  z.object({ action: z.literal("cancel"), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("reschedule"), newStart: z.string().datetime() }),
]);

/**
 * /api/bookings          GET (list)
 * /api/bookings/:id      PATCH { action: "cancel" | "reschedule", ... }
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const id = context.params?.id;

    if (!id) {
      return methodRouter(req, {
        GET: async () => json({ bookings: await runInTenant(ctx, (tx) => listBookings(ctx, tx)) }),
      });
    }

    const handleUpdate = async () => {
      const body = await readJson(req, patchSchema);
      await runInTenant(ctx, async (tx) => {
        const deps = await buildBookingDeps(ctx, { db: tx, env: process.env });
        if (body.action === "cancel") {
          await cancelBooking(ctx, id, body.reason, deps);
        } else {
          await rescheduleBooking(ctx, id, new Date(body.newStart), deps);
        }
      });
      return json({ ok: true });
    };
    return methodRouter(req, { PATCH: handleUpdate, PUT: handleUpdate });
  });

export const config: Config = { path: "/api/bookings{/:id}?" };
