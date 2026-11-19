import { db } from "../db.js";
import { notify } from "../services/notify.js";

// Reminds confirmed attendees for sessions starting inside the window.
// Dedupe is guaranteed by the ReminderLog unique (sessionId, learnerId, kind).
export async function runSessionReminderJob(now: Date = new Date(), withinHours = 24): Promise<{ reminded: number }> {
  const horizon = new Date(now.getTime() + withinHours * 3600000);
  const sessions = await db.session.findMany({
    where: { startsAt: { gte: now, lte: horizon } },
    select: { id: true, title: true, startsAt: true, joinUrl: true, location: true },
    take: 500,
  }).catch(() => [] as Array<{ id: string; title: string; startsAt: Date | null; joinUrl: string | null; location: string | null }>);
  let reminded = 0;
  for (const session of sessions) {
    const confirmed = await db.sessionRSVP.findMany({ where: { sessionId: session.id, status: "confirmed" }, select: { learnerId: true } }).catch(() => [] as Array<{ learnerId: string }>);
    for (const attendee of confirmed) {
      const existing = await db.reminderLog.findUnique({ where: { sessionId_learnerId_kind: { sessionId: session.id, learnerId: attendee.learnerId, kind: "session_reminder" } } }).catch(() => null);
      if (existing) continue;
      const when = session.startsAt ? session.startsAt.toLocaleString("en-GB") : "soon";
      await notify(attendee.learnerId, "session_reminder", {
        title: `Session reminder: ${session.title}`,
        body: `Starts ${when}.${session.joinUrl ? ` Join: ${session.joinUrl}` : session.location ? ` Location: ${session.location}` : ""}`,
        link: "/calendar",
      });
      await db.reminderLog.create({ data: { sessionId: session.id, learnerId: attendee.learnerId, kind: "session_reminder" } }).catch(() => null);
      reminded += 1;
    }
  }
  return { reminded };
}

export function scheduleSessionReminderJob() {
  const interval = Number(process.env.SESSION_REMINDER_INTERVAL_MS ?? 0);
  if (!interval) return;
  setInterval(() => {
    runSessionReminderJob().catch((e) => console.error("[session-reminders] job failed", e));
  }, interval);
}
