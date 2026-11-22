import { db, Prisma } from "../db.js";
import { attemptStats } from "./assessmentAttempts.js";
import { calculateEnrolmentScore } from "./reviewCredit.js";
import { notify } from "./notify.js";
import { applyScoreChange, notifyManagerSignoffRequired } from "./scoreChange.js";

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
    pendingAssessmentScore: number | null;
    pendingAssessmentScoreAt: Date | null;
    pendingRejectedScore: number | null;
    timelinessScore: number | null;
    enrolmentScore: number | null;
    contentCompletedAt: Date | null;
    reviewCreditLockedAt: Date | null;
    managerSignOff: boolean | null;
    completionSource: string | null;
  };
  contentComplete: boolean;
  competent: boolean;
  appliedScore: number;
  liveApplied: Array<{ id: string; title: string; passMark: number; best: number | null; passed: boolean; attempts: number; carriedVersions: number }>;
}

async function computeOutcome(
  tx: Prisma.TransactionClient,
  enrolmentId: string,
  options: { lock?: boolean } = {},
): Promise<OutcomeCore | null> {
  // Round 9 / 3.2: the row is read under the same lock RSVP capacity uses, so two triggers (a
  // grade landing while the last content item is marked complete) serialize instead of each
  // computing "not completed yet" and both writing a certificate.
  const enrolment = options.lock
    ? ((await tx.$queryRaw<Array<{ id: string }>>`SELECT [id] FROM [dbo].[enrolments] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${enrolmentId}`)[0] ?? null)
    : await tx.enrolment.findUnique({ where: { id: enrolmentId } }).catch(() => null);
  if (!enrolment) return null;
  const row = await tx.enrolment.findUnique({ where: { id: enrolmentId } });
  if (!row) return null;

  const required = await tx.contentItem.findMany({
    where: {
      isArchived: false,
      required: true,
      module: { courseId: row.courseId, isArchived: false, deletedAt: null },
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
      module: { courseId: row.courseId, isArchived: false, deletedAt: null },
    },
    select: { id: true, title: true, passMark: true, maxAttempts: true, supersedesId: true, changeKind: true },
  });
  // An applied assessment with no pass mark of its own uses the course threshold.
  const course = await tx.course.findUnique({ where: { id: row.courseId }, select: { appliedThreshold: true } }).catch(() => null);
  const fallbackPassMark = course?.appliedThreshold ?? 70;

  const liveApplied: OutcomeCore["liveApplied"] = [];
  for (const a of applied) {
    const passMark = a.passMark ?? fallbackPassMark;
    const stats = await attemptStats(tx, a, enrolmentId, passMark);
    liveApplied.push({
      id: a.id,
      title: a.title,
      passMark,
      best: stats.bestScore,
      passed: stats.passedBefore,
      attempts: stats.attemptsUsed,
      carriedVersions: stats.chainIds.length - 1,
    });
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
      id: row.id,
      learnerId: row.learnerId,
      courseId: row.courseId,
      programmeId: row.programmeId,
      status: row.status,
      withdrawnAt: row.withdrawnAt,
      completionDate: row.completionDate,
      deadlineDate: row.deadlineDate,
      appliedAssessmentScore: row.appliedAssessmentScore,
      appliedScoreSource: row.appliedScoreSource ?? "assessment",
      applicationScore: row.applicationScore,
      pendingAssessmentScore: row.pendingAssessmentScore,
      pendingAssessmentScoreAt: row.pendingAssessmentScoreAt,
      pendingRejectedScore: row.pendingRejectedScore,
      timelinessScore: row.timelinessScore,
      enrolmentScore: row.enrolmentScore,
      contentCompletedAt: row.contentCompletedAt ?? null,
      reviewCreditLockedAt: row.reviewCreditLockedAt ?? null,
      managerSignOff: row.managerSignOff ?? null,
      completionSource: row.completionSource ?? null,
    },
    contentComplete,
    competent,
    appliedScore,
    liveApplied,
  };
}

async function programmeAdminIds(programmeId: string, client: Prisma.TransactionClient | typeof db = db): Promise<string[]> {
  // Programme admins plus org-wide staff (programmeId null) who oversee every programme.
  const rows = await client.userRole.findMany({
    where: {
      OR: [{ programmeId }, { programmeId: null }],
      role: { name: { in: ["admin", "owner"] } },
    },
    select: { userId: true },
  }).catch(() => [] as Array<{ userId: string }>);
  return [...new Set(rows.map((r) => r.userId))];
}

async function programmeStaffIds(programmeId: string, client: Prisma.TransactionClient | typeof db = db): Promise<string[]> {
  const rows = await client.userRole.findMany({
    where: {
      OR: [{ programmeId }, { programmeId: null }],
      role: { name: { in: ["admin", "owner", "trainer"] } },
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
  return runEvaluation(enrolmentId, trigger, options, empty);
}

type SideEffect =
  | { kind: "locked_notice"; programmeId: string; learnerId: string }
  | { kind: "signoff_reset"; learnerId: string }
  | { kind: "pending_changed"; programmeId: string; learnerId: string; score: number }
  | { kind: "completed"; learnerId: string; attemptId?: string; newlyCompleted: boolean };

/**
 * Everything a person can see, after the commit. It only does anything for the enrolments the
 * transaction actually completed or whose score really moved, so a repeated evaluation (an
 * unrelated content edit, a second trigger) cannot send the same notice twice.
 */
async function runSideEffects(outcome: EnrolmentOutcome, effects: SideEffect[]): Promise<boolean> {
  let certificateIssued = false;
  for (const effect of effects) {
    if (effect.kind === "locked_notice") {
      const admins = await programmeAdminIds(effect.programmeId);
      const learner = await db.user.findUnique({ where: { id: effect.learnerId }, select: { name: true, managerId: true } }).catch(() => null);
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
      continue;
    }
    if (effect.kind === "signoff_reset") {
      await notifyManagerSignoffRequired(effect.learnerId);
      continue;
    }
    if (effect.kind === "pending_changed") {
      const staffIds = await programmeStaffIds(effect.programmeId);
      const learner = await db.user.findUnique({ where: { id: effect.learnerId }, select: { name: true } }).catch(() => null);
      await Promise.all(staffIds.map((userId) =>
        notify(userId, "assessment_result_pending", {
          title: "Assessment result waiting for review",
          body: `${learner?.name ?? "A learner"}'s automatic assessment result is ${effect.score}% and is waiting for your review.`,
          link: "/review-credit",
        }),
      ));
      continue;
    }
    const [{ issueCertificateForEnrolment }, { checkStreakRecognition, checkAppliedScoreRecognition }] = await Promise.all([
      import("./certificates.js"),
      import("./recognition.js"),
    ]);
    const issued: { issued: boolean; existing?: boolean; id?: string } = await issueCertificateForEnrolment(outcome.enrolmentId, effect.attemptId).catch(() => ({ issued: false }));
    if (issued.issued) certificateIssued = true;
    if (issued.id && effect.attemptId) {
      await db.certificate.updateMany({ where: { id: issued.id, attemptId: null }, data: { attemptId: effect.attemptId } }).catch(() => null);
    }
    if (effect.newlyCompleted) {
      await checkStreakRecognition(effect.learnerId).catch(() => null);
      await checkAppliedScoreRecognition(outcome.enrolmentId).catch(() => null);
    }
  }
  return certificateIssued;
}

/**
 * Round 9 / 3.2. The read, the decision and the write happen inside one transaction that holds
 * the enrolment row, so two triggers at once serialize on it. Everything a person can see —
 * certificate, recognition, notifications — runs after the commit, and only for the transition the
 * transaction itself reported, so the same completion cannot be announced twice.
 */
async function runEvaluation(
  enrolmentId: string,
  trigger: EnrolmentTrigger,
  options: { attemptId?: string },
  empty: EnrolmentOutcome,
): Promise<EnrolmentOutcome> {
  try {
    const effects: SideEffect[] = [];
    const outcome = await db.$transaction(async (tx) => {
      const core = await computeOutcome(tx, enrolmentId, { lock: true });
      if (!core) return null;
      const e = core.enrolment;
      if (e.status === "withdrawn" || e.withdrawnAt) return { ...empty, skipped: true };

      const now = new Date();
      const locked = !!e.reviewCreditLockedAt;
      const nextContentCompletedAt = core.contentComplete ? (e.contentCompletedAt ?? now) : null;
      const contentCompletedAtChanged = (nextContentCompletedAt?.getTime() ?? null) !== (e.contentCompletedAt?.getTime() ?? null);

      // A locked period must not move the applied/timeliness/enrolment scores, status or
      // completion date. Content completion is not a score, so it can still be recorded. The new
      // automatic result is held for staff review rather than silently dropped: accepting it is an
      // explicit override, which is the only way across a locked review-credit period.
      if (locked) {
        const shouldHold = trigger === "attempt_graded"
          && core.appliedScore !== (e.appliedAssessmentScore ?? 0)
          && core.appliedScore !== e.pendingRejectedScore
          && core.appliedScore !== e.pendingAssessmentScore;
        const pendingChanged = shouldHold;
        if (contentCompletedAtChanged || shouldHold) {
          await tx.enrolment.update({
            where: { id: e.id },
            data: {
              ...(contentCompletedAtChanged ? { contentCompletedAt: nextContentCompletedAt } : {}),
              ...(shouldHold ? { pendingAssessmentScore: core.appliedScore, pendingAssessmentScoreAt: now, pendingRejectedScore: null } : {}),
            },
          }).catch(() => null);
        }
        if (trigger === "attempt_graded") {
          await tx.auditLog.create({
            data: {
              userId: null,
              action: "ASSESSMENT_RESULT_NOT_APPLIED_LOCKED",
              entity: "enrolment",
              entityId: e.id,
              details: JSON.stringify({ trigger, appliedScore: core.appliedScore, liveApplied: core.liveApplied, heldForReview: pendingChanged }),
            },
          }).catch(() => null);
          effects.push({ kind: "locked_notice", programmeId: e.programmeId, learnerId: e.learnerId });
          if (pendingChanged) effects.push({ kind: "pending_changed", programmeId: e.programmeId, learnerId: e.learnerId, score: core.appliedScore });
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
          scoreChanged: pendingChanged,
          completed: e.status === "completed",
          certificateIssued: false,
        };
      }

      // Work out the applied score according to its source.
      // Round 9 / 2.3: once an enrolment is completed with a source, an assessment edit never
      // un-completes it. A minor correction carries the result forward so `competent` stays true
      // anyway; a new paper would otherwise set this to false and take the completion away from
      // someone who already earned it.
      const alreadyCompleted = e.status === "completed" && !!e.completionSource;
      // A completed learner's stored score may go up, never down (round 9 / 2.3).
      const floor = alreadyCompleted ? e.appliedAssessmentScore ?? 0 : 0;
      const computed = Math.max(core.appliedScore, floor);
      let appliedScore = e.appliedAssessmentScore ?? 0;
      let scoreChanged = false;
      let pendingScore: number | null = e.pendingAssessmentScore;
      let pendingAt: Date | null = e.pendingAssessmentScoreAt;
      let pendingChanged = false;
      if (e.appliedScoreSource === "manual") {
        // Round 10 / 1.2: a manual override is never overwritten. The automatic result is held for
        // review, but only a change of value creates a new notification. A rejected value is not
        // offered again until the computed result is genuinely different.
        if (computed === (e.appliedAssessmentScore ?? 0) || computed === e.pendingRejectedScore) {
          pendingScore = null;
          pendingAt = null;
        } else if (computed !== e.pendingAssessmentScore) {
          pendingScore = computed;
          pendingAt = now;
          pendingChanged = true;
        } else {
          pendingAt = e.pendingAssessmentScoreAt ?? now;
        }
      } else {
        pendingScore = null;
        pendingAt = null;
        if (computed !== (e.appliedAssessmentScore ?? 0)) {
          appliedScore = computed;
          scoreChanged = true;
        }
      }

      const completed = core.competent || alreadyCompleted;
      const completionDate = completed ? (e.completionDate ?? now) : e.completionDate;
      const { score: enrolmentScore, b: timelinessScore } = calculateEnrolmentScore({
        appliedAssessmentScore: appliedScore,
        completionDate,
        deadlineDate: e.deadlineDate,
        applicationScore: e.applicationScore,
      });

      const status = completed ? "completed" : e.status === "completed" ? e.status : "enrolled";
      const completionSource = completed ? (e.completionSource ?? "assessment") : e.completionSource;
      // A pending result does not change the applied score, so it cannot invalidate a manager's
      // sign-off. The completion date, if any, is written below without touching score inputs.
      const pendingHold = e.appliedScoreSource === "manual" && !scoreChanged;
      const scoreEffect = await applyScoreChange(tx, e, {
        appliedAssessmentScore: appliedScore,
        applicationScore: e.applicationScore,
        deadlineDate: e.deadlineDate,
        completionDate: pendingHold ? e.completionDate : completionDate,
        timelinessScore: pendingHold ? e.timelinessScore : timelinessScore,
        enrolmentScore: pendingHold ? e.enrolmentScore : enrolmentScore,
      });

      const newlyCompleted = completed && e.status !== "completed";
      await tx.enrolment.update({
        where: { id: e.id },
        data: {
          contentCompletedAt: nextContentCompletedAt,
          completionDate,
          // Round 9 / 1.2: the automatic loop is the only writer of "assessment", and only for an
          // enrolment it actually completes. A manual override sets "manual" and this leaves it alone.
          completionSource,
          status,
          pendingAssessmentScore: pendingScore,
          pendingAssessmentScoreAt: pendingAt,
          ...(pendingChanged ? { pendingRejectedScore: null } : {}),
        },
      });

      // Both effects are post-commit: a failed notification cannot roll back a valid score change.
      if (scoreEffect.signOffCleared) effects.push({ kind: "signoff_reset", learnerId: e.learnerId });
      if (pendingChanged && pendingScore !== null) {
        effects.push({ kind: "pending_changed", programmeId: e.programmeId, learnerId: e.learnerId, score: pendingScore });
      }

      // A completed (competent) enrolment with a certificate requirement holds a certificate,
      // issued once. It is issued after the commit, and only by the transaction that completed the
      // enrolment, so two concurrent triggers cannot both open one.
      if (completed) effects.push({ kind: "completed", learnerId: e.learnerId, attemptId: options.attemptId, newlyCompleted });

      return {
        enrolmentId,
        skipped: false,
        locked: false,
        contentComplete: core.contentComplete,
        contentCompletedAt: nextContentCompletedAt,
        competent: core.competent,
        appliedScore,
        appliedScoreSource: e.appliedScoreSource,
        scoreChanged: scoreChanged || pendingChanged,
        completed,
        newlyCompleted,
        certificateIssued: false,
      };
    });
    if (!outcome) return empty;
    const certificateIssued = await runSideEffects(outcome, effects);
    return { ...outcome, certificateIssued };
  } catch (err) {
    console.error("[enrolment-outcome] evaluate failed", enrolmentId, err);
    return empty;
  }
}

/** Re-evaluate every enrolment of a course (content changed, assessment published, etc.). */
export async function evaluateCourseEnrolments(
  courseId: string,
  trigger: EnrolmentTrigger,
  onBatch?: (processed: number, total: number) => Promise<void> | void,
): Promise<number> {
  const total = await db.enrolment.count({ where: { courseId, status: { not: "withdrawn" }, withdrawnAt: null } }).catch(() => 0);
  let processed = 0;
  let lastId: string | null = null;
  // Keyset paging rather than one findMany: a course with thousands of enrolments must not load
  // every id into memory, and the worker below reuses this so a run can report its progress.
  for (;;) {
    const batch: Array<{ id: string }> = await db.enrolment.findMany({
      where: { courseId, status: { not: "withdrawn" }, withdrawnAt: null, ...(lastId ? { id: { gt: lastId } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 50,
    }).catch(() => [] as Array<{ id: string }>);
    if (!batch.length) break;
    for (const e of batch) {
      await evaluateEnrolment(e.id, trigger);
      processed++;
    }
    lastId = batch[batch.length - 1].id;
    if (onBatch) await onBatch(processed, total);
  }
  return total || processed;
}
