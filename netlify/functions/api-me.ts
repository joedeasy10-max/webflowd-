import type { Config } from "@netlify/functions";
import { getBookingRules, getHours, getProfile, listServices } from "@webflowd/core";
import { json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";

/** GET /api/me — current identity, tenant, and onboarding completeness. */
export default async (req: Request): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { identity, ctx } = await authenticate(req);
        const [profile, services, hours, rules] = await Promise.all([
          getProfile(ctx),
          listServices(ctx),
          getHours(ctx),
          getBookingRules(ctx),
        ]);
        return json({
          user: { id: ctx.userId, email: identity.email, role: ctx.role },
          tenantId: ctx.tenantId,
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
