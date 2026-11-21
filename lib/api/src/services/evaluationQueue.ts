// Round 9 / 3.3 — the course re-evaluation queue.
//
// Before this, an assessment publish or a content change looped over every enrolment of the course
// inside the request: a large course meant a slow request and a timeout, and a second publish
// started a second full pass. A course-wide trigger now writes one `EvaluationJob` row (deduplicated
// per course while it is pending) and a worker started with the server does the work in batches.
//
// [CONFIRM] 2026-11-22: in-process, database-backed, 5-second poll, 50 enrolments per batch. It adds
// no new service to deploy: the row survives a restart and the next worker tick picks it up.
import { db } from "../db.js";
import { evaluateCourseEnrolments, type EnrolmentTrigger } from "./enrolmentOutcome.js";

const POLL_MS = Number(process.env.EVALUATION_WORKER_MS ?? 5000);
const BATCH = 50;

export interface EvaluationJobRow {
  id: string;
  courseId: string;
  trigger: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  processed: number;
  total: number;
  lastError: string | null;
}

/**
 * Ask for a course-wide re-evaluation. Deduplicated: while a run for this course is pending or
 * running, the existing row is returned and no second pass is scheduled.
 */
export async function enqueueCourseEvaluation(courseId: string, trigger: EnrolmentTrigger): Promise<EvaluationJobRow> {
  const existing = await db.evaluationJob.findFirst({
    where: { courseId, status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing as EvaluationJobRow;
  const created = await db.evaluationJob.create({ data: { courseId, trigger, status: "pending" } });
  return created as EvaluationJobRow;
}

/** True while a run for this course has not finished. Drives the staff "recalculating…" note. */
export async function pendingEvaluationJobs(courseId: string): Promise<boolean> {
  const open = await db.evaluationJob.count({ where: { courseId, status: { in: ["pending", "running"] } } });
  return open > 0;
}

export async function evaluationStatusFor(courseId: string): Promise<{ pending: boolean; job: EvaluationJobRow | null }> {
  const job = await db.evaluationJob.findFirst({ where: { courseId }, orderBy: { createdAt: "desc" } });
  const pending = await pendingEvaluationJobs(courseId);
  return { pending, job: (job as EvaluationJobRow) ?? null };
}

/**
 * One pass of the worker: claim the oldest pending job and run it to the end. Claiming flips the
 * row to `running` first, so two ticks cannot process the same course.
 */
export async function runEvaluationWorkerTick(): Promise<number> {
  const next = await db.evaluationJob.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
  if (!next) return 0;
  const claimed = await db.evaluationJob.updateMany({ where: { id: next.id, status: "pending" }, data: { status: "running", startedAt: new Date() } });
  if (!claimed.count) return 0; // another tick took it
  try {
    const total = await db.enrolment.count({ where: { courseId: next.courseId, status: { not: "withdrawn" }, withdrawnAt: null } });
    await db.evaluationJob.update({ where: { id: next.id }, data: { total } });
    // evaluateCourseEnrolments pages with keyset batching (50 at a time) and never throws: a single
    // enrolment that fails is logged there and the pass carries on.
    const processed = await evaluateCourseEnrolments(next.courseId, next.trigger as EnrolmentTrigger);
    await db.evaluationJob.update({
      where: { id: next.id },
      data: { status: "done", finishedAt: new Date(), processed, total: total || processed },
    });
    return 1;
  } catch (err) {
    await db.evaluationJob.update({
      where: { id: next.id },
      data: { status: "failed", finishedAt: new Date(), lastError: String((err as Error)?.message ?? err).slice(0, 4000) },
    }).catch(() => null);
    console.error("[evaluation-queue] job failed", next.id, err);
    return 1;
  }
}

/**
 * Test and operator helper: run the queue until nothing is pending (bounded so a stuck row cannot
 * hang a test run). Every test that triggers a course-wide evaluation calls this before asserting.
 */
export async function drainEvaluationQueue(maxTicks = 200): Promise<{ processed: number; ticks: number }> {
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
