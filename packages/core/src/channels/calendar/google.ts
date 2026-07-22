import { type BusyInterval, type FreeBusyQuery, normaliseBusy } from "./types.js";

const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

interface GoogleFreeBusyResponse {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
}

/** Pure parser: Google freeBusy JSON → normalised busy intervals. */
export function parseGoogleFreeBusy(
  json: GoogleFreeBusyResponse,
  calendarId = "primary",
): BusyInterval[] {
  const cal = json.calendars?.[calendarId];
  const busy = (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  return normaliseBusy(busy);
}

/** Read free/busy for a Google calendar. Throws on a non-2xx response. */
export async function getGoogleFreeBusy(
  accessToken: string,
  query: FreeBusyQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<BusyInterval[]> {
  const calendarId = query.calendarId ?? "primary";
  const res = await fetchImpl(FREEBUSY_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: query.timeMin.toISOString(),
      timeMax: query.timeMax.toISOString(),
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Google freeBusy failed (${res.status})`);
  }
  return parseGoogleFreeBusy((await res.json()) as GoogleFreeBusyResponse, calendarId);
}
