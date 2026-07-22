import type { Config } from "@netlify/functions";
import {
  ensureChatChannel,
  getBookingRules,
  getHours,
  getProfile,
  listEscalations,
  listServices,
  runInTenant,
} from "@webflowd/core";
import { json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/** GET /api/me — current identity, tenant, onboarding status, and widget key. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { identity, ctx } = await authenticate(req);
        // Sequential within one tenant transaction (single pooled connection).
        const { profile, services, hours, rules, chat, openEscalations } = await runInTenant(
          ctx,
          async (tx) => ({
            profile: await getProfile(ctx, tx),
            services: await listServices(ctx, tx),
            hours: await getHours(ctx, tx),
            rules: await getBookingRules(ctx, tx),
            chat: await ensureChatChannel(ctx, tx),
            openEscalations: (await listEscalations(ctx, "open", tx)).length,
          }),
        );
        return json({
          user: { id: ctx.userId, email: identity.email, role: ctx.role },
          tenantId: ctx.tenantId,
          widgetPublicKey: chat.publicKey,
          openEscalations,
          onboarding: {
            profile: Boolean(profile?.displayName),
            services: services.length > 0,
            hours: hours.length > 0,
            bookingRules: Boolean(rules),
          },
        });
      },
    }),
  );

export const config: Config = { path: "/api/me" };
