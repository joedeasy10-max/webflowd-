import type { ConnectionProvider } from "@webflowd/shared";

/**
 * OAuth provider configuration for calendar connections. Only providers we do
 * an authorization-code + PKCE flow for are listed here.
 */
export interface OAuthProviderConfig {
  provider: ConnectionProvider;
  authUrl: string;
  tokenUrl: string;
  /** Scopes requested. `offline_access`/`access_type=offline` yields refresh tokens. */
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Extra params appended to the authorization URL. */
  extraAuthParams: Record<string, string>;
}

export const OAUTH_PROVIDERS: Partial<Record<ConnectionProvider, OAuthProviderConfig>> = {
  google: {
    provider: "google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
    ],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    // access_type=offline + prompt=consent are required to reliably receive a
    // refresh token from Google.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft: {
    provider: "microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "email", "offline_access", "Calendars.ReadWrite"],
    clientIdEnv: "MS_CLIENT_ID",
    clientSecretEnv: "MS_CLIENT_SECRET",
    extraAuthParams: {},
  },
};

export function getProviderConfig(provider: ConnectionProvider): OAuthProviderConfig {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) throw new Error(`No OAuth config for provider: ${provider}`);
  return config;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Resolve client id/secret/redirect for a provider from env. */
export function resolveCredentials(
  provider: ConnectionProvider,
  env: NodeJS.ProcessEnv = process.env,
): OAuthCredentials {
  const config = getProviderConfig(provider);
  const clientId = env[config.clientIdEnv];
  const clientSecret = env[config.clientSecretEnv];
  const base = env.APP_BASE_URL;
  if (!clientId || !clientSecret) {
    throw new Error(`${config.clientIdEnv}/${config.clientSecretEnv} not set`);
  }
  if (!base) throw new Error("APP_BASE_URL not set");
  return {
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/$/, "")}/api/oauth/${provider}/callback`,
  };
}

/** Build the provider authorization URL for a connect flow. */
export function buildAuthorizationUrl(input: {
  provider: ConnectionProvider;
  credentials: OAuthCredentials;
  state: string;
  codeChallenge: string;
}): string {
  const config = getProviderConfig(input.provider);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.credentials.clientId,
    redirect_uri: input.credentials.redirectUri,
    scope: config.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    ...config.extraAuthParams,
  });
  return `${config.authUrl}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry time. */
  expiresAt?: Date;
  scope?: string;
  externalAccountId?: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function parseTokenResponse(raw: RawTokenResponse): TokenResponse {
  if (raw.error || !raw.access_token) {
    throw new Error(`Token endpoint error: ${raw.error ?? "no access_token"}`);
  }
  const out: TokenResponse = { accessToken: raw.access_token };
  if (raw.refresh_token) out.refreshToken = raw.refresh_token;
  if (typeof raw.expires_in === "number") {
    out.expiresAt = new Date(Date.now() + raw.expires_in * 1000);
  }
  if (raw.scope) out.scope = raw.scope;
  const sub = raw.id_token ? decodeIdTokenSub(raw.id_token) : undefined;
  if (sub) out.externalAccountId = sub;
  return out;
}

/** Best-effort extraction of the subject/email from an id_token (no verification). */
function decodeIdTokenSub(idToken: string): string | undefined {
  try {
    const payloadPart = idToken.split(".")[1];
    if (!payloadPart) return undefined;
    const json = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    return json.email ?? json.sub ?? undefined;
  } catch {
    return undefined;
  }
}

async function postToken(
  provider: ConnectionProvider,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const config = getProviderConfig(provider);
  const res = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const raw = (await res.json()) as RawTokenResponse;
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${raw.error ?? "unknown"}`);
  }
  return parseTokenResponse(raw);
}

/** Exchange an authorization code (with PKCE verifier) for tokens. */
export async function exchangeCodeForTokens(input: {
  provider: ConnectionProvider;
  credentials: OAuthCredentials;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.credentials.redirectUri,
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    code_verifier: input.codeVerifier,
  });
  return postToken(input.provider, body, input.fetchImpl ?? fetch);
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(input: {
  provider: ConnectionProvider;
  credentials: OAuthCredentials;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
  });
  return postToken(input.provider, body, input.fetchImpl ?? fetch);
}
