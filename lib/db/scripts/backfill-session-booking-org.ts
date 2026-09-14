import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const report = { sessionsTotal: 0, sessionsBackfilled: 0, sessionsUnresolved: [] as string[], bookingsTotal: 0, bookingsBackfilled: 0, bookingsUnresolved: [] as string[] };

  const sessions = await db.session.findMany({ where: { orgId: null } });
  report.sessionsTotal = sessions.length;
  for (const s of sessions) {
    let orgId: string | null = null;
    if (s.programmeId) {
      const p = await db.programme.findUnique({ where: { id: s.programmeId } }).catch(() => null);
      if (p) orgId = p.orgId;
    }
    if (!orgId && s.programme) {
      const matches = await db.programme.findMany({ where: { name: s.programme } }).catch(() => []);
      if (matches.length === 1) orgId = matches[0].orgId;
    }
    if (orgId) {
      await db.session.update({ where: { id: s.id }, data: { orgId } });
      report.sessionsBackfilled += 1;
    } else {
      report.sessionsUnresolved.push(s.id);
    }
  }

  const bookings = await db.booking.findMany({ where: { orgId: null } });
  report.bookingsTotal = bookings.length;
  for (const b of bookings) {
    const users = await db.user.findMany({ where: { name: b.trainer } }).catch(() => []);
    const user = users.length === 1 ? users[0] : null;
    let courseId: string | null = null;
    if (b.course) {
      const courses = await db.course.findMany({ where: { title: b.course } }).catch(() => []);
      const inOrg = user ? courses.filter((c) => c.id) : courses;
      void inOrg;
      const scoped = user
        ? await db.course.findFirst({ where: { title: b.course, programme: { orgId: user.orgId } } }).catch(() => null)
        : await db.course.findFirst({ where: { title: b.course } }).catch(() => null);
      if (scoped) courseId = scoped.id;
    }
    if (user) {
      await db.booking.update({ where: { id: b.id }, data: { orgId: user.orgId, trainerId: user.id, courseId } });
      report.bookingsBackfilled += 1;
    } else {
      report.bookingsUnresolved.push(`${b.id} (trainer string "${b.trainer}" matches ${users.length} users — left null, not guessed)`);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

await main().finally(() => db.$disconnect());
