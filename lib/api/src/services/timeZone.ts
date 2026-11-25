const DAY_MS = 86_400_000;

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: string | null | undefined, fallback = "UTC"): string {
  return value && isValidTimeZone(value) ? value : fallback;
}

function partsIn(instant: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
}

function part(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((p) => p.type === type)?.value;
  return Number(value ?? 0);
}

export function localDateKey(instant: Date | string, timeZone: string): string {
  const parts = partsIn(new Date(instant), timeZone);
  return `${part(parts, "year")}-${String(part(parts, "month")).padStart(2, "0")}-${String(part(parts, "day")).padStart(2, "0")}`;
}

export function localTimeKey(instant: Date | string, timeZone: string): string {
  const parts = partsIn(new Date(instant), timeZone);
  return `${String(part(parts, "hour")).padStart(2, "0")}:${String(part(parts, "minute")).padStart(2, "0")}`;
}

export function addDays(dateKey: string, days: number): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  return new Date(parsed.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayForDateKey(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

export function calendarDateKey(value: Date | string | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function offsetAt(instantMs: number, timeZone: string): number {
  const instant = new Date(Math.floor(instantMs / 1000) * 1000);
  const parts = partsIn(instant, timeZone);
  const asUtc = Date.UTC(part(parts, "year"), part(parts, "month") - 1, part(parts, "day"), part(parts, "hour"), part(parts, "minute"), part(parts, "second"));
  return asUtc - instant.getTime();
}

export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!date || !clock) return null;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).toISOString().slice(0, 10) !== dateKey) return null;

  let candidate = wall - offsetAt(wall, timeZone);
  candidate = wall - offsetAt(candidate, timeZone);
  const parts = partsIn(new Date(candidate), timeZone);
  const local = `${part(parts, "year")}-${String(part(parts, "month")).padStart(2, "0")}-${String(part(parts, "day")).padStart(2, "0")}T${String(part(parts, "hour")).padStart(2, "0")}:${String(part(parts, "minute")).padStart(2, "0")}`;
  if (local !== `${dateKey}T${time}`) return null;
  return new Date(candidate);
}

export function startOfLocalDay(dateKey: string, timeZone: string): Date | null {
  return zonedTimeToUtc(dateKey, "00:00", timeZone);
}
