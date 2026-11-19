import { db } from "../db.js";

export async function assertSessionInOrg(sessionId: string, orgId: string) {
  const session = await db.session.findFirst({ where: { id: sessionId, orgId } });
  if (!session) throw Object.assign(new Error("session not found in your organization"), { status: 404 });
  return session;
}

export async function confirmRsvp(sessionId: string, learnerId: string, orgId?: string) {
  const session = orgId
    ? await assertSessionInOrg(sessionId, orgId)
    : await db.session.findUnique({ where: { id: sessionId } });
  if (!session) throw Object.assign(new Error("session not found"), { status: 404 });
  const confirmed = await db.sessionRSVP.count({ where: { sessionId, status: "confirmed" } });
  const status = session.capacity != null && confirmed >= session.capacity ? "waitlisted" : "confirmed";
  return db.sessionRSVP.upsert({
    where: { sessionId_learnerId: { sessionId, learnerId } },
    create: { sessionId, learnerId, status, respondedAt: new Date() },
    update: { status, respondedAt: new Date() },
  });
}

export async function declineRsvp(sessionId: string, learnerId: string, orgId?: string) {
  if (orgId) await assertSessionInOrg(sessionId, orgId);
  const rsvp = await db.sessionRSVP.findFirst({ where: { sessionId, learnerId } });
  if (!rsvp) throw Object.assign(new Error("rsvp not found"), { status: 404 });
  const wasConfirmed = rsvp.status === "confirmed";
  const updated = await db.sessionRSVP.update({ where: { id: rsvp.id }, data: { status: "declined", respondedAt: new Date() } });
  if (wasConfirmed) {
    const next = await db.sessionRSVP.findFirst({ where: { sessionId, status: "waitlisted" }, orderBy: { respondedAt: "asc" } });
    if (next) {
      await db.sessionRSVP.update({ where: { id: next.id }, data: { status: "confirmed" } });
      const { notify } = await import("./notify.js");
      await notify(next.learnerId, "session_waitlist_promoted", {
        title: "You are confirmed for a session",
        body: "A seat opened up and your RSVP was promoted from the waitlist.",
        link: "/calendar",
      });
    }
  }
  return updated;
}

export async function runRsvpReminders(staleHours = 48, now: Date = new Date()): Promise<{ reminded: number }> {
  const cutoff = new Date(now.getTime() - staleHours * 3600000);
  const stale = await db.sessionRSVP.findMany({ where: { status: "invited", respondedAt: null, createdAt: { lt: cutoff } }, include: { learner: { select: { email: true } }, session: { select: { title: true } } }, take: 200 }).catch(() => []);
  const { notify } = await import("./notify.js");
  let reminded = 0;
  for (const r of stale) {
    const existing = await db.reminderLog.findUnique({ where: { sessionId_learnerId_kind: { sessionId: r.sessionId, learnerId: r.learnerId, kind: "rsvp_reminder" } } }).catch(() => null);
    if (existing) continue;
    await notify(r.learnerId, "rsvp_reminder", { title: "Please respond to your session invitation", body: `You have not yet RSVP'd to "${r.session.title}".`, link: "/calendar" });
    await db.reminderLog.create({ data: { sessionId: r.sessionId, learnerId: r.learnerId, kind: "rsvp_reminder" } }).catch(() => null);
    reminded += 1;
  }
  return { reminded };
}
