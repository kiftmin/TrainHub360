// Round 9 / 3.3 — the course re-evaluation queue.
//
// Before this, an assessment publish or a content change looped over every enrolment of the course
// inside the request: a large course meant a slow request and a timeout, and a second publish
// started a second full pass. A course-wide trigger now writes one `EvaluationJob` row and a worker
// started with the server does the work in batches.
//
// [CONFIRM] 2026-11-22: in-process, database-backed, 5-second poll, 50 enrolments per batch. It adds
// no new service to deploy: the row survives a restart and the next worker tick picks it up.
//
// Round 10 / Phase 2: a crashed worker can no longer strand a course on "recalculating". Jobs report
// a heartbeat after every batch; a stale running job is reclaimed, and after five attempts it fails
// and is audited. Only pending jobs are deduplicated: a trigger during a running pass queues one
// follow-up pass, which is what "recalculate again" means to the trainer.
//
// [CONFIRM] 2026-11-21: stale timeout defaults to 10 minutes; EVALUATION_STALE_MS overrides it.
import { db } from "../db.js";
import { evaluateCourseEnrolments, type EnrolmentTrigger } from "./enrolmentOutcome.js";

const POLL_MS = Number(process.env.EVALUATION_WORKER_MS ?? 5000);
const BATCH = 50;

export const EVALUATION_STALE_MS = Number(process.env.EVALUATION_STALE_MS ?? 10 * 60 * 1000);
export const EVALUATION_MAX_ATTEMPTS = 5;

export interface EvaluationJobRow {
  id: string;
  courseId: string;
  trigger: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  processed: number;
  total: number;
  attempts: number;
  lastError: string | null;
}

type StalenessFields = Pick<EvaluationJobRow, "createdAt" | "startedAt" | "heartbeatAt">;
type FailureContext = Pick<EvaluationJobRow, "id" | "courseId" | "trigger">;

function errorText(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 4000);
}

function isPendingUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

function isStale(job: StalenessFields, now: Date, staleMs: number): boolean {
  const reference = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
  return reference.getTime() <= now.getTime() - staleMs;
}

async function auditJobFailure(job: FailureContext, attempts: number, reason: string): Promise<void> {
  await db.auditLog.create({
    data: {
      action: "EVALUATION_JOB_FAILED",
      entity: "evaluation_job",
      entityId: job.id,
      details: JSON.stringify({ courseId: job.courseId, trigger: job.trigger, attempts, reason }),
    },
  }).catch(() => null);
}

async function failJob(job: FailureContext, attempts: number, reason: string, finishedAt = new Date()): Promise<boolean> {
  const updated = await db.evaluationJob.updateMany({
    where: { id: job.id, status: "running" },
    data: { status: "failed", finishedAt, attempts, lastError: reason },
  });
  if (updated.count) await auditJobFailure(job, attempts, reason);
  return updated.count > 0;
}

/**
 * Ask for a course-wide re-evaluation. At most one pending row per course exists at a time: a second
 * trigger while one is pending joins it. A running pass is intentionally not a dedupe target — a
 * new publish while one is running means the result must be recalculated once more afterwards.
 */
export async function enqueueCourseEvaluation(courseId: string, trigger: EnrolmentTrigger): Promise<EvaluationJobRow> {
  const pending = await db.evaluationJob.findFirst({
    where: { courseId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (pending) return pending as EvaluationJobRow;
  try {
    const created = await db.evaluationJob.create({ data: { courseId, trigger, status: "pending" } });
    return created as EvaluationJobRow;
  } catch (err) {
    // The filtered unique index is the final guard when two triggers race. The loser reuses the
    // winner's row rather than surfacing a 500 from the publish/content route.
    if (isPendingUniqueViolation(err)) {
      const raced = await db.evaluationJob.findFirst({
        where: { courseId, status: "pending" },
        orderBy: { createdAt: "asc" },
      });
      if (raced) return raced as EvaluationJobRow;
    }
    throw err;
  }
}

/** True while a run for this course has not finished. Drives the staff "recalculating…" note. */
export async function pendingEvaluationJobs(courseId: string): Promise<boolean> {
  const open = await db.evaluationJob.count({ where: { courseId, status: { in: ["pending", "running"] } } });
  return open > 0;
}

export async function evaluationStatusFor(courseId: string): Promise<{
  pending: boolean;
  job: EvaluationJobRow | null;
  attempts: number;
  stale: boolean;
  lastError: string | null;
}> {
  const [job, open, running] = await Promise.all([
    db.evaluationJob.findFirst({ where: { courseId }, orderBy: { createdAt: "desc" } }),
    db.evaluationJob.count({ where: { courseId, status: { in: ["pending", "running"] } } }),
    db.evaluationJob.findFirst({ where: { courseId, status: "running" }, orderBy: { createdAt: "desc" } }),
  ]);
  const now = new Date();
  return {
    pending: open > 0,
    job: (job as EvaluationJobRow) ?? null,
    attempts: job?.attempts ?? 0,
    stale: !!running && isStale(running as EvaluationJobRow, now, EVALUATION_STALE_MS),
    lastError: job?.lastError ?? running?.lastError ?? null,
  };
}

/**
 * Reclaim work abandoned by a dead worker. Called at server start and before every tick. A stale
 * running job returns to pending with attempts + 1 and a `reclaimed after restart` error; the fifth
 * attempt is failed and audited instead of poisoning the queue forever.
 */
export async function reclaimStaleEvaluationJobs(now = new Date(), staleMs = EVALUATION_STALE_MS): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  const stale = await db.evaluationJob.findMany({
    where: {
      status: "running",
      OR: [
        { heartbeatAt: { lt: cutoff } },
        { heartbeatAt: null, startedAt: { lt: cutoff } },
        { heartbeatAt: null, startedAt: null, createdAt: { lt: cutoff } },
      ],
    },
  });
  let reclaimed = 0;
  for (const job of stale) {
    const attempts = job.attempts + 1;
    const failed = attempts >= EVALUATION_MAX_ATTEMPTS;
    try {
      const updated = await db.evaluationJob.updateMany({
        where: { id: job.id, status: "running", attempts: job.attempts, heartbeatAt: job.heartbeatAt },
        data: failed
          ? { status: "failed", finishedAt: now, attempts, lastError: "reclaimed after restart" }
          : { status: "pending", attempts, lastError: "reclaimed after restart", heartbeatAt: null, startedAt: null, finishedAt: null },
      });
      if (!updated.count) continue;
      reclaimed++;
      if (failed) {
        await auditJobFailure(job, attempts, "reclaimed after restart");
      } else {
        console.warn("[evaluation-queue] reclaimed stale job", job.id, "attempt", attempts);
      }
    } catch (err) {
      // A newer trigger may already own the single pending slot. Failing the abandoned job is safe:
      // the newer job still recalculates the same course.
      if (isPendingUniqueViolation(err)) {
        await failJob(job, attempts, "replaced by newer pending job", now);
      } else {
        throw err;
      }
    }
  }
  return reclaimed;
}

/**
 * One pass of the worker: claim the oldest pending job and run it to the end. Claiming flips the
 * row to `running` first, so two ticks cannot process the same course.
 */
export async function runEvaluationWorkerTick(): Promise<number> {
  await reclaimStaleEvaluationJobs();
  const next = await db.evaluationJob.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
  if (!next) return 0;
  const now = new Date();
  const claimed = await db.evaluationJob.updateMany({
    where: { id: next.id, status: "pending" },
    data: { status: "running", startedAt: now, heartbeatAt: now },
  });
  if (!claimed.count) return 0; // another tick took it
  const heartbeat = async (): Promise<void> => {
    await db.evaluationJob.updateMany({ where: { id: next.id, status: "running" }, data: { heartbeatAt: new Date() } });
  };
  try {
    const total = await db.enrolment.count({ where: { courseId: next.courseId, status: { not: "withdrawn" }, withdrawnAt: null } });
    await db.evaluationJob.update({ where: { id: next.id }, data: { total, heartbeatAt: new Date() } });
    // evaluateCourseEnrolments pages with keyset batching (50 at a time) and never throws for one
    // bad enrolment; the heartbeat callback proves to other ticks that this worker is still alive.
    const processed = await evaluateCourseEnrolments(next.courseId, next.trigger as EnrolmentTrigger, heartbeat);
    await db.evaluationJob.update({
      where: { id: next.id, status: "running" },
      data: { status: "done", finishedAt: new Date(), processed, total: total || processed, lastError: null },
    });
    return 1;
  } catch (err) {
    const attempts = next.attempts + 1;
    const reason = errorText(err);
    if (attempts >= EVALUATION_MAX_ATTEMPTS) {
      await failJob(next, attempts, reason);
    } else {
      try {
        await db.evaluationJob.updateMany({
          where: { id: next.id, status: "running" },
          data: { status: "pending", attempts, lastError: reason, heartbeatAt: null, startedAt: null, finishedAt: null },
        });
      } catch (requeueErr) {
        if (isPendingUniqueViolation(requeueErr)) {
          await failJob(next, attempts, `replaced by newer pending job: ${reason}`);
        } else {
          await failJob(next, attempts, errorText(requeueErr));
        }
      }
    }
    console.error("[evaluation-queue] job failed", next.id, err);
    return 1;
  }
}

/**
 * Test and operator helper: run the queue until nothing is pending (bounded so a stuck row cannot
 * hang a test run). Every test that triggers a course-wide evaluation calls this before asserting.
 */
export async function drainEvaluationQueue(maxTicks = 200): Promise<{ processed: number; ticks: number }> {
  await reclaimStaleEvaluationJobs();
  let processed = 0;
  let ticks = 0;
  while (ticks < maxTicks) {
    const waiting = await db.evaluationJob.count({ where: { status: "pending" } });
    if (!waiting) break;
    processed += await runEvaluationWorkerTick();
    ticks++;
  }
  return { processed, ticks };
}

let timer: NodeJS.Timeout | null = null;

/** Start the poller. Called from the server's listen handler; NODE_ENV=test leaves it to the test. */
export function startEvaluationWorker(): void {
  if (timer || process.env.NODE_ENV === "test" || POLL_MS <= 0) return;
  // A restart with a half-finished pass must not wait for a heartbeat to go stale on its own clock.
  void reclaimStaleEvaluationJobs().catch((err) => console.error("[evaluation-queue] reclaim failed", err));
  timer = setInterval(() => {
    runEvaluationWorkerTick().catch((err) => console.error("[evaluation-queue] tick failed", err));
  }, POLL_MS);
  // Do not hold the process open for the poller alone.
  timer.unref?.();
}

export function stopEvaluationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export const EVALUATION_BATCH_SIZE = BATCH;
