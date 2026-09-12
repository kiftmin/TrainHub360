import { db } from "../db.js";

export type CalendarSender = (connection: { provider: string; calendarId: string | null }, event: { title: string; date: string; time: string }) => Promise<boolean>;

export const defaultSender: CalendarSender = async (connection, event) => {
  console.log(`[calendar] ${connection.provider} sync stub: "${event.title}" -> calendar ${connection.calendarId ?? "(default)"}`);
  return true;
};

export function buildExternalEvent(session: { title: string; date: string; time: string }) {
  return { title: `[TrainHub360] ${session.title}`, date: session.date, time: session.time };
}

export async function syncSessionToCalendars(sessionId: string, sender: CalendarSender = defaultSender): Promise<{ synced: number; skipped: number }> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) throw Object.assign(new Error("session not found"), { status: 404 });
  const rsvps = await db.sessionRSVP.findMany({ where: { sessionId, status: { in: ["confirmed", "invited"] } }, select: { learnerId: true } }).catch(() => []);
  const learnerIds = [...new Set(rsvps.map((r) => r.learnerId))];
  let synced = 0;
  let skipped = 0;
  for (const learnerId of learnerIds) {
    const connections = await db.calendarConnection.findMany({ where: { userId: learnerId } }).catch(() => []);
    if (!connections.length) {
      skipped += 1;
      continue;
    }
    const event = buildExternalEvent(session);
    for (const c of connections) {
      if (await sender({ provider: c.provider, calendarId: c.calendarId }, event).catch(() => false)) synced += 1;
    }
  }
  return { synced, skipped };
}
