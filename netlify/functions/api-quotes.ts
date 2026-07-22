import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import {
  buildLifecycleSender,
  createQuote,
  getProfile,
  listQuotes,
  runInTenant,
  sendQuote,
  updateQuoteStatus,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

const createSchema = z.object({
  contactId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  description: z.string().min(1).max(2000),
  amountPence: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  validUntil: z.string().datetime().optional(),
  send: z.boolean().optional(),
});

const patchSchema = z.union([
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("status"), status: z.enum(["accepted", "declined", "expired"]) }),
]);

/**
 * /api/quotes        GET (list) · POST (create, optionally send)
 * /api/quotes/:id    PATCH { action: "send" | "status" }
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const id = context.params?.id;

    if (!id) {
      return methodRouter(req, {
        GET: async () => json({ quotes: await runInTenant(ctx, (tx) => listQuotes(ctx, tx)) }),
        POST: async () => {
          const body = await readJson(req, createSchema);
          const result = await runInTenant(ctx, async (tx) => {
            const quote = await createQuote(
              ctx,
              {
                contactId: body.contactId ?? null,
                conversationId: body.conversationId ?? null,
                serviceId: body.serviceId ?? null,
                description: body.description,
                amountPence: body.amountPence,
                currency: body.currency,
                validUntil: body.validUntil ? new Date(body.validUntil) : null,
              },
              tx,
            );
            if (body.send) {
              const profile = await getProfile(ctx, tx);
              const { delivered } = await sendQuote(
                ctx,
                quote.id,
                { sender: buildLifecycleSender(process.env), businessName: profile?.displayName },
                tx,
              );
              return { quote, sent: true, delivered };
            }
            return { quote, sent: false };
          });
          return json(result, 201);
        },
      });
    }

    return methodRouter(req, {
      PATCH: async () => {
        const body = await readJson(req, patchSchema);
        const result = await runInTenant(ctx, async (tx) => {
          if (body.action === "send") {
            const profile = await getProfile(ctx, tx);
            return sendQuote(
              ctx,
              id,
              { sender: buildLifecycleSender(process.env), businessName: profile?.displayName },
              tx,
            );
          }
          await updateQuoteStatus(ctx, id, body.status, tx);
          return { ok: true };
        });
        return json(result);
      },
    });
  });

export const config: Config = { path: "/api/quotes{/:id}?" };
