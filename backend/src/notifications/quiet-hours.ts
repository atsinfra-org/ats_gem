export interface QuietHours {
  enabled: boolean;
  /** "HH:mm" in `timezone`. */
  start: string | null;
  end: string | null;
  timezone: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return HHMM.test(value);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const toMinutes = (hhmm: string): number => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/**
 * How long a non-critical email should be held so it lands after the user's quiet window (0 = send now). Handles
 * windows that cross midnight (22:00-07:00). start === end is treated as "no window". The delay is computed in whole
 * minutes from the local clock, which is exact for every real time zone except during a DST shift inside the window
 * (then delivery may be off by the shift, never dropped).
 */
export function quietHoursDelayMs(now: Date, quiet: QuietHours): number {
  if (!quiet.enabled || !quiet.start || !quiet.end || !isValidTimeZone(quiet.timezone)) return 0;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return 0;
  const current = localMinutes(now, quiet.timezone);
  const inside = start < end ? current >= start && current < end : current >= start || current < end;
  if (!inside) return 0;
  const minutesUntilEnd = ((end - current + 1440) % 1440) || 1440;
  return minutesUntilEnd * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
}
