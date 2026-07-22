import {
  bearerFromHeader,
  checkRateLimit,
  provisionTenant,
  verifyAccessToken,
  type TenantContext,
  type VerifiedIdentity,
} from "@webflowd/core";
import { HttpError } from "./http.js";

export interface AuthedRequest {
  identity: VerifiedIdentity;
  ctx: TenantContext;
}

/**
 * Authenticate a request: verify the Auth0 token, provision/resolve the tenant,
 * and apply a per-user rate limit. Provisioning is idempotent, so first login
 * seamlessly creates the tenant + owner record.
 */
export async function authenticate(req: Request): Promise<AuthedRequest> {
  const token = bearerFromHeader(req.headers.get("authorization"));
  if (!token) throw new HttpError(401, "Missing bearer token");

  const identity = await verifyAccessToken(token);

  // Generous per-user limit to blunt runaway clients; public endpoints are
  // limited far more tightly elsewhere.
  const rl = await checkRateLimit({ key: `api:${identity.sub}`, limit: 120, windowSec: 60 });
  if (!rl.allowed) {
    throw new HttpError(429, "Rate limit exceeded", {
      retryAfter: Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000),
    });
  }

  if (!identity.email) {
    throw new HttpError(403, "Token is missing an email claim; configure the Auth0 Action");
  }

  const ctx = await provisionTenant({
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
  });

  return { identity, ctx };
}

/** Client IP for logging/limits, from Netlify/proxy headers. */
export function clientIp(req: Request): string | undefined {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}
