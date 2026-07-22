import type { Config } from "@netlify/functions";
import { businessHoursSchema } from "@webflowd/shared";
import { getHours, runInTenant, setHours } from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/** GET/PUT /api/hours — read or replace the full weekly schedule. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        return json({ hours: await runInTenant(ctx, (tx) => getHours(ctx, tx)) });
      },
      PUT: async () => {
        const { ctx } = await authenticate(req);
        const rows = await readJson(req, businessHoursSchema);
        return json({ hours: await runInTenant(ctx, (tx) => setHours(ctx, rows, tx)) });
      },
    }),
  );

export const config: Config = { path: "/api/hours" };
