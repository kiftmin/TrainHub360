import { db } from "../db.js";
import { flagStaleCourses } from "../services/contentLifecycle.js";

export async function runContentLifecycleJob(now: Date = new Date()): Promise<{ archived: number; ids: string[] }> {
  const courses = await db.course.findMany({ where: { isArchived: false, deletedAt: null }, take: 1000 }).catch(() => []);
  if (!courses.length) return { archived: 0, ids: [] };
  const ids = courses.map((c) => c.id);
  const enrolments = await db.enrolment.findMany({ where: { courseId: { in: ids } }, select: { courseId: true, completionDate: true, status: true } }).catch(() => []);
  const lastActive = new Map<string, Date>();
  for (const e of enrolments) {
    if (!e.completionDate) continue;
    const prev = lastActive.get(e.courseId);
    if (!prev || e.completionDate > prev) lastActive.set(e.courseId, e.completionDate);
  }
  const byKey = new Map<string, typeof courses>();
  for (const c of courses) {
    const key = `${c.programmeId}::${c.title.toLowerCase()}`;
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const flagged = flagStaleCourses(
    courses.map((c) => ({
      id: c.id,
      version: c.version,
      isArchived: c.isArchived,
      lastActiveEnrolmentAt: lastActive.get(c.id) ?? null,
      hasNewerVersion: (byKey.get(`${c.programmeId}::${c.title.toLowerCase()}`) ?? []).some((s) => s.version > c.version),
    })),
    now,
  );
  for (const f of flagged) {
    await db.course.update({ where: { id: f.id }, data: { isArchived: true, archivedAt: now } }).catch(() => null);
    await db.auditLog.create({ data: { userId: null, action: "CONTENT_LIFECYCLE_ARCHIVE", entity: "course", entityId: f.id, details: null } }).catch(() => null);
  }
  if (flagged.length) console.log(`[lifecycle] archived ${flagged.length} stale course(s)`);
  return { archived: flagged.length, ids: flagged.map((f) => f.id) };
}

export function scheduleContentLifecycleJob() {
  const interval = Number(process.env.CONTENT_LIFECYCLE_INTERVAL_MS ?? 0);
  if (!interval) return;
  setInterval(() => {
    runContentLifecycleJob().catch((e) => console.error("[lifecycle] job failed", e));
  }, interval);
}
