import type { Config, Context } from "@netlify/functions";
import { listEscalations, resolveEscalation, runInTenant } from "@webflowd/core";
import { json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/escalations           GET (list; ?status=open|resolved, default open)
 * /api/escalations/:id       PATCH (mark resolved)
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const id = context.params?.id;

    if (!id) {
      return methodRouter(req, {
        GET: async () => {
          const url = new URL(req.url);
          const statusParam = url.searchParams.get("status");
          const status =
            statusParam === "resolved" ? "resolved" : statusParam === "all" ? undefined : "open";
          return json({
            escalations: await runInTenant(ctx, (tx) => listEscalations(ctx, status, tx)),
          });
        },
      });
    }

    return methodRouter(req, {
      PATCH: async () => {
        await runInTenant(ctx, (tx) => resolveEscalation(ctx, id, tx));
        return json({ ok: true });
      },
    });
  });

export const config: Config = { path: "/api/escalations{/:id}?" };
