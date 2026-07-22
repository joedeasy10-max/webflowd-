import type { Config, Context } from "@netlify/functions";
import {
  checkRateLimit,
  exchangeCodeForTokens,
  parseOAuthState,
  resolveCredentials,
  runInTenant,
  storeConnection,
  type TenantContext,
} from "@webflowd/core";
import { error, methodRouter, withErrorHandling } from "./_lib/http.js";
import { clientIp } from "./_lib/context.js";
import { appReturnUrl, redirect, requireCalendarProvider } from "./_lib/oauth.js";

/**
 * GET /api/oauth/:provider/callback
 * Public (the provider redirects here). Trust comes from the encrypted `state`,
 * which only our server can mint. Exchanges the code for tokens and stores them
 * encrypted, then returns the browser to the app.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  withErrorHandling(() =>
    methodRouter(req, {
      GET: async () => {
        const ip = clientIp(req);
        const rl = await checkRateLimit({
          key: `oauth-cb:${ip ?? "unknown"}`,
          limit: 30,
          windowSec: 60,
        });
        if (!rl.allowed) return error(429, "Too many requests");

        const provider = requireCalendarProvider(context.params?.provider);
        const url = new URL(req.url);
        const providerError = url.searchParams.get("error");
        if (providerError) {
          return redirect(appReturnUrl({ connect_error: providerError }));
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return error(400, "Missing code or state");

        // Trust the tenant/verifier only from the encrypted, integrity-checked state.
        const parsed = parseOAuthState(state, provider);

        const tokens = await exchangeCodeForTokens({
          provider,
          credentials: resolveCredentials(provider),
          code,
          codeVerifier: parsed.codeVerifier,
        });

        const ctx: TenantContext = { tenantId: parsed.tenantId, userId: "system", role: "owner" };
        await runInTenant(ctx, (tx) =>
          storeConnection(
            ctx,
            {
              provider,
              ...(tokens.externalAccountId ? { externalAccountId: tokens.externalAccountId } : {}),
              ...(tokens.scope ? { scopes: tokens.scope.split(" ") } : {}),
              accessToken: tokens.accessToken,
              ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
              ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
            },
            tx,
          ),
        );

        return redirect(appReturnUrl({ connected: provider }));
      },
    }),
  );

export const config: Config = { path: "/api/oauth/:provider/callback" };
