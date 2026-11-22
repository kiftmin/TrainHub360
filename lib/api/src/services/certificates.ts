import { db, Prisma } from "../db.js";
import { isUniqueViolation } from "./dbErrors.js";

const COMPLIANCE_CATEGORIES = ["compliance", "certification"];

async function existingActiveCertificate(enrolmentId: string) {
  return db.certificate.findFirst({ where: { enrolmentId, status: "active" } }).catch(() => null);
}

export function needsCertificate(category: string | null, validityMonths: number | null): boolean {
  if (validityMonths && validityMonths > 0) return true;
  return !!category && COMPLIANCE_CATEGORIES.includes(category.toLowerCase());
}

export async function issueCertificateForEnrolment(enrolmentId: string, attemptId?: string): Promise<{ issued: boolean; existing?: boolean; id?: string; reason?: string }> {
  const e = await db.enrolment.findUnique({ where: { id: enrolmentId }, include: { course: true } }).catch(() => null);
  if (!e || e.status !== "completed") return { issued: false };
  // Round 9 / 1.2: a status alone is not evidence. "assessment" is written by the evaluation loop
  // when the content is complete and every live applied assessment is passed; "manual" by a staff
  // override that carried a reason. Nothing else may produce a certificate.
  if (!e.completionSource) return { issued: false, reason: "no completion source" };
  const existing = await existingActiveCertificate(e.id);
  // The attempt is passed in by whoever knows it: a certificate issued from the assessment loop
  // points at the attempt that earned it, while one issued from a staff status change has none.
  if (existing) return { issued: false, existing: true, id: existing.id };
  if (!needsCertificate(e.course.category, e.course.validityMonths)) return { issued: false };
  const months = e.course.validityMonths ?? 12;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + months);
  try {
    const cert = await db.certificate.create({
      data: { learnerId: e.learnerId, courseId: e.courseId, enrolmentId: e.id, attemptId: attemptId ?? null, expiresAt, status: "active" },
    });
    return { issued: true, id: cert.id };
  } catch (error) {
    // Round 13 / 1.1: the filtered unique index is the authority. Two evaluations that both
    // passed the pre-check must converge on one certificate, never surface a 2601/2627/P2002.
    if (!isUniqueViolation(error)) throw error;
    const winner = await existingActiveCertificate(e.id);
    return winner ? { issued: false, existing: true, id: winner.id } : { issued: false };
  }
}

export async function revokeCertificatesForEnrolment(
  tx: Prisma.TransactionClient,
  enrolmentId: string,
): Promise<string[]> {
  const active = await tx.certificate.findMany({ where: { enrolmentId, status: "active" }, select: { id: true } });
  if (!active.length) return [];
  const ids = active.map((c) => c.id);
  await tx.certificate.updateMany({ where: { id: { in: ids } }, data: { status: "revoked" } });
  return ids;
}
