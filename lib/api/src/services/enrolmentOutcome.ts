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
    // Round 9 / 2.2: a minor correction carries earlier results forward. The chain is walked back
    // through `supersedesId` while every link was published as "minor"; a version that was a new
    // paper starts the count again. Attempts on the earlier versions are attempts on this one, so
    // they count for `maxAttempts` too.
    const carried: string[] = [a.id];
    let cursor: { id: string; supersedesId: string | null; changeKind: string | null } = a;
    while (cursor.changeKind === "minor" && cursor.supersedesId) {
      const previous = await tx.assessment.findUnique({
        where: { id: cursor.supersedesId },
        select: { id: true, supersededAt: true, version: true, supersedesId: true, changeKind: true },
      });
      if (!previous) break;
      carried.push(previous.id);
      cursor = { ...previous, supersedesId: previous.supersedesId };
    }
    const attempts = await tx.assessmentAttempt.findMany({
      where: {
        assessmentId: { in: carried },
        enrolmentId,
        status: { in: ["submitted", "graded"] },
        percent: { not: null },
      },
      select: { percent: true },
    });
    const best = attempts.length ? Math.max(...attempts.map((x) => x.percent ?? 0)) : null;
    // An attempt in progress on an earlier version still counts against the limit.
    const startedCount = await tx.assessmentAttempt.count({ where: { assessmentId: { in: carried }, enrolmentId } });
    const passMark = a.passMark ?? fallbackPassMark;
    liveApplied.push({ id: a.id, title: a.title, passMark, best, passed: best !== null && best >= passMark, attempts: startedCount, carriedVersions: carried.length - 1 });
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
      const learner = await db.user.findUnique({ where: { id: effect.learnerId }, select: { name: true, managerId: true } }).catch(() => null);
      if (learner?.managerId) {
        await notify(learner.managerId, "manager_signoff_required", {
          title: "Review-credit sign-off needs re-confirming",
          body: `${learner.name}'s score changed after your sign-off, so it must be confirmed again.`,
          link: "/review-credit",
        });
      }
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
      // completion date. Content completion is not a score, so it can still be recorded.
      if (locked) {
        if (contentCompletedAtChanged) {
          await tx.enrolment.update({ where: { id: e.id }, data: { contentCompletedAt: nextContentCompletedAt } }).catch(() => null);
        }
        if (trigger === "attempt_graded") {
          await tx.auditLog.create({
            data: {
              userId: null,
              action: "ASSESSMENT_RESULT_NOT_APPLIED_LOCKED",
              entity: "enrolment",
              entityId: e.id,
              details: JSON.stringify({ trigger, appliedScore: core.appliedScore, liveApplied: core.liveApplied }),
            },
          }).catch(() => null);
          effects.push({ kind: "locked_notice", programmeId: e.programmeId, learnerId: e.learnerId });
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
      let pending: { score: number; at: Date } | null = null;
      if (e.appliedScoreSource === "manual") {
        // Automatic results never silently replace an override: keep them for review.
        if (computed !== (e.appliedAssessmentScore ?? 0)) {
          pending = { score: computed, at: now };
        }
      } else if (computed !== (e.appliedAssessmentScore ?? 0)) {
        appliedScore = computed;
        scoreChanged = true;
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
      const resetSignOff = !!e.managerSignOff && (scoreChanged || pending !== null);

      const completionSource = completed ? (e.completionSource ?? "assessment") : e.completionSource;
      const data: Prisma.EnrolmentUpdateInput = {
        contentCompletedAt: nextContentCompletedAt,
        // Round 9 / 1.2: the automatic loop is the only writer of "assessment", and only for an
        // enrolment it actually completes. A manual override sets "manual" and this leaves it alone.
        completionSource,
        appliedAssessmentScore: appliedScore,
        timelinessScore,
        enrolmentScore,
        status,
        completionDate,
        ...(pending ? { pendingAssessmentScore: pending.score, pendingAssessmentScoreAt: pending.at } : {}),
        ...(resetSignOff ? { managerSignOff: false, managerSignOffBy: null, managerSignOffAt: null } : {}),
      };
      const newlyCompleted = completed && e.status !== "completed";
      await tx.enrolment.update({ where: { id: e.id }, data });

      // Round 9 / 3.1: a sign-off is cleared only when a score input really moved, and the manager
      // is told once, after the commit, not on every evaluation.
      if (resetSignOff) effects.push({ kind: "signoff_reset", learnerId: e.learnerId });

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
        scoreChanged: scoreChanged || pending !== null,
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
export async function evaluateCourseEnrolments(courseId: string, trigger: EnrolmentTrigger): Promise<number> {
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
  }
  return total || processed;
}
