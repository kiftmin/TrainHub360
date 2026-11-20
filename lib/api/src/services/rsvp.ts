import { db } from "../db.js";

export async function assertSessionInOrg(sessionId: string, orgId: string) {
  const session = await db.session.findFirst({ where: { id: sessionId, orgId } });
  if (!session) throw Object.assign(new Error("session not found in your organization"), { status: 404 });
  return session;
}

/**
 * Round 6 / M2(c): an RSVP is only for a session the learner could attend — the session is
 * theirs (programme invitation) or it belongs to a course they are enrolled on and have not
 * been withdrawn from. Anything else is a 403 rather than a silent seat in someone else's class.
 */
export async function assertRsvpEligible(sessionId: string, learnerId: string, orgId: string) {
  const session = await assertSessionInOrg(sessionId, orgId);
  if (session.status === "cancelled" || session.status === "completed") {
    throw Object.assign(new Error(`this session is ${session.status} and cannot be answered`), { status: 409 });
  }
  const invited = await db.sessionRSVP.findFirst({ where: { sessionId, learnerId }, select: { id: true } }).catch(() => null);
  if (invited) return session;
  const enrolled = session.courseId
    ? await db.enrolment.findFirst({ where: { learnerId, courseId: session.courseId, status: { not: "withdrawn" } }, select: { id: true } }).catch(() => null)
    : null;
  if (enrolled) return session;
  throw Object.assign(new Error("you are not invited to this session"), { status: 403 });
}

/**
 * Round 6 / M2(a) + M2(b): confirming twice must not lose a seat, and capacity must not be
 * exceeded by two confirmations at the same time.
 *
 * - (a) If the learner is already confirmed they stay confirmed, whatever the count says —
 *   their own seat is not counted against them.
 * - (b) The count and the write happen inside one transaction under a lock on the session row
 *   (`UPDLOCK, HOLDLOCK`), so two concurrent confirmations cannot both see "one seat left".
 *   This is a SQL Server database lock, not a process lock, so it holds across API instances.
 */
export async function confirmRsvp(sessionId: string, learnerId: string, orgId?: string) {
  if (orgId) await assertRsvpEligible(sessionId, learnerId, orgId);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; capacity: number | null; status: string }>>`
      SELECT id, capacity, status FROM sessions WITH (UPDLOCK, HOLDLOCK) WHERE id = ${sessionId}`;
    const locked = rows[0];
    if (!locked) throw Object.assign(new Error("session not found"), { status: 404 });
    if (locked.status === "cancelled" || locked.status === "completed") {
      throw Object.assign(new Error(`this session is ${locked.status} and cannot be answered`), { status: 409 });
    }
    const existing = await tx.sessionRSVP.findUnique({ where: { sessionId_learnerId: { sessionId, learnerId } } });
    // Already confirmed: keep the seat. A decline is the only way out of it.
    if (existing?.status === "confirmed") return existing;
    const confirmed = await tx.sessionRSVP.count({ where: { sessionId, status: "confirmed" } });
    const full = locked.capacity != null && confirmed >= locked.capacity;
    const status = full ? "waitlisted" : "confirmed";
    return tx.sessionRSVP.upsert({
      where: { sessionId_learnerId: { sessionId, learnerId } },
      create: { sessionId, learnerId, status, respondedAt: new Date() },
      update: { status, respondedAt: new Date() },
    });
  });
}

export async function declineRsvp(sessionId: string, learnerId: string, orgId?: string) {
  if (orgId) await assertSessionInOrg(sessionId, orgId);
  const rsvp = await db.sessionRSVP.findFirst({ where: { sessionId, learnerId } });
  if (!rsvp) throw Object.assign(new Error("rsvp not found"), { status: 404 });
  const wasConfirmed = rsvp.status === "confirmed";
  const updated = await db.sessionRSVP.update({ where: { id: rsvp.id }, data: { status: "declined", respondedAt: new Date() } });
  if (wasConfirmed) {
    // Promotion takes the session lock too, so a promotion and a new confirmation cannot both
    // take the same freed seat.
    const promoted = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sessions WITH (UPDLOCK, HOLDLOCK) WHERE id = ${sessionId}`;
      const next = await tx.sessionRSVP.findFirst({ where: { sessionId, status: "waitlisted" }, orderBy: { respondedAt: "asc" } });
      if (!next) return null;
      return tx.sessionRSVP.update({ where: { id: next.id }, data: { status: "confirmed" } });
    }).catch(() => null);
    if (promoted) {
      const { notify } = await import("./notify.js");
      await notify(promoted.learnerId, "session_waitlist_promoted", {
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
