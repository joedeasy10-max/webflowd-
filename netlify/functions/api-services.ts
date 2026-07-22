import type { Config, Context } from "@netlify/functions";
import { serviceSchema, serviceUpdateSchema } from "@webflowd/shared";
import {
  createService,
  deleteService,
  listServices,
  runInTenant,
  updateService,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/services            GET (list), POST (create)
 * /api/services/:id        PUT (update), DELETE
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const id = context.params?.id;

    if (!id) {
      return methodRouter(req, {
        GET: async () =>
          json({ services: await runInTenant(ctx, (tx) => listServices(ctx, tx)) }),
        POST: async () => {
          const input = await readJson(req, serviceSchema);
          return json({ service: await runInTenant(ctx, (tx) => createService(ctx, input, tx)) }, 201);
        },
      });
    }

    return methodRouter(req, {
      PUT: async () => {
        const patch = await readJson(req, serviceUpdateSchema);
        return json({ service: await runInTenant(ctx, (tx) => updateService(ctx, id, patch, tx)) });
      },
      DELETE: async () => {
        await runInTenant(ctx, (tx) => deleteService(ctx, id, tx));
        return json({ ok: true });
      },
    });
  });

export const config: Config = { path: "/api/services{/:id}?" };
