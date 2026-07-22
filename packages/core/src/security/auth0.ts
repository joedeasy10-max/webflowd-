import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Auth0 access-token verification (RS256) against the tenant's JWKS. Every
 * authenticated function calls `verifyAccessToken` before doing any work; the
 * tenant is then resolved from the verified `sub` — never from request input.
 */

export class AuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface Auth0Config {
  domain: string; // e.g. "webflowd.eu.auth0.com"
  audience: string; // API identifier
}

export interface VerifiedIdentity {
  sub: string;
  email: string;
  name?: string;
  scope?: string;
  raw: JWTPayload;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksDomain: string | null = null;

function getJwks(domain: string) {
  if (!jwks || jwksDomain !== domain) {
    jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
    jwksDomain = domain;
  }
  return jwks;
}

export function auth0ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Auth0Config {
  const domain = env.AUTH0_DOMAIN;
  const audience = env.AUTH0_AUDIENCE;
  if (!domain || !audience) {
    throw new AuthError("AUTH0_DOMAIN and AUTH0_AUDIENCE must be set");
  }
  return { domain, audience };
}

/** Extract a bearer token from an Authorization header value. */
export function bearerFromHeader(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

/**
 * Verify an Auth0 access token and return the identity. Throws AuthError on any
 * validation failure (signature, issuer, audience, expiry).
 */
export async function verifyAccessToken(
  token: string,
  config: Auth0Config = auth0ConfigFromEnv(),
): Promise<VerifiedIdentity> {
  const issuer = `https://${config.domain}/`;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(config.domain), {
      issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    }));
  } catch (err) {
    throw new AuthError(`Invalid token: ${(err as Error).message}`);
  }

  const sub = payload.sub;
  if (!sub) throw new AuthError("Token missing sub");

  // Custom claim namespace for email/name (configure an Auth0 Action to add it).
  const ns = "https://webflowd.com/";
  const email =
    (payload[`${ns}email`] as string | undefined) ??
    (payload.email as string | undefined) ??
    "";
  const name =
    (payload[`${ns}name`] as string | undefined) ?? (payload.name as string | undefined);

  return { sub, email, name, scope: payload.scope as string | undefined, raw: payload };
}
