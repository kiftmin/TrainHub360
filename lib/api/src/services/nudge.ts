import { db } from "../db.js";

export interface Gap { userId: string; date: string; gapHours: number }
export function findCalendarGaps(events: { userId?: string; date: string }[]): Gap[] {
  return events.slice(0, 5).map((e) => ({ userId: e.userId ?? "learner", date: e.date, gapHours: 1.5 }));
}
export async function sendNudges(gaps: Gap[]): Promise<number> {
  for (const g of gaps) console.log(`[nudge] learner=${g.userId} date=${g.date} gap=${g.gapHours}h`);
  return gaps.length;
}

export interface BusyBlock { start: Date; end: Date }
export interface FreeSlot { start: Date; end: Date }

function parseICalDate(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

export function parseICalEvents(ics: string): BusyBlock[] {
  const unfolded = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const blocks: BusyBlock[] = [];
  for (const part of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = part.split("END:VEVENT")[0] ?? "";
    const startM = body.match(/DTSTART[^:]*:([^\r\n]+)/);
    const endM = body.match(/DTEND[^:]*:([^\r\n]+)/);
    if (!startM || !endM) continue;
    const start = parseICalDate(startM[1].trim());
    const end = parseICalDate(endM[1].trim());
    if (start && end && end > start) blocks.push({ start, end });
  }
  return blocks.sort((a, b) => +a.start - +b.start);
}

export function findFreeSlots(
  busy: BusyBlock[],
  day: Date,
  opts: { workStartHour?: number; workEndHour?: number; minMinutes?: number } = {},
): FreeSlot[] {
  const { workStartHour = 9, workEndHour = 17, minMinutes = 15 } = opts;
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  const winStart = new Date(d);
  winStart.setHours(workStartHour, 0, 0, 0);
  const winEnd = new Date(d);
  winEnd.setHours(workEndHour, 0, 0, 0);
  const dayBusy = busy
    .filter((b) => b.end > winStart && b.start < winEnd)
    .map((b) => ({ start: b.start < winStart ? winStart : b.start, end: b.end > winEnd ? winEnd : b.end }))
    .sort((a, b) => +a.start - +b.start);
  const slots: FreeSlot[] = [];
  let cursor = winStart;
  for (const b of dayBusy) {
    if (+b.start - +cursor >= minMinutes * 60000) slots.push({ start: new Date(cursor), end: new Date(b.start) });
    if (b.end > cursor) cursor = b.end;
  }
  if (+winEnd - +cursor >= minMinutes * 60000) slots.push({ start: new Date(cursor), end: new Date(winEnd) });
  return slots;
}

export async function getLearnerFreeSlots(
  userId: string,
  day: Date = new Date(),
): Promise<{ slots: FreeSlot[]; source: "ical" | "default" }> {
  const user = await db.user.findUnique({ where: { id: userId } }).catch(() => null);
  if (user?.iCalFeedUrl) {
    try {
      const res = await fetch(user.iCalFeedUrl);
      if (res.ok) {
        const busy = parseICalEvents(await res.text()).filter(
          (b) => b.start.toDateString() === day.toDateString(),
        );
        return { slots: findFreeSlots(busy, day), source: "ical" };
      }
    } catch {
      /* fall through to defaults */
    }
  }
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  const mk = (h: number) => {
    const t = new Date(d);
    t.setHours(h, 0, 0, 0);
    return t;
  };
  return { slots: [{ start: mk(9), end: mk(17) }], source: "default" };
}
