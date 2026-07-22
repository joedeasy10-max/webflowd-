/** A busy time range (UTC instants). Free/busy readers normalise to this. */
export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface FreeBusyQuery {
  timeMin: Date;
  timeMax: Date;
  /** Provider calendar identifier; defaults to the primary calendar. */
  calendarId?: string;
}

/** Merge overlapping/adjacent intervals and sort by start. */
export function normaliseBusy(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: BusyInterval[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}
