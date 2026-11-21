import { db, Prisma } from "../db.js";
import { calculateEnrolmentScore } from "./reviewCredit.js";
import { notify } from "./notify.js";

// Round 8 / Phase 1. One idempotent function owns the answer to "is this enrolment
// complete?" so content progress, grading, publishing and manual edits cannot disagree.
//
// Definitions (completion is not competence):
//   content complete = every required, non-archived ContentItem of the course has a
//                      completed (self-reported or trainer-verified) ContentProgress.
//                      [CONFIRM] a course with no required content counts as complete.
//   competent        = content complete AND every live applied assessment met its pass mark.
//   completed        = competent. Only then are status/completionDate set automatically.

export type EnrolmentTrigger =
  | "content_progress"
  | "content_verification"
  | "content_changed"
  | "attempt_graded"
  | "assessment_published"
  | "assessment_superseded"
  | "manual_status";

export interface EnrolmentOutcome {
  enrolmentId: string;
  skipped: boolean;
  locked: boolean;
  contentComplete: boolean;
  contentCompletedAt: Date | null;
  competent: boolean;
  appliedScore: number;
  appliedScoreSource: string;
  scoreChanged: boolean;
  completed: boolean;
  newlyCompleted: boolean;
  certificateIssued: boolean;
}

interface OutcomeCore {
  enrolment: {
    id: string;
    learnerId: string;
    courseId: string;
    programmeId: string;
    status: string;
    withdrawnAt: Date | null;
    completionDate: Date | null;
    deadlineDate: Date | null;
    appliedAssessmentScore: number | null;
    appliedScoreSource: string;
    applicationScore: number | null;
    contentCompletedAt: Date | null;
    reviewCreditLockedAt: Date | null;
    managerSignOff: boolean | null;
  };
  contentComplete: boolean;
  competent: boolean;
  appliedScore: number;
  liveApplied: Array<{ id: string; title: string; passMark: number; best: number | null; passed: boolean }>;
}

async function computeOutcome(tx: Prisma.TransactionClient, enrolmentId: string): Promise<OutcomeCore | null> {
  const enrolment = await tx.enrolment.findUnique({ where: { id: enrolmentId } }).catch(() => null);
  if (!enrolment) return null;

  const required = await tx.contentItem.findMany({
    where: {
      isArchived: false,
      required: true,
      module: { courseId: enrolment.courseId, isArchived: false, deletedAt: null },
    },
    select: { id: true },
  });
  const completedRows = await tx.contentProgress.findMany({
    where: {
      enrolmentId,
      status: "completed",
      contentItemId: { in: required.map((r) => r.id) },
    },
    select: { contentItemId: true },
  });
  const completed = new Set(completedRows.map((r) => r.contentItemId));
  const contentComplete = required.every((r) => completed.has(r.id));

  // Live applied assessments: published, not archived/deleted, and not superseded.
  const applied = await tx.assessment.findMany({
    where: {
      type: "applied",
      isPublished: true,
      isArchived: false,
      deletedAt: null,
      supersededAt: null,
      module: { courseId: enrolment.courseId, isArchived: false, deletedAt: null },
    },
    select: { id: true, title: true, passMark: true },
  });
  // An applied assessment with no pass mark of its own uses the course threshold.
  const course = await tx.course.findUnique({ where: { id: enrolment.courseId }, select: { appliedThreshold: true } }).catch(() => null);
  const fallbackPassMark = course?.appliedThreshold ?? 70;

  const liveApplied: OutcomeCore["liveApplied"] = [];
  for (const a of applied) {
    const attempts = await tx.assessmentAttempt.findMany({
      where: {
        assessmentId: a.id,
        enrolmentId,
        status: { in: ["submitted", "graded"] },
        percent: { not: null },
      },
      select: { percent: true },
    });
    const best = attempts.length ? Math.max(...attempts.map((x) => x.percent ?? 0)) : null;
    const passMark = a.passMark ?? fallbackPassMark;
    liveApplied.push({ id: a.id, title: a.title, passMark, best, passed: best !== null && best >= passMark });
  }

  const competent = contentComplete && applied.length > 0 && liveApplied.every((a) => a.passed);
  // [CONFIRM] 2026-11-21: standing score is the average of each live applied
  // assessment's best graded percentage; an assessment with no graded attempt is 0.
  // It is computed from data, never as max(previous, new), so a superseded version
  // cannot inflate it.
  const appliedScore = applied.length
    ? Math.round((liveApplied.reduce((sum, a) => sum + (a.best ?? 0), 0) / applied.length) * 10) / 10
    : 0;

  return {
    enrolment: {
      id: enrolment.id,
      learnerId: enrolment.learnerId,
      courseId: enrolment.courseId,
      programmeId: enrolment.programmeId,
      status: enrolment.status,
      withdrawnAt: enrolment.withdrawnAt,
      completionDate: enrolment.completionDate,
      deadlineDate: enrolment.deadlineDate,
      appliedAssessmentScore: enrolment.appliedAssessmentScore,
      appliedScoreSource: enrolment.appliedScoreSource ?? "assessment",
      applicationScore: enrolment.applicationScore,
      contentCompletedAt: enrolment.contentCompletedAt ?? null,
      reviewCreditLockedAt: enrolment.reviewCreditLockedAt ?? null,
      managerSignOff: enrolment.managerSignOff ?? null,
    },
    contentComplete,
    competent,
    appliedScore,
    liveApplied,
  };
}

async function programmeAdminIds(programmeId: string): Promise<string[]> {
  // Programme admins plus org-wide staff (programmeId null) who oversee every programme.
  const rows = await db.userRole.findMany({
    where: {
      OR: [{ programmeId }, { programmeId: null }],
      role: { name: { in: ["admin", "owner"] } },
    },
    select: { userId: true },
  }).catch(() => [] as Array<{ userId: string }>);
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Recomputes and persists an enrolment's outcome. Safe to call repeatedly: it only
 * writes when a value actually changes. Never throws to the caller.
 */
export async function evaluateEnrolment(
  enrolmentId: string,
  trigger: EnrolmentTrigger = "content_progress",
  options: { attemptId?: string } = {},
): Promise<EnrolmentOutcome> {
  const empty: EnrolmentOutcome = {
    enrolmentId, skipped: true, locked: false, contentComplete: false, contentCompletedAt: null,
    competent: false, appliedScore: 0, appliedScoreSource: "assessment", scoreChanged: false,
    completed: false, newlyCompleted: false, certificateIssued: false,
  };
  try {
    const core = await computeOutcome(db, enrolmentId);
    if (!core) return empty;
    const e = core.enrolment;
    if (e.status === "withdrawn" || e.withdrawnAt) return { ...empty, skipped: true };

    const now = new Date();
    const locked = !!e.reviewCreditLockedAt;
    const nextContentCompletedAt = core.contentComplete ? (e.contentCompletedAt ?? now) : null;
    const contentCompletedAtChanged = (nextContentCompletedAt?.getTime() ?? null) !== (e.contentCompletedAt?.getTime() ?? null);

    // A locked period must not move the applied/timeliness/enrolment scores, status or
    // completion date. Content completion is not a score, so it can still be recorded.
    if (locked) {
      if (contentCompletedAtChanged) {
        await db.enrolment.update({ where: { id: e.id }, data: { contentCompletedAt: nextContentCompletedAt } }).catch(() => null);
      }
      if (trigger === "attempt_graded") {
        await db.auditLog.create({
          data: {
            userId: null,
            action: "ASSESSMENT_RESULT_NOT_APPLIED_LOCKED",
            entity: "enrolment",
            entityId: e.id,
            details: JSON.stringify({ trigger, appliedScore: core.appliedScore, liveApplied: core.liveApplied }),
          },
        }).catch(() => null);
        const admins = await programmeAdminIds(e.programmeId);
        const learner = await db.user.findUnique({ where: { id: e.learnerId }, select: { name: true, managerId: true } }).catch(() => null);
        await Promise.all([
          ...admins.map((userId) =>
            notify(userId, "assessment_result_locked", {
              title: "Assessment result not applied (period locked)",
              body: `${learner?.name ?? "A learner"}'s new result was recorded but the review-credit period is locked, so the score did not change.`,
              link: "/review-credit",
            }),
          ),
          learner?.managerId
            ? notify(learner.managerId, "assessment_result_locked", {
                title: "Assessment result not applied (period locked)",
                body: `${learner.name}'s new assessment result was recorded but the locked review-credit period was not changed.`,
                link: "/review-credit",
              })
            : Promise.resolve(),
        ]);
      }
      return {
        ...empty,
        skipped: false,
        locked: true,
        contentComplete: core.contentComplete,
        contentCompletedAt: nextContentCompletedAt,
        competent: core.competent,
        appliedScore: core.appliedScore,
        appliedScoreSource: e.appliedScoreSource,
        completed: e.status === "completed",
        certificateIssued: false,
      };
    }

    // Work out the applied score according to its source.
    let appliedScore = e.appliedAssessmentScore ?? 0;
    let scoreChanged = false;
    let pending: { score: number; at: Date } | null = null;
    if (e.appliedScoreSource === "manual") {
      // Automatic results never silently replace an override: keep them for review.
      if (core.appliedScore !== (e.appliedAssessmentScore ?? 0)) {
        pending = { score: core.appliedScore, at: now };
      }
    } else if (core.appliedScore !== (e.appliedAssessmentScore ?? 0)) {
      appliedScore = core.appliedScore;
      scoreChanged = true;
    }

    const completed = core.competent;
    const completionDate = completed ? (e.completionDate ?? now) : e.completionDate;
    const { score: enrolmentScore, b: timelinessScore } = calculateEnrolmentScore({
      appliedAssessmentScore: appliedScore,
      completionDate,
      deadlineDate: e.deadlineDate,
      applicationScore: e.applicationScore,
    });

    const status = completed ? "completed" : e.status === "completed" ? e.status : "enrolled";
    const resetSignOff = !!e.managerSignOff && (scoreChanged || pending !== null);

    const data: Prisma.EnrolmentUpdateInput = {
      contentCompletedAt: nextContentCompletedAt,
      appliedAssessmentScore: appliedScore,
      timelinessScore,
      enrolmentScore,
      status,
      completionDate,
      ...(pending ? { pendingAssessmentScore: pending.score, pendingAssessmentScoreAt: pending.at } : {}),
      ...(resetSignOff ? { managerSignOff: false, managerSignOffBy: null, managerSignOffAt: null } : {}),
    };
    const newlyCompleted = completed && e.status !== "completed";
    await db.enrolment.update({ where: { id: e.id }, data });

    if (resetSignOff) {
      const learner = await db.user.findUnique({ where: { id: e.learnerId }, select: { name: true, managerId: true } }).catch(() => null);
      if (learner?.managerId) {
        await notify(learner.managerId, "manager_signoff_required", {
          title: "Review-credit sign-off needs re-confirming",
          body: `${learner.name}'s score changed after your sign-off, so it must be confirmed again.`,
          link: "/review-credit",
        });
      }
    }

    let certificateIssued = false;
    // A completed (competent) enrolment with a certificate requirement holds a certificate,
    // issued once. On the first pass it is created from the attempt that earned it; a certificate
    // issued earlier from a staff status change is attached to that attempt instead of left empty.
    if (completed) {
      const [{ issueCertificateForEnrolment }, { checkStreakRecognition, checkAppliedScoreRecognition }] = await Promise.all([
        import("./certificates.js"),
        import("./recognition.js"),
      ]);
      const issued: { issued: boolean; existing?: boolean; id?: string } = await issueCertificateForEnrolment(e.id, options.attemptId).catch(() => ({ issued: false }));
      certificateIssued = !!issued.issued;
      if (issued.id && options.attemptId) {
        await db.certificate.updateMany({ where: { id: issued.id, attemptId: null }, data: { attemptId: options.attemptId } }).catch(() => null);
      }
      await checkStreakRecognition(e.learnerId).catch(() => null);
      await checkAppliedScoreRecognition(e.id).catch(() => null);
    }

    return {
      enrolmentId,
      skipped: false,
      locked: false,
      contentComplete: core.contentComplete,
      contentCompletedAt: nextContentCompletedAt,
      competent: core.competent,
      appliedScore,
      appliedScoreSource: e.appliedScoreSource,
      scoreChanged: scoreChanged || pending !== null,
      completed,
      newlyCompleted,
      certificateIssued,
    };
  } catch (err) {
    console.error("[enrolment-outcome] evaluate failed", enrolmentId, err);
    return empty;
  }
}

/** Re-evaluate every enrolment of a course (content changed, assessment published, etc.). */
export async function evaluateCourseEnrolments(courseId: string, trigger: EnrolmentTrigger): Promise<number> {
  const enrolments = await db.enrolment.findMany({
    where: { courseId, status: { not: "withdrawn" }, withdrawnAt: null },
    select: { id: true },
  }).catch(() => [] as Array<{ id: string }>);
  for (const e of enrolments) await evaluateEnrolment(e.id, trigger);
  return enrolments.length;
}
