import type { Config, Context } from "@netlify/functions";
import { knowledgeItemSchema, knowledgeItemUpdateSchema } from "@webflowd/shared";
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  runInTenant,
  updateKnowledge,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/knowledge          GET (list), POST (create)
 * /api/knowledge/:id      PUT (update), DELETE
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    const id = context.params?.id;

    if (!id) {
      return methodRouter(req, {
        GET: async () =>
          json({ knowledge: await runInTenant(ctx, (tx) => listKnowledge(ctx, tx)) }),
        POST: async () => {
          const input = await readJson(req, knowledgeItemSchema);
          return json({ item: await runInTenant(ctx, (tx) => createKnowledge(ctx, input, tx)) }, 201);
        },
      });
    }

    return methodRouter(req, {
      PUT: async () => {
        const patch = await readJson(req, knowledgeItemUpdateSchema);
        return json({ item: await runInTenant(ctx, (tx) => updateKnowledge(ctx, id, patch, tx)) });
      },
      DELETE: async () => {
        await runInTenant(ctx, (tx) => deleteKnowledge(ctx, id, tx));
        return json({ ok: true });
      },
    });
  });

export const config: Config = { path: "/api/knowledge{/:id}?" };
