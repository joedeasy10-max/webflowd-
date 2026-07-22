import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  resolveCredentials,
} from "./providers.js";

const ENV = {
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  MS_CLIENT_ID: "mid",
  MS_CLIENT_SECRET: "msecret",
  APP_BASE_URL: "https://webflowd.com/",
} as NodeJS.ProcessEnv;

describe("resolveCredentials", () => {
  it("builds the callback redirect from APP_BASE_URL", () => {
    const c = resolveCredentials("google", ENV);
    expect(c.clientId).toBe("gid");
    expect(c.redirectUri).toBe("https://webflowd.com/api/oauth/google/callback");
  });

  it("throws when credentials are missing", () => {
    expect(() => resolveCredentials("google", {} as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("buildAuthorizationUrl", () => {
  it("includes PKCE, scopes, state and offline access for Google", () => {
    const url = new URL(
      buildAuthorizationUrl({
        provider: "google",
        credentials: resolveCredentials("google", ENV),
        state: "STATE",
        codeChallenge: "CHALLENGE",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });

  it("requests offline_access for Microsoft", () => {
    const url = new URL(
      buildAuthorizationUrl({
        provider: "microsoft",
        credentials: resolveCredentials("microsoft", ENV),
        state: "S",
        codeChallenge: "C",
      }),
    );
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadWrite");
  });
});

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("token exchange", () => {
  it("parses tokens and computes an absolute expiry", async () => {
    const fetchImpl = mockFetch({
      access_token: "AT",
      refresh_token: "RT",
      expires_in: 3600,
      scope: "calendar",
    });
    const tokens = await exchangeCodeForTokens({
      provider: "google",
      credentials: resolveCredentials("google", ENV),
      code: "code",
      codeVerifier: "verifier",
      fetchImpl,
    });
    expect(tokens.accessToken).toBe("AT");
    expect(tokens.refreshToken).toBe("RT");
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws on an error response", async () => {
    const fetchImpl = mockFetch({ error: "invalid_grant" }, false, 400);
    await expect(
      refreshAccessToken({
        provider: "google",
        credentials: resolveCredentials("google", ENV),
        refreshToken: "bad",
        fetchImpl,
      }),
    ).rejects.toThrow(/failed/);
  });
});
