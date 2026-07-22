import type { Config } from "@netlify/functions";
import { businessProfileSchema } from "@webflowd/shared";
import { getProfile, runInTenant, upsertProfile } from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/** GET/PUT /api/profile — read or upsert the business profile. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        return json({ profile: await runInTenant(ctx, (tx) => getProfile(ctx, tx)) });
      },
      PUT: async () => {
        const { ctx } = await authenticate(req);
        const input = await readJson(req, businessProfileSchema);
        return json({ profile: await runInTenant(ctx, (tx) => upsertProfile(ctx, input, tx)) });
      },
    }),
  );

export const config: Config = { path: "/api/profile" };
