import { PrismaClient } from "@prisma/client";

// Backfills Course.trainerId from the legacy denormalized trainer name.
// Only links a course when the name matches exactly ONE user in the course's
// organization; ambiguous/no matches are logged and left null (never guessed).
const db = new PrismaClient();

async function main() {
  const courses = await db.course.findMany({
    where: { trainerId: null },
    select: { id: true, title: true, trainer: true, programme: { select: { orgId: true } } },
  });
  const report = { total: courses.length, backfilled: 0, unmatched: [] as string[], ambiguous: [] as string[] };
  for (const course of courses) {
    const name = course.trainer?.trim();
    if (!name) continue;
    const orgId = course.programme.orgId;
    const users = await db.user.findMany({ where: { orgId, name }, select: { id: true, name: true } }).catch(() => []);
    if (users.length === 1) {
      await db.course.update({ where: { id: course.id }, data: { trainerId: users[0].id } });
      report.backfilled += 1;
    } else if (users.length === 0) {
      report.unmatched.push(`${course.id} "${course.title}" — no user named "${name}" in org ${orgId}`);
    } else {
      report.ambiguous.push(`${course.id} "${course.title}" — ${users.length} users named "${name}" in org ${orgId}; left null`);
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

await main().finally(() => db.$disconnect());
