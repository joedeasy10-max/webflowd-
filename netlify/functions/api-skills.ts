import type { Config, Context } from "@netlify/functions";
import { FEATURE_FLAGS, skillManifestSchema, skillToggleSchema } from "@webflowd/shared";
import {
  deleteSkill,
  listSkills,
  loadActiveFeatureFlags,
  requireRole,
  runInTenant,
  setSkillEnabled,
  upsertSkillFromManifest,
} from "@webflowd/core";
import { json, methodRouter, readJson, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/**
 * /api/skills          GET (list + active features) · POST (upload a manifest)
 * /api/skills/:key     PATCH { enabled } · DELETE
 *
 * Admin controls for the per-client skills registry. Role-gated to owner/admin
 * and tenant-scoped, so one client can never see or change another's skills.
 * Uploaded skills are declarative manifests (validated against an allowlist) —
 * never executable code.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(async () => {
    const { ctx } = await authenticate(req);
    requireRole(ctx, ["owner", "admin"]);
    const key = context.params?.key;

    if (!key) {
      return methodRouter(req, {
        GET: async () => {
          const { list, active } = await runInTenant(ctx, async (tx) => ({
            list: await listSkills(ctx, tx),
            active: await loadActiveFeatureFlags(ctx, tx),
          }));
          return json({
            skills: list.map((s) => ({
              key: s.key,
              name: s.name,
              description: s.description,
              category: s.category,
              enabled: s.enabled,
              source: s.source,
              config: s.config,
            })),
            activeFeatures: active,
            availableFeatures: FEATURE_FLAGS,
          });
        },
        POST: async () => {
          const manifest = await readJson(req, skillManifestSchema);
          const row = await runInTenant(ctx, (tx) =>
            upsertSkillFromManifest(ctx, manifest, "uploaded", tx),
          );
          return json({ ok: true, key: row.key }, 201);
        },
      });
    }

    return methodRouter(req, {
      PATCH: async () => {
        const body = await readJson(req, skillToggleSchema);
        await runInTenant(ctx, (tx) => setSkillEnabled(ctx, key, body.enabled, tx));
        return json({ ok: true });
      },
      DELETE: async () => {
        await runInTenant(ctx, (tx) => deleteSkill(ctx, key, tx));
        return json({ ok: true });
      },
    });
  });

export const config: Config = { path: "/api/skills{/:key}?" };
