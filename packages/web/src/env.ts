/** Public (client-safe) configuration, injected at build time by Vite. */
export const env = {
  auth0Domain: import.meta.env.VITE_AUTH0_DOMAIN as string,
  auth0ClientId: import.meta.env.VITE_AUTH0_CLIENT_ID as string,
  auth0Audience: import.meta.env.VITE_AUTH0_AUDIENCE as string,
  // API base; empty means same-origin (Netlify redirects /api/* to functions).
  apiBase: (import.meta.env.VITE_API_BASE as string | undefined) ?? "",
};

export function assertConfigured(): void {
  const missing = (["auth0Domain", "auth0ClientId", "auth0Audience"] as const).filter(
    (k) => !env[k],
  );
  if (missing.length) {
    throw new Error(
      `Missing Auth0 config: ${missing.join(", ")}. Set VITE_AUTH0_* in the build environment.`,
    );
  }
}
