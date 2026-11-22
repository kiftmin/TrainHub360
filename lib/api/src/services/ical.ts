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

function floating(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** A missing end is one hour after the start, in whichever form the start used. */
function sessionEnd(session: { startsAt: Date | null; endsAt: Date | null; date: string; time: string }): string {
  if (session.endsAt) return compact(session.endsAt);
  const start = sessionStart(session);
  const end = new Date(start.date.getTime() + 3600_000);
  return session.startsAt ? compact(end) : floating(end);
}

export interface IcsSession {
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
  sequence?: number;
}

export function buildIcsCalendar(opts: {
  name: string;
  sessions: IcsSession[];
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
    const end = sessionEnd(s);
    const description = [s.trainer ? `Trainer: ${s.trainer}` : null, s.joinUrl ? `Join: ${s.joinUrl}` : null].filter(Boolean).join("\\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(s.id)}@trainhub360`,
      `DTSTAMP:${compact(now)}`,
      `SEQUENCE:${s.sequence ?? 0}`,
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

/**
 * Round 8 / D.2: one event for one session, used by `GET /sessions/:id/ics` and by the mail
 * attached to invitations, edits and cancellations. The UID is the session id, so an update
 * replaces the event the client already has; `SEQUENCE` must increase for that replacement to
 * be accepted, and a cancellation is the same event with METHOD:CANCEL and STATUS:CANCELLED.
 */
export function buildSessionIcs(
  session: IcsSession,
  opts: { method?: "REQUEST" | "CANCEL"; now?: Date; attendeeEmail?: string } = {},
): string {
  const method = opts.method ?? "REQUEST";
  const now = opts.now ?? new Date();
  const start = sessionStart(session);
  const description = [session.trainer ? `Trainer: ${session.trainer}` : null, session.joinUrl ? `Join: ${session.joinUrl}` : null]
    .filter(Boolean)
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TrainHub360//Session//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${icsEscape(session.id)}@trainhub360`,
    `DTSTAMP:${compact(now)}`,
    `SEQUENCE:${session.sequence ?? 0}`,
    `DTSTART:${start.value}`,
    `DTEND:${sessionEnd(session)}`,
    `SUMMARY:${icsEscape(session.title)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : "",
    session.location ? `LOCATION:${icsEscape(session.location)}` : "",
    session.joinUrl ? `URL:${icsEscape(session.joinUrl)}` : "",
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "ORGANIZER;CN=TrainHub360:mailto:no-reply@trainhub360.local",
    opts.attendeeEmail ? `ATTENDEE;RSVP=TRUE:mailto:${icsEscape(opts.attendeeEmail)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter((l) => l !== "").join("\r\n") + "\r\n";
}

/** The `.ics` mail attachment (nodemailer expects base64 when `encoding` is set). */
export function icsAttachment(session: IcsSession, opts: { method?: "REQUEST" | "CANCEL"; attendeeEmail?: string } = {}) {
  return {
    filename: `${session.id}.ics`,
    contentType: "text/calendar; charset=utf-8",
    content: Buffer.from(buildSessionIcs(session, opts), "utf8").toString("base64"),
  };
}

export async function sessionsForUser(userId: string) {
  const rsvps = await db.sessionRSVP.findMany({ where: { learnerId: userId, status: { in: ["invited", "confirmed", "waitlisted"] } }, select: { sessionId: true } }).catch(() => [] as Array<{ sessionId: string }>);
  const courseSessions = await db.session.findMany({ where: { courseRef: { enrolments: { some: { learnerId: userId } } } }, select: { id: true } }).catch(() => [] as Array<{ id: string }>);
  const ids = [...new Set([...rsvps.map((r) => r.sessionId), ...courseSessions.map((c) => c.id)])];
  if (!ids.length) return [];
  return db.session.findMany({ where: { id: { in: ids } }, orderBy: { startsAt: "asc" } }).catch(() => []);
}
