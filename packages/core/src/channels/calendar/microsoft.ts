import { type BusyInterval, type FreeBusyQuery, normaliseBusy } from "./types.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphEvent {
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  showAs?: string; // free | tentative | busy | oof | workingElsewhere | unknown
  isCancelled?: boolean;
}
interface GraphCalendarViewResponse {
  value?: GraphEvent[];
}

/** showAs values that count as "busy" for availability. */
const BUSY_STATES = new Set(["busy", "tentative", "oof", "workingElsewhere"]);

/**
 * Pure parser: Graph calendarView JSON → busy intervals. Graph returns UTC when
 * we request it via the `Prefer: outlook.timezone="UTC"` header, so the
 * `dateTime` strings are treated as UTC.
 */
export function parseMicrosoftCalendarView(json: GraphCalendarViewResponse): BusyInterval[] {
  const intervals: BusyInterval[] = [];
  for (const ev of json.value ?? []) {
    if (ev.isCancelled) continue;
    if (ev.showAs && !BUSY_STATES.has(ev.showAs)) continue;
    const startStr = ev.start?.dateTime;
    const endStr = ev.end?.dateTime;
    if (!startStr || !endStr) continue;
    intervals.push({ start: parseGraphDate(startStr), end: parseGraphDate(endStr) });
  }
  return normaliseBusy(intervals);
}

/** Graph dateTime is ISO without a zone suffix; we request UTC, so append Z. */
function parseGraphDate(value: string): Date {
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

/** Read free/busy from a Microsoft (Graph) calendar via calendarView. */
export async function getMicrosoftFreeBusy(
  accessToken: string,
  query: FreeBusyQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<BusyInterval[]> {
  const params = new URLSearchParams({
    startDateTime: query.timeMin.toISOString(),
    endDateTime: query.timeMax.toISOString(),
    $select: "start,end,showAs,isCancelled",
    $top: "200",
  });
  const res = await fetchImpl(`${GRAPH_BASE}/me/calendarView?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) {
    throw new Error(`Microsoft calendarView failed (${res.status})`);
  }
  return parseMicrosoftCalendarView((await res.json()) as GraphCalendarViewResponse);
}
