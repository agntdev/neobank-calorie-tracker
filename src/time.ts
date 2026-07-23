// Time + budget-period utilities with an injectable clock seam.
//
// Every "now", schedule, cutoff, and late/on-time decision routes through
// `now()` (below), which a test can override via `setClock`. No inline
// `new Date()` / `Date.now()` in feature code.
//
// Budget periods are identified by a string KEY computed in the user's
// timezone (e.g. "2026-07-23" for daily, the Monday's date for weekly), so a
// transaction belongs to a period purely by its local calendar day — no
// brittle epoch-boundary arithmetic, and time-zone transitions are honored
// because the key is derived from the localized calendar date.

let clockFn: () => Date = () => new Date();

/** The single injectable clock. Override in a test with `setClock`. */
export function now(): Date {
  return new Date(clockFn().getTime());
}

/** Test seam: replace the clock. Pass a function returning a fixed Date. */
export function setClock(fn: () => Date): void {
  clockFn = fn;
}

/** Restore the real clock after a test override. */
export function resetClock(): void {
  clockFn = () => new Date();
}

const WEEKDAYS: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** Validate an IANA timezone name (e.g. "Europe/London") via Intl. */
export function isValidTimezone(tz: string): boolean {
  try {
    // Intl throws RangeError for unknown time zones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Localized calendar date for `date` in `tz`: year/month/day + weekday (0–6). */
export function localYMD(
  date: Date,
  tz: string,
): { y: number; m: number; d: number; wd: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    wd: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/**
 * A stable string identifying the budget period `timestamp` falls in, in the
 * user's timezone. Daily → the local date "YYYY-MM-DD"; weekly → the Monday of
 * that local week "YYYY-MM-DD" (weeks run Monday→Sunday). Two timestamps share
 * a key iff they are in the same budget period.
 */
export function periodKey(
  timestamp: number,
  tz: string,
  period: "daily" | "weekly",
): string {
  const { y, m, d, wd } = localYMD(new Date(timestamp), tz);
  if (period === "daily") return fmt(y, m, d);
  // Monday of this local week: shift the calendar day back by `wd` days.
  const monday = new Date(Date.UTC(y, m - 1, d - wd));
  return fmt(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

/** The period key for the current period (the one budgets are measured against). */
export function currentPeriodKey(
  tz: string,
  period: "daily" | "weekly",
  at: Date = now(),
): string {
  return periodKey(at.getTime(), tz, period);
}

/** Last N calendar days (inclusive of today), oldest first, as YYYY-MM-DD keys. */
export function lastNDayKeys(n: number, tz: string, at: Date = now()): string[] {
  const { y, m, d } = localYMD(at, tz);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(y, m - 1, d - i));
    out.push(fmt(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()));
  }
  return out;
}

function fmt(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Parse an "HH:mm" local time; returns null on malformed input. */
export function parseTime(input: string): { h: number; m: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(input.trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** Parts of `dt` in `tz` for offset arithmetic. */
function partsOf(
  dt: Date,
  tz: string,
  types: string[],
): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(dt)) {
    if (p.type === "hour") out.hour = Number(p.value) === 24 ? 0 : Number(p.value);
    else if (p.type === "minute") out.minute = Number(p.value);
    else if (p.type === "year") out.year = Number(p.value);
    else if (p.type === "month") out.month = Number(p.value);
    else if (p.type === "day") out.day = Number(p.value);
  }
  return out;
}

function absMinutes(p: { year: number; month: number; day: number; hour: number; minute: number }): number {
  // minutes from a fixed epoch (proleptic) — only differences matter.
  const days = Math.floor(
    Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) / 86400000,
  );
  return days * 1440 + p.hour * 60 + p.minute;
}

/** East offset (UTC+2 → 120) of `tz` at instant `tMs`. Handles DST + rollover. */
export function tzOffsetMinutes(tMs: number, tz: string): number {
  const dt = new Date(tMs);
  const lp = partsOf(dt, tz, []);
  const local = absMinutes({
    year: lp.year,
    month: lp.month,
    day: lp.day,
    hour: lp.hour,
    minute: lp.minute,
  });
  const utc = absMinutes({
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    hour: dt.getUTCHours(),
    minute: dt.getUTCMinutes(),
  });
  let diff = local - utc;
  if (diff > 14 * 60) diff -= 24 * 60;
  if (diff < -12 * 60) diff += 24 * 60;
  return diff;
}

/** Epoch ms for a local wall-clock time (y,mo,d,h,mi) in `tz`. Iterates to fix offset. */
export function localWallToEpoch(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 4; i++) {
    const off = tzOffsetMinutes(t, tz);
    const t2 = Date.UTC(y, mo - 1, d, h, mi) - off * 60000;
    if (t2 === t) return t;
    t = t2;
  }
  return t;
}

/** Epoch ms of the next occurrence (strictly after `fromMs`) of `hh:mm` in `tz`. */
export function nextLocalTimeMs(
  tz: string,
  hh: number,
  mm: number,
  fromMs: number = now().getTime(),
): number {
  const { y, m, d } = localYMD(new Date(fromMs), tz);
  const start = { y, mo: m, d };
  for (let i = 0; i < 3; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
    const t = localWallToEpoch(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hh,
      mm,
      tz,
    );
    if (t > fromMs) return t;
  }
  // Should never reach here; fall back to 24h ahead.
  return fromMs + 86400000;
}
