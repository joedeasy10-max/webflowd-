import type { Config } from "@netlify/functions";
import { z } from "zod";
import { buildBookingDeps, previewAvailability, runInTenant } from "@webflowd/core";
import { error, json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

const querySchema = z.object({
  serviceId: z.string().uuid(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** GET /api/availability?serviceId=&from=&to= — bookable slots for a service. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        const url = new URL(req.url);
        const parsed = querySchema.safeParse({
          serviceId: url.searchParams.get("serviceId") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
        });
        if (!parsed.success) return error(422, "Invalid query", { issues: parsed.error.issues });

        const from = parsed.data.from ? new Date(parsed.data.from) : new Date();
        const to = parsed.data.to
          ? new Date(parsed.data.to)
          : new Date(Date.now() + 14 * 24 * 3600_000);
        if (to <= from) return error(422, "`to` must be after `from`");

        const slots = await runInTenant(ctx, async (tx) => {
          const deps = await buildBookingDeps(ctx, {
            db: tx,
            env: process.env,
            busyRange: { from, to },
          });
          return previewAvailability(ctx, { serviceId: parsed.data.serviceId, from, to }, deps);
        });
        return json({
          slots: slots.map((s) => ({
            start: s.start.toISOString(),
            end: s.end.toISOString(),
            localDate: s.localDate,
          })),
        });
      },
    }),
  );

export const config: Config = { path: "/api/availability" };
