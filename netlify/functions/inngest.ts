import type { Config } from "@netlify/functions";
import { serve } from "inngest/edge";
import { inngest } from "./_inngest/client.js";
import { functions } from "./_inngest/functions.js";

/**
 * POST/PUT/GET /api/inngest — the Inngest handler that registers and runs all
 * durable/queued/cron functions. Uses the edge (Web Fetch API) serve handler,
 * which matches Netlify Functions v2's Request/Response signature. Inngest
 * verifies its own signing key on every invocation.
 */
const handler = serve({
  client: inngest,
  functions,
  servePath: "/api/inngest",
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

export default async (req: Request): Promise<Response> => handler(req);

export const config: Config = { path: "/api/inngest" };
