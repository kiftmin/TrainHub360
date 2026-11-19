import { db } from "../db.js";

export async function runCertificateExpiryJob(withinDays = 30, now: Date = new Date()): Promise<{ reminded: number; refresherEnrolments: number }> {
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + withinDays);
  const expiring = await db.certificate
    .findMany({ where: { status: "active", expiresAt: { lte: horizon } }, include: { course: true, learner: { select: { id: true, name: true, email: true } } }, take: 500 })
    .catch(() => []);
  let refresherEnrolments = 0;
  const { notify } = await import("../services/notify.js");
  for (const cert of expiring) {
    const since = new Date(now.getTime() - 24 * 3600000);
    const recent = await db.notification.findFirst({ where: { userId: cert.learnerId, type: "certificate_expiry", createdAt: { gte: since } } }).catch(() => null);
    if (!recent) {
      await notify(cert.learnerId, "certificate_expiry", {
        title: `Certificate expiring: ${cert.course.title}`,
        body: `Your certificate expires ${cert.expiresAt?.toISOString().slice(0, 10) ?? "soon"}.${cert.course.refresherCourseId ? " A refresher course is available." : ""}`,
        link: "/certificates",
      });
    }
    if (cert.course.refresherCourseId) {
      const refresher = await db.course.findUnique({ where: { id: cert.course.refresherCourseId } }).catch(() => null);
      if (refresher) {
        const existing = await db.enrolment.findFirst({ where: { learnerId: cert.learnerId, courseId: refresher.id } }).catch(() => null);
        if (!existing) {
          await db.enrolment.create({ data: { learnerId: cert.learnerId, courseId: refresher.id, programmeId: refresher.programmeId, status: "enrolled" } }).catch(() => null);
          refresherEnrolments += 1;
        }
      }
    }
  }
  return { reminded: expiring.length, refresherEnrolments };
}

export function scheduleCertificateExpiryJob() {
  const interval = Number(process.env.CERTIFICATE_EXPIRY_INTERVAL_MS ?? 0);
  if (!interval) return;
  setInterval(() => {
    runCertificateExpiryJob().catch((e) => console.error("[certificates] job failed", e));
  }, interval);
}
