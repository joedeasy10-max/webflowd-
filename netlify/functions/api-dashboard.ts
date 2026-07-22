import type { Config } from "@netlify/functions";
import { getDashboard, runInTenant } from "@webflowd/core";
import { json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * GET /api/dashboard — owner overview: upcoming jobs, open escalations,
 * connection health, and recent AI activity.
 */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        const data = await runInTenant(ctx, (tx) => getDashboard(ctx, { db: tx }));
        return json(data);
      },
    }),
  );

export const config: Config = { path: "/api/dashboard" };
