import { DateTime } from "luxon";
import type { ConnectionProvider } from "@webflowd/shared";
import { DEFAULT_TIMEZONE } from "@webflowd/shared";

/**
 * Calendar event creation/cancellation for Google and Microsoft. Times are sent
 * as local wall-clock plus the business timezone so the event shows correctly in
 * the owner's calendar; the source of truth remains UTC in our DB.
 */

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: Date; // UTC instant
  end: Date; // UTC instant
  location?: string;
  timezone?: string;
}

function localParts(d: Date, tz: string) {
  return DateTime.fromJSDate(d)
    .setZone(tz)
    .toISO({ includeOffset: false, suppressMilliseconds: true });
}

export async function createGoogleEvent(
  accessToken: string,
  evt: CalendarEventInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ eventId: string }> {
  const tz = evt.timezone ?? DEFAULT_TIMEZONE;
  const res = await fetchImpl("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: evt.summary,
      description: evt.description,
      location: evt.location,
      start: { dateTime: localParts(evt.start, tz), timeZone: tz },
      end: { dateTime: localParts(evt.end, tz), timeZone: tz },
    }),
  });
  if (!res.ok) throw new Error(`Google event create failed (${res.status})`);
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error("Google event create returned no id");
  return { eventId: body.id };
}

export async function cancelGoogleEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
  );
  // 410 = already deleted; treat as success.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Google event delete failed (${res.status})`);
  }
}

export async function createMicrosoftEvent(
  accessToken: string,
  evt: CalendarEventInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ eventId: string }> {
  const tz = evt.timezone ?? DEFAULT_TIMEZONE;
  const res = await fetchImpl("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      subject: evt.summary,
      body: { contentType: "text", content: evt.description ?? "" },
      location: evt.location ? { displayName: evt.location } : undefined,
      start: { dateTime: localParts(evt.start, tz), timeZone: tz },
      end: { dateTime: localParts(evt.end, tz), timeZone: tz },
    }),
  });
  if (!res.ok) throw new Error(`Microsoft event create failed (${res.status})`);
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error("Microsoft event create returned no id");
  return { eventId: body.id };
}

export async function cancelMicrosoftEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(
    `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Microsoft event delete failed (${res.status})`);
  }
}

export async function createCalendarEvent(
  provider: ConnectionProvider,
  accessToken: string,
  evt: CalendarEventInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ eventId: string }> {
  if (provider === "google") return createGoogleEvent(accessToken, evt, fetchImpl);
  if (provider === "microsoft") return createMicrosoftEvent(accessToken, evt, fetchImpl);
  throw new Error(`Provider ${provider} cannot create calendar events`);
}

export async function cancelCalendarEvent(
  provider: ConnectionProvider,
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (provider === "google") return cancelGoogleEvent(accessToken, eventId, fetchImpl);
  if (provider === "microsoft") return cancelMicrosoftEvent(accessToken, eventId, fetchImpl);
  throw new Error(`Provider ${provider} cannot cancel calendar events`);
}
