// Phase 4 — grading and the outcome pipeline.
//
// The rule this file exists to enforce: a score is never taken from the client. Objective
// questions are graded here against the stored answer key, anything with a scenario or short
// answer waits for a person in the review queue, and the effects of a result (enrolment score,
// competence, certificate, recognitions) are applied from the attempt that produced it.
import { db } from "../db.js";

// Kinds that can be marked objectively. Everything else needs a rubric and a grader.
export const OBJECTIVE_KINDS = ["single_choice", "multi_choice", "true_false"] as const;
export const MANUAL_KINDS = ["short_answer", "scenario"] as const;
export const QUESTION_KINDS = [...OBJECTIVE_KINDS, ...MANUAL_KINDS] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export function isObjective(kind: string): boolean {
  return (OBJECTIVE_KINDS as readonly string[]).includes(kind);
}

export function isManual(kind: string): boolean {
  return (MANUAL_KINDS as readonly string[]).includes(kind);
}

// A recall assessment may only carry objective questions: it exists to check that someone
// remembers, and that has one right answer. An applied assessment must carry at least one
// scenario or short answer, because "can they apply it" cannot be shown by selection alone.
// Publishing enforces both, so a published assessment always means what its type says.
export function publishProblem(type: string, kinds: string[]): string | null {
  if (!kinds.length) return "add at least one question before publishing";
  const unknown = kinds.filter((k) => !(QUESTION_KINDS as readonly string[]).includes(k));
  if (unknown.length) return `unknown question kind: ${unknown.join(", ")}`;
  if (type === "applied") {
    if (!kinds.some((k) => isManual(k))) {
      return "an applied assessment needs at least one scenario or short answer question; choice questions cannot show application";
    }
    return null;
  }
  const manual = kinds.filter((k) => isManual(k));
  if (manual.length) return `a recall assessment may only contain objective questions, but has ${manual.join(", ")}`;
  return null;
}

export type StoredAnswer = { questionId: string; optionIds?: string[]; text?: string };

// Objective grading: all of the correct options and none of the wrong ones. A single-choice or
// true/false question answers only when exactly one option is selected, so a client that sends
// several cannot get a mark by accident.
export function gradeObjective(
  kind: string,
  points: number,
  correctIds: string[],
  selected: string[],
): { points: number; correct: boolean } {
  if (kind === "single_choice" || kind === "true_false") {
    if (selected.length !== 1) return { points: 0, correct: false };
  }
  const correct = new Set(correctIds);
  const chosen = new Set(selected);
  const same = correct.size === chosen.size && [...correct].every((id) => chosen.has(id));
  return { points: same ? points : 0, correct: same };
}

export function percentOf(earned: number, total: number): number {
  return total > 0 ? Math.round((earned / total) * 1000) / 10 : 0;
}

// The pass mark of an assessment, falling back the way the proposal describes: an applied
// assessment with no pass mark of its own uses the course's applied threshold.
export function passMarkFor(assessment: { passMark: number | null; type: string }, course: { appliedThreshold: number | null }): number {
  if (assessment.passMark !== null && assessment.passMark !== undefined) return assessment.passMark;
  if (assessment.type === "applied" && course.appliedThreshold !== null && course.appliedThreshold !== undefined) return course.appliedThreshold;
  return 70;
}

/**
 * Apply a graded attempt to everything downstream of it. The rules live in
 * `evaluateEnrolment` (round 8 / phase 1): the standing applied score is the average of each
 * live applied assessment's best graded result, a locked review-credit period never moves, and a
 * manual override is never silently replaced. Only a graded attempt counts; one still waiting in
 * the queue changes nothing.
 */
export async function applyAttemptOutcome(attemptId: string): Promise<{
  competenceMet: boolean;
  appliedScore: number | null;
  certificateIssued: boolean;
  enrolmentId: string;
  courseId: string;
}> {
  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { assessment: { include: { module: { include: { course: true } } } } },
  });
  if (!attempt) throw Object.assign(new Error("attempt not found"), { status: 404 });
  const enrolmentId = attempt.enrolmentId;
  const courseId = attempt.assessment.module.courseId;
  if (attempt.status !== "graded") {
    return { competenceMet: false, appliedScore: null, certificateIssued: false, enrolmentId, courseId };
  }
  const { evaluateEnrolment } = await import("./enrolmentOutcome.js");
  const outcome = await evaluateEnrolment(enrolmentId, "attempt_graded", { attemptId });
  return {
    competenceMet: outcome.competent,
    appliedScore: outcome.appliedScore,
    certificateIssued: outcome.certificateIssued,
    enrolmentId,
    courseId,
  };
}

// Does this attempt still need a person? True when any question is a scenario or short answer and
// the attempt has answers to grade.
export function needsManualGrading(kinds: string[]): boolean {
  return kinds.some((k) => isManual(k));
}

/**
 * Save the answers a learner sends while an attempt is in progress. Objective answers become
 * `optionIds`, scenario and short answers become `answer` text. Nothing is graded here: a learner
 * must not be able to tell whether an answer was right before submitting.
 */
export async function saveAnswers(
  attemptId: string,
  questions: Array<{ id: string; kind: string; options: Array<{ id: string }> }>,
  answers: Array<{ questionId?: unknown; optionIds?: unknown; text?: unknown }>,
): Promise<number> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let saved = 0;
  for (const answer of answers) {
    const question = byId.get(String(answer?.questionId ?? ""));
    if (!question) continue;
    const valid = new Set(question.options.map((o) => o.id));
    const selected = isObjective(question.kind)
      ? [...new Set((Array.isArray(answer.optionIds) ? answer.optionIds : []).map(String))].filter((id) => valid.has(id))
      : [];
    const text = isManual(question.kind) ? String(answer.text ?? "").slice(0, 20000) : null;
    if (!selected.length && !text) continue;
    await db.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: question.id } },
      create: {
        attemptId,
        questionId: question.id,
        optionIds: selected.length ? JSON.stringify(selected) : null,
        answer: text,
      },
      update: {
        optionIds: selected.length ? JSON.stringify(selected) : null,
        answer: text,
        // A saved answer is not graded yet; clearing the mark keeps the queue honest.
        pointsAwarded: null,
        autoGraded: false,
      },
    });
    saved++;
  }
  return saved;
}

export function parseOptionIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
