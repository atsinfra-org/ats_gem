const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };

/** Parses "15m", "1d", "30s" style durations (as used for JWT_ACCESS_TTL) into whole seconds. */
export function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) throw new Error(`Invalid duration "${input}": expected a number followed by s, m, h or d (e.g. "15m")`);
  return Number(match[1]) * UNIT_SECONDS[match[2]];
}
