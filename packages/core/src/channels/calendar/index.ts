import type { ConnectionProvider } from "@webflowd/shared";
import { getGoogleFreeBusy } from "./google.js";
import { getMicrosoftFreeBusy } from "./microsoft.js";
import type { BusyInterval, FreeBusyQuery } from "./types.js";

export * from "./types.js";
export * from "./google.js";
export * from "./microsoft.js";

/** Read free/busy from whichever calendar provider a connection uses. */
export async function readFreeBusy(
  provider: ConnectionProvider,
  accessToken: string,
  query: FreeBusyQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<BusyInterval[]> {
  switch (provider) {
    case "google":
      return getGoogleFreeBusy(accessToken, query, fetchImpl);
    case "microsoft":
      return getMicrosoftFreeBusy(accessToken, query, fetchImpl);
    default:
      throw new Error(`Provider ${provider} does not support calendar free/busy`);
  }
}
