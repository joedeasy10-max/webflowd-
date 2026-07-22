import type { Config } from "@netlify/functions";
import { bookingRulesUpdateSchema } from "@webflowd/shared";
import { getBookingRules, runInTenant, upsertBookingRules } from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/** GET/PUT /api/booking-rules — read or update tenant booking rules. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        return json({ bookingRules: await runInTenant(ctx, (tx) => getBookingRules(ctx, tx)) });
      },
      PUT: async () => {
        const { ctx } = await authenticate(req);
        const patch = await readJson(req, bookingRulesUpdateSchema);
        return json({
          bookingRules: await runInTenant(ctx, (tx) => upsertBookingRules(ctx, patch, tx)),
        });
      },
    }),
  );

export const config: Config = { path: "/api/booking-rules" };
