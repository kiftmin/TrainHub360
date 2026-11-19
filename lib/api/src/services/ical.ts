import { db } from "../db.js";

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function compact(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

// Sessions without an explicit startsAt fall back to the legacy date/time fields
// as floating local time (no Z), which is what the UI has always displayed.
function sessionStart(session: { startsAt: Date | null; date: string; time: string }): { value: string; date: Date } {
  if (session.startsAt) return { value: compact(session.startsAt), date: session.startsAt };
  const date = new Date(`${session.date}T${session.time}:00`);
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  const ymd = session.date.replace(/-/g, "");
  const hm = session.time.replace(/:/g, "").padEnd(4, "0").slice(0, 4);
  return { value: `${ymd}T${hm}00`, date: valid };
}

export function buildIcsCalendar(opts: {
  name: string;
  sessions: Array<{
    id: string;
    title: string;
    date: string;
    time: string;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone: string | null;
    location: string | null;
    joinUrl: string | null;
    trainer: string | null;
  }>;
  now?: Date;
}): string {
  const now = opts.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TrainHub360//Sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
  ];
  for (const s of opts.sessions) {
    const start = sessionStart(s);
    const end = s.endsAt ? compact(s.endsAt) : start.value.replace(/Z$/, "") + "";
    const description = [s.trainer ? `Trainer: ${s.trainer}` : null, s.joinUrl ? `Join: ${s.joinUrl}` : null].filter(Boolean).join("\\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(s.id)}@trainhub360`,
      `DTSTAMP:${compact(now)}`,
      `DTSTART:${start.value}`,
      `DTEND:${end}`,
      `SUMMARY:${icsEscape(s.title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      s.location ? `LOCATION:${icsEscape(s.location)}` : "",
      s.joinUrl ? `URL:${icsEscape(s.joinUrl)}` : "",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.filter((l) => l !== "").join("\r\n") + "\r\n";
}

export async function sessionsForUser(userId: string) {
  const rsvps = await db.sessionRSVP.findMany({ where: { learnerId: userId, status: { in: ["invited", "confirmed", "waitlisted"] } }, select: { sessionId: true } }).catch(() => [] as Array<{ sessionId: string }>);
  const courseSessions = await db.session.findMany({ where: { courseRef: { enrolments: { some: { learnerId: userId } } } }, select: { id: true } }).catch(() => [] as Array<{ id: string }>);
  const ids = [...new Set([...rsvps.map((r) => r.sessionId), ...courseSessions.map((c) => c.id)])];
  if (!ids.length) return [];
  return db.session.findMany({ where: { id: { in: ids } }, orderBy: { startsAt: "asc" } }).catch(() => []);
}
