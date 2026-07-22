import type { ConnectionProvider } from "@webflowd/shared";
import { HttpError } from "./http.js";

const CALENDAR_PROVIDERS = new Set<ConnectionProvider>(["google", "microsoft"]);

/** Validate a `:provider` path param for the calendar OAuth routes. */
export function requireCalendarProvider(value: string | undefined): ConnectionProvider {
  if (value && CALENDAR_PROVIDERS.has(value as ConnectionProvider)) {
    return value as ConnectionProvider;
  }
  throw new HttpError(404, "Unknown or unsupported provider");
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** Where to send the browser back to in the signed-in app after a connect flow. */
export function appReturnUrl(params: Record<string, string> = {}): string {
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const qs = new URLSearchParams(params).toString();
  return `${base}/app/${qs ? `?${qs}` : ""}`;
}
