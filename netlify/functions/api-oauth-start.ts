import type { Config, Context } from "@netlify/functions";
import { buildAuthorizationUrl, createOAuthState, resolveCredentials } from "@webflowd/core";
import { json, methodRouter, withErrorHandling } from "./_lib/http.js";
import { authenticate } from "./_lib/context.js";
import { requireCalendarProvider } from "./_lib/oauth.js";

/**
 * GET /api/oauth/:provider/start
 * Auth0-protected. Builds a PKCE + encrypted-state authorization URL and returns
 * it as JSON. The client navigates to it — this keeps the endpoint behind the
 * bearer token (a browser redirect couldn't carry the Authorization header) and
 * keeps the token out of any navigable URL.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const { ctx } = await authenticate(req);
        const provider = requireCalendarProvider(context.params?.provider);

        const { state, codeChallenge } = createOAuthState({ tenantId: ctx.tenantId, provider });
        const authorizationUrl = buildAuthorizationUrl({
          provider,
          credentials: resolveCredentials(provider),
          state,
          codeChallenge,
        });
        return json({ authorizationUrl });
      },
    }),
  );

export const config: Config = { path: "/api/oauth/:provider/start" };
