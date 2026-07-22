import type { Config, Context } from "@netlify/functions";
import { hoursExceptionSchema } from "@webflowd/shared";
import { deleteException, listExceptions, runInTenant, upsertException } from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/hours/exceptions          GET (list), POST (upsert)
 * /api/hours/exceptions/:date    DELETE  (date = YYYY-MM-DD)
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const date = context.params?.date;

    if (!date) {
      return methodRouter(req, {
        GET: async () =>
          json({ exceptions: await runInTenant(ctx, (tx) => listExceptions(ctx, tx)) }),
        POST: async () => {
          const input = await readJson(req, hoursExceptionSchema);
          return json(
            { exception: await runInTenant(ctx, (tx) => upsertException(ctx, input, tx)) },
            201,
          );
        },
      });
    }

    return methodRouter(req, {
      DELETE: async () => {
        await runInTenant(ctx, (tx) => deleteException(ctx, date, tx));
        return json({ ok: true });
      },
    });
  });

export const config: Config = { path: "/api/hours/exceptions{/:date}?" };
