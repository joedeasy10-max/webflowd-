import type { Config } from "@netlify/functions";
import { z } from "zod";
import type { ConnectionProvider } from "@webflowd/shared";
import {
  getConnectionInternal,
  getValidAccessToken,
  readFreeBusy,
  runInTenant,
} from "@webflowd/core";
import { error, json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

const querySchema = z.object({
  connectionId: z.string().uuid(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * GET /api/freebusy?connectionId=&from=&to=
 * Reads real free/busy from a connected calendar. Proves the OAuth → token →
 * provider read path end-to-end.
 */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        const url = new URL(req.url);
        const parsed = querySchema.safeParse({
          connectionId: url.searchParams.get("connectionId") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
        });
        if (!parsed.success) return error(422, "Invalid query", { issues: parsed.error.issues });

        const timeMin = parsed.data.from ? new Date(parsed.data.from) : new Date();
        const timeMax = parsed.data.to
          ? new Date(parsed.data.to)
          : new Date(Date.now() + 14 * 24 * 3600_000);
        if (timeMax <= timeMin) return error(422, "`to` must be after `from`");

        // Load provider + a valid token inside the tenant transaction (RLS), then
        // make the network call outside the transaction.
        const { provider, accessToken } = await runInTenant(ctx, async (tx) => {
          const conn = await getConnectionInternal(ctx, parsed.data.connectionId, tx);
          if (!conn) return { provider: null, accessToken: null };
          const token = await getValidAccessToken(ctx, parsed.data.connectionId, { database: tx });
          return { provider: conn.provider as ConnectionProvider, accessToken: token };
        });
        if (!provider || !accessToken) return error(404, "Connection not found");

        const busy = await readFreeBusy(provider, accessToken, { timeMin, timeMax });
        return json({
          connectionId: parsed.data.connectionId,
          provider,
          from: timeMin.toISOString(),
          to: timeMax.toISOString(),
          busy: busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
        });
      },
    }),
  );

export const config: Config = { path: "/api/freebusy" };
