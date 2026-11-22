import { db, Prisma } from "../db.js";
import { notify } from "./notify.js";

// Round 10 / 1.1. One writer for all five effective score inputs. A sign-off is cleared only when
// one of those values really changes and the review-credit period is not locked. Callers commit the
// surrounding transaction first and only then send the returned notification effect.

export interface ScoreInputValues {
  appliedAssessmentScore: number | null;
  applicationScore: number | null;
  deadlineDate: Date | null;
  completionDate: Date | null;
  timelinessScore: number | null;
  enrolmentScore: number | null;
}

export interface ScoreChangeRow extends ScoreInputValues {
  id: string;
  learnerId: string;
  reviewCreditLockedAt: Date | null;
  managerSignOff: boolean | null;
}

export interface ScoreChangeEffect {
  changed: boolean;
  signOffCleared: boolean;
}

function sameValue(a: number | Date | null, b: number | Date | null): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.getTime() : null) === (b instanceof Date ? b.getTime() : null);
  }
  return a === b;
}

export function scoreInputsChanged(before: ScoreInputValues, after: ScoreInputValues): boolean {
  return (
    !sameValue(before.appliedAssessmentScore, after.appliedAssessmentScore) ||
    !sameValue(before.applicationScore, after.applicationScore) ||
    !sameValue(before.deadlineDate, after.deadlineDate) ||
    !sameValue(before.completionDate, after.completionDate) ||
    !sameValue(before.timelinessScore, after.timelinessScore) ||
    !sameValue(before.enrolmentScore, after.enrolmentScore)
  );
}

/** Read an enrolment under the same UPDLOCK/HOLDLOCK the evaluation loop uses. */
export async function lockEnrolmentRow(
  tx: Prisma.TransactionClient,
  enrolmentId: string,
): Promise<Prisma.EnrolmentGetPayload<object> | null> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT [id] FROM [dbo].[enrolments] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${enrolmentId}`;
  if (!locked.length) return null;
  return tx.enrolment.findUnique({ where: { id: enrolmentId } });
}

/**
 * Persist the effective score inputs when they changed. If a manager had signed off and the period
 * is open, the sign-off is cleared here and the caller is told to notify once after the commit.
 * When nothing changed this function performs no write at all.
 */
export async function applyScoreChange(
  tx: Prisma.TransactionClient,
  current: ScoreChangeRow,
  next: ScoreInputValues,
): Promise<ScoreChangeEffect> {
  if (!scoreInputsChanged(current, next)) return { changed: false, signOffCleared: false };
  const signOffCleared = !current.reviewCreditLockedAt && !!current.managerSignOff;
  await tx.enrolment.update({
    where: { id: current.id },
    data: {
      appliedAssessmentScore: next.appliedAssessmentScore,
      applicationScore: next.applicationScore,
      deadlineDate: next.deadlineDate,
      completionDate: next.completionDate,
      timelinessScore: next.timelinessScore,
      enrolmentScore: next.enrolmentScore,
      ...(signOffCleared ? { managerSignOff: false, managerSignOffBy: null, managerSignOffAt: null } : {}),
    },
  });
  return { changed: true, signOffCleared };
}

export async function notifyManagerSignoffRequired(learnerId: string, dedupeKey?: string): Promise<void> {
  const learner = await db.user.findUnique({ where: { id: learnerId }, select: { name: true, managerId: true } }).catch(() => null);
  if (!learner?.managerId) return;
  await notify(learner.managerId, "manager_signoff_required", {
    title: "Review-credit sign-off needs re-confirming",
    body: `${learner.name}'s score changed after your sign-off, so it must be confirmed again.`,
    link: "/review-credit",
    dedupeKey,
  });
}
