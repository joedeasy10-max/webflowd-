import type { Config, Context } from "@netlify/functions";
import { listConnections, revokeConnection, runInTenant } from "@webflowd/core";
import { json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/connections        GET (list — never includes tokens)
 * /api/connections/:id    DELETE (revoke)
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const id = context.params?.id;

    if (!id) {
      return methodRouter(req, {
        GET: async () =>
          json({ connections: await runInTenant(ctx, (tx) => listConnections(ctx, tx)) }),
      });
    }

    return methodRouter(req, {
      DELETE: async () => {
        await runInTenant(ctx, (tx) => revokeConnection(ctx, id, tx));
        return json({ ok: true });
      },
    });
  });

export const config: Config = { path: "/api/connections{/:id}?" };
