import { db } from "../db.js";

// Completion != competence: this only measures required content items.
// Competence is computed separately from the applied assessment (Phase 4).
export async function recomputeEnrolmentProgress(enrolmentId: string): Promise<number> {
  const enrolment = await db.enrolment.findUnique({ where: { id: enrolmentId }, select: { courseId: true } }).catch(() => null);
  if (!enrolment) return 0;
  const required = await db.contentItem.findMany({
    where: { isArchived: false, required: true, module: { courseId: enrolment.courseId, isArchived: false, deletedAt: null } },
    select: { id: true },
  }).catch(() => [] as Array<{ id: string }>);
  if (!required.length) {
    await db.enrolment.update({ where: { id: enrolmentId }, data: { progress: 0 } }).catch(() => null);
    return 0;
  }
  const completed = await db.contentProgress.count({
    where: { enrolmentId, status: "completed", contentItemId: { in: required.map((r) => r.id) } },
  }).catch(() => 0);
  const pct = Math.round((completed / required.length) * 1000) / 10;
  await db.enrolment.update({ where: { id: enrolmentId }, data: { progress: pct } }).catch(() => null);
  return pct;
}

export function providerForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("coursera.org")) return "coursera";
    if (host.endsWith("linkedin.com")) return "linkedin_learning";
    if (host.endsWith("udemy.com")) return "udemy";
    return "other";
  } catch {
    return "other";
  }
}

export function isSafeExternalUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}
