import { db } from "../db.js";

const COMPLIANCE_CATEGORIES = ["compliance", "certification"];

export function needsCertificate(category: string | null, validityMonths: number | null): boolean {
  if (validityMonths && validityMonths > 0) return true;
  return !!category && COMPLIANCE_CATEGORIES.includes(category.toLowerCase());
}

export async function issueCertificateForEnrolment(enrolmentId: string): Promise<{ issued: boolean; id?: string }> {
  const e = await db.enrolment.findUnique({ where: { id: enrolmentId }, include: { course: true } }).catch(() => null);
  if (!e || e.status !== "completed") return { issued: false };
  const existing = await db.certificate.findFirst({ where: { enrolmentId: e.id, status: "active" } }).catch(() => null);
  if (existing) return { issued: false, id: existing.id };
  if (!needsCertificate(e.course.category, e.course.validityMonths)) return { issued: false };
  const months = e.course.validityMonths ?? 12;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + months);
  const cert = await db.certificate.create({
    data: { learnerId: e.learnerId, courseId: e.courseId, enrolmentId: e.id, expiresAt, status: "active" },
  });
  return { issued: true, id: cert.id };
}
