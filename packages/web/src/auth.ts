import { createAuth0Client, type Auth0Client } from "@auth0/auth0-spa-js";
import { env } from "./env.js";

let clientPromise: Promise<Auth0Client> | null = null;

function redirectUri(): string {
  return `${window.location.origin}/app/`;
}

export function getAuth0(): Promise<Auth0Client> {
  if (!clientPromise) {
    clientPromise = createAuth0Client({
      domain: env.auth0Domain,
      clientId: env.auth0ClientId,
      authorizationParams: {
        redirect_uri: redirectUri(),
        audience: env.auth0Audience,
      },
      cacheLocation: "localstorage",
      useRefreshTokens: true,
    });
  }
  return clientPromise;
}

/** Complete an Auth0 redirect if we've just come back from the login page. */
export async function handleRedirectIfPresent(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.has("code") && params.has("state")) {
    const client = await getAuth0();
    await client.handleRedirectCallback();
    // Clean the query string from the URL bar.
    window.history.replaceState({}, document.title, "/app/");
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuth0()).isAuthenticated();
}

export async function login(): Promise<void> {
  await (await getAuth0()).loginWithRedirect();
}

export async function logout(): Promise<void> {
  await (await getAuth0()).logout({ logoutParams: { returnTo: redirectUri() } });
}

export async function getAccessToken(): Promise<string> {
  return (await getAuth0()).getTokenSilently();
}
