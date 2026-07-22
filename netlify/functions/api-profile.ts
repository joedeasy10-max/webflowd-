import type { Config } from "@netlify/functions";
import { businessProfileSchema, getProfile, upsertProfile } from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/** GET/PUT /api/profile — read or upsert the business profile. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        return json({ profile: await getProfile(ctx) });
      },
      PUT: async () => {
        const { ctx } = await authenticate(req);
        const input = await readJson(req, businessProfileSchema);
        return json({ profile: await upsertProfile(ctx, input) });
      },
    }),
  );

export const config: Config = { path: "/api/profile" };
