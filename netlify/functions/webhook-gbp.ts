import { timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
  anthropicClient,
  checkRateLimit,
  ingestInboundMessage,
  resolveChannelByIdentifier,
  runInTenant,
  type TenantContext,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { clientIp } from "./_lib/context.js";
import { loadTenantData } from "./_lib/tenant-data.js";

/**
 * Normalized Google Business Profile inbound payload. GBP / Business Messages
 * delivers messages and questions via its API; an integration layer maps the raw
 * provider payload to this shape. `locationId` is the tenant's GBP location,
 * registered as a `google_business` channel identifier — the tenant resolver.
 */
const bodySchema = z.object({
  locationId: z.string().min(1).max(256),
  message: z.string().min(1).max(8000),
  customer: z
    .object({ name: z.string().max(200).optional(), phone: z.string().max(40).optional() })
    .optional(),
});

function secretOk(provided: string | null): boolean {
  const expected = process.env.GBP_INGEST_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /webhooks/google-business — ingest a Google Business Profile message.
 * Authenticated by a shared secret, rate-limited, resolves the tenant from the
 * GBP location id, and runs the message through the shared Claude ingestion
 * pipeline (channel google_business). The drafted reply is persisted; sending it
 * back to GBP is handled once the GBP send API/OAuth is connected.
 */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      POST: async () => {
        if (!secretOk(req.headers.get("x-gbp-token"))) {
          return json({ error: "Unauthorized" }, 401);
        }

        const ip = clientIp(req);
        const rl = await checkRateLimit({
          key: `gbp:${ip ?? "unknown"}`,
          limit: 30,
          windowSec: 60,
        });
        if (!rl.allowed) return json({ error: "Too many messages" }, 429);

        const input = await readJson(req, bodySchema);
        const resolved = await resolveChannelByIdentifier("google_business", input.locationId);
        if (!resolved) return json({ error: "Unknown location" }, 404);

        const ctx: TenantContext = { tenantId: resolved.tenantId, userId: "system", role: "owner" };
        const result = await runInTenant(ctx, async (tx) => {
          const tenantData = await loadTenantData(ctx, tx);
          return ingestInboundMessage(
            ctx,
            {
              channel: "google_business",
              channelId: resolved.channelId,
              message: input.message,
              visitor: input.customer ?? null,
              subject: "Google Business enquiry",
            },
            { db: tx, model: anthropicClient(), tenantData, env: process.env },
          );
        });

        return json(result, 200);
      },
    }),
  );

export const config: Config = { path: "/webhooks/google-business" };
