import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { evaluateEnrolment } from "../dist/services/enrolmentOutcome.js";
import {
  EVALUATION_MAX_ATTEMPTS,
  enqueueCourseEvaluation,
  evaluationStatusFor,
  reclaimStaleEvaluationJobs,
  runEvaluationWorkerTick,
} from "../dist/services/evaluationQueue.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Round 10 backend sign-off, assessment, queue, and enrolment rules", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r10-org-${stamp}`,
    programme: `r10-prog-${stamp}`,
    courseA: `r10-course-a-${stamp}`,
    courseB: `r10-course-b-${stamp}`,
    courseQueue: `r10-course-q-${stamp}`,
    moduleA: `r10-module-a-${stamp}`,
    moduleB: `r10-module-b-${stamp}`,
    moduleQueue: `r10-module-q-${stamp}`,
  };
  const users = {};
  const tokens = {};
  const created = {
    evaluationJobs: [],
    attemptAnswers: [],
    attempts: [],
    certificates: [],
    recognitions: [],
    notifications: [],
    enrolments: [],
    questions: [],
    assessments: [],
    modules: [ids.moduleA, ids.moduleB, ids.moduleQueue],
    courses: [ids.courseA, ids.courseB, ids.courseQueue],
    programmes: [ids.programme],
    userRoles: [],
    users: [],
    organizations: [ids.org],
  };

  const authed = async (token, method, p, body) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, body: json };
  };

  const createUser = async (key, email, name) => {
    const user = await prisma.user.create({
      data: { orgId: ids.org, name, email, passwordHash: await hashPassword("pw") },
    });
    users[key] = user;
    created.users.push(user.id);
    return user;
  };

  const grant = async (userId, roleId, programmeId = ids.programme) => {
    const role = await prisma.userRole.create({ data: { userId, roleId, programmeId } });
    created.userRoles.push({ userId: role.userId, roleId: role.roleId });
    return role;
  };

  const tokenFor = (user, role) => signToken({ id: user.id, role, orgId: ids.org, tokenVersion: 0 });

  const createCourse = async (id, title) => {
    await prisma.course.create({ data: { id, programmeId: ids.programme, title, appliedThreshold: 70 } });
  };

  const createModule = async (id, courseId, title) => {
    await prisma.module.create({ data: { id, courseId, title } });
  };

  const createEnrolment = async (data) => {
    const enrolment = await prisma.enrolment.create({ data });
    created.enrolments.push(enrolment.id);
    return enrolment;
  };

  const createAssessment = async (data) => {
    const assessment = await prisma.assessment.create({ data });
    created.assessments.push(assessment.id);
    return assessment;
  };

  const addSingleChoice = async (assessmentId, prompt, correctText = "Right", wrongText = "Wrong", points = 10) => {
    const q = await prisma.question.create({
      data: { assessmentId, kind: "single_choice", prompt, points, order: 0 },
    });
    created.questions.push(q.id);
    await prisma.questionOption.createMany({
      data: [
        { questionId: q.id, text: correctText, isCorrect: true, order: 0 },
        { questionId: q.id, text: wrongText, isCorrect: false, order: 1 },
      ],
    });
    return q;
  };

  const addAppliedEvidence = async (assessmentId, prompt = "Explain") => {
    const q = await prisma.question.create({
      data: { assessmentId, kind: "short_answer", prompt, points: 5, order: 1, rubric: "Names the key step", acceptedAnswers: JSON.stringify(["step"]) },
    });
    created.questions.push(q.id);
    return q;
  };

  const publish = async (assessmentId, body = {}) => authed(tokens.trainer, "POST", `/assessments/${assessmentId}/publish`, body);

  before(async () => {
    if (!requireDatabase("round10-backend.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }

    await seedRoles(prisma, ["owner", "admin", "trainer", "learner"]);
    await prisma.organization.create({ data: { id: ids.org, name: "Round 10 Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "Round 10 Programme", type: "Compliance", owner: "Owner" } });
    await createCourse(ids.courseA, "Round 10 Course A");
    await createCourse(ids.courseB, "Round 10 Course B");
    await createCourse(ids.courseQueue, "Round 10 Queue Course");
    await createModule(ids.moduleA, ids.courseA, "Module A");
    await createModule(ids.moduleB, ids.courseB, "Module B");
    await createModule(ids.moduleQueue, ids.courseQueue, "Module Queue");

    const trainer = await createUser("trainer", `r10-trainer-${stamp}@example.com`, "R10 Trainer");
    const learner = await createUser("learner", `r10-learner-${stamp}@example.com`, "R10 Learner");
    const manager = await createUser("manager", `r10-manager-${stamp}@example.com`, "R10 Manager");
    const admin = await createUser("admin", `r10-admin-${stamp}@example.com`, "R10 Admin");
    await grant(trainer.id, "trainer");
    await grant(learner.id, "learner");
    await grant(manager.id, "learner");
    await grant(admin.id, "admin", null);
    await prisma.user.update({ where: { id: learner.id }, data: { managerId: manager.id } });

    tokens.trainer = tokenFor(trainer, "admin");
    tokens.learner = tokenFor(learner, "learner");
    tokens.manager = tokenFor(manager, "learner");
    tokens.admin = tokenFor(admin, "admin");

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const courseIds = created.courses;
      const moduleIds = created.modules;
      const assessmentIds = await prisma.assessment.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } }).catch(() => []);
      const allAssessmentIds = [...new Set([...created.assessments, ...assessmentIds.map((a) => a.id)])];
      const enrolmentIds = await prisma.enrolment.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } }).catch(() => []);
      const allEnrolmentIds = [...new Set([...created.enrolments, ...enrolmentIds.map((e) => e.id)])];
      const userIds = created.users;

      await prisma.evaluationJob.deleteMany({ where: { courseId: { in: courseIds } } }).catch(() => null);
      await prisma.attemptAnswer.deleteMany({ where: { OR: [{ attempt: { assessmentId: { in: allAssessmentIds } } }, { attempt: { enrolmentId: { in: allEnrolmentIds } } }] } }).catch(() => null);
      await prisma.assessmentAttempt.deleteMany({ where: { OR: [{ assessmentId: { in: allAssessmentIds } }, { enrolmentId: { in: allEnrolmentIds } }, { learnerId: { in: userIds } }] } }).catch(() => null);
      await prisma.certificate.deleteMany({ where: { OR: [{ enrolmentId: { in: allEnrolmentIds } }, { learnerId: { in: userIds } }, { courseId: { in: courseIds } }] } }).catch(() => null);
      await prisma.recognition.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { OR: [{ id: { in: allEnrolmentIds } }, { courseId: { in: courseIds } }, { learnerId: { in: userIds } }] } }).catch(() => null);
      await prisma.questionOption.deleteMany({ where: { question: { assessmentId: { in: allAssessmentIds } } } }).catch(() => null);
      await prisma.question.deleteMany({ where: { assessmentId: { in: allAssessmentIds } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { id: { in: allAssessmentIds } } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: { in: moduleIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: courseIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: created.programmes } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: created.organizations } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("1) score change and attempt start are scoped to one enrolment/course", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const enrolA = await createEnrolment({ learnerId: users.learner.id, courseId: ids.courseA, programmeId: ids.programme, status: "enrolled" });
    const enrolB = await createEnrolment({ learnerId: users.learner.id, courseId: ids.courseB, programmeId: ids.programme, status: "enrolled", appliedAssessmentScore: 42, enrolmentScore: 42 });
    const a1 = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 A1", passMark: 70, isPublished: true, publishedAt: new Date() });
    const q1 = await addSingleChoice(a1.id, "A1 pick", "A-right", "A-wrong", 10);
    await addAppliedEvidence(a1.id, "A1 explain");
    const a2 = await createAssessment({ moduleId: ids.moduleB, type: "applied", title: "R10 B1", passMark: 70, isPublished: true, publishedAt: new Date() });
    await addSingleChoice(a2.id, "B1 pick", "B-right", "B-wrong", 10);
    await addAppliedEvidence(a2.id, "B1 explain");

    const beforeB = await prisma.enrolment.findUnique({ where: { id: enrolB.id } });
    const res = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolA.id}`, { appliedAssessmentScore: 88, reason: "R10 isolated override" });
    assert.equal(res.status, 200);
    const afterA = await prisma.enrolment.findUnique({ where: { id: enrolA.id } });
    const afterB = await prisma.enrolment.findUnique({ where: { id: enrolB.id } });
    assert.equal(afterA.appliedAssessmentScore, 88);
    assert.equal(afterB.appliedAssessmentScore, beforeB.appliedAssessmentScore);
    assert.equal(afterB.enrolmentScore, beforeB.enrolmentScore);

    const started = await authed(tokens.learner, "POST", `/assessments/${a1.id}/attempts`);
    assert.equal(started.status, 201);
    const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: started.body.attemptId } });
    assert.equal(attempt.enrolmentId, enrolA.id);
    assert.equal(attempt.assessmentId, a1.id);
    created.attempts.push(attempt.id);
  });

  test("2) published paper versioning keeps live usable and enforces version rules", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const live = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 Live", passMark: 70, isPublished: false });
    await addSingleChoice(live.id, "Live choice", "Yes", "No", 10);
    await addAppliedEvidence(live.id, "Live explain");
    const pub = await publish(live.id, {});
    assert.equal(pub.status, 200);

    const draft = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 Live v2", passMark: 70, isPublished: false, version: 2, supersedesId: live.id });
    await addSingleChoice(draft.id, "Draft choice", "Yes2", "No2", 10);
    await addAppliedEvidence(draft.id, "Draft explain");
    const pubDraft = await publish(draft.id, { changeKind: "minor" });
    assert.equal(pubDraft.status, 200);

    const versions = await authed(tokens.trainer, "GET", `/courses/${ids.courseA}/assessments`);
    assert.equal(versions.status, 200);
    const listed = versions.body.filter((a) => a.id === live.id || a.id === draft.id);
    assert.equal(listed.length, 2, "staff should see both versions");
    const old = listed.find((a) => a.id === live.id);
    const current = listed.find((a) => a.id === draft.id);
    assert.ok(old.supersededAt, "previous version should be superseded");
    assert.equal(current.isPublished, true);
    assert.equal(current.supersededAt, null);

    const editBlocked = await authed(tokens.trainer, "PATCH", `/assessments/${draft.id}`, { title: "should fail" });
    assert.equal(editBlocked.status, 409);

    const enrolA = await prisma.enrolment.findFirst({ where: { learnerId: users.learner.id, courseId: ids.courseA } });
    const started = await authed(tokens.learner, "POST", `/assessments/${live.id}/attempts`);
    assert.equal(started.status, 403);
    assert.equal(started.body?.superseded, true, JSON.stringify(started.body));
  });

  test("3) draft workflow clones questions, does not overwrite live, and discard removes only draft", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const live = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 Draft Live", passMark: 70, isPublished: false });
    await addSingleChoice(live.id, "Draft-live choice", "Correct", "Wrong", 10);
    await addAppliedEvidence(live.id, "Draft-live explain");
    const pub = await publish(live.id, {});
    assert.equal(pub.status, 200);

    const emptyDraft = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 Empty Draft", passMark: 70, isPublished: false });
    const emptyPublish = await publish(emptyDraft.id, {});
    assert.equal(emptyPublish.status, 400);

    const edit = await authed(tokens.trainer, "PATCH", `/assessments/${live.id}`, { title: "R10 Draft Live edited", confirmNewVersion: true });
    assert.equal(edit.status, 201);
    assert.equal(edit.body.draft, true);
    assert.equal(edit.body.supersedesId, live.id);
    const draftId = edit.body.id;

    const liveAfterDraft = await prisma.assessment.findUnique({ where: { id: live.id } });
    assert.equal(liveAfterDraft.isPublished, true);
    assert.equal(liveAfterDraft.title, "R10 Draft Live");
    assert.equal(liveAfterDraft.supersededAt, null);

    const liveQuestions = await prisma.question.count({ where: { assessmentId: live.id } });
    const draftQuestions = await prisma.question.count({ where: { assessmentId: draftId } });
    assert.equal(draftQuestions, liveQuestions, "draft should clone live questions");

    const publishDraft = await publish(draftId, { changeKind: "minor" });
    assert.equal(publishDraft.status, 200);
    const liveAfterPublish = await prisma.assessment.findUnique({ where: { id: live.id } });
    const draftAfterPublish = await prisma.assessment.findUnique({ where: { id: draftId } });
    assert.ok(liveAfterPublish.supersededAt, "old live should be superseded after draft publish");
    assert.equal(liveAfterPublish.isPublished, false);
    assert.equal(draftAfterPublish.isPublished, true);

    const live2 = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 Discard Live", passMark: 70, isPublished: false });
    await addSingleChoice(live2.id, "Discard choice", "C", "W", 10);
    await addAppliedEvidence(live2.id, "Discard explain");
    assert.equal((await publish(live2.id, {})).status, 200);
    const draft2 = await authed(tokens.trainer, "PATCH", `/assessments/${live2.id}`, { title: "R10 Discard Draft", confirmNewVersion: true });
    assert.equal(draft2.status, 201);
    const discard = await authed(tokens.trainer, "POST", `/assessments/${draft2.body.id}/discard-draft`);
    assert.equal(discard.status, 200);
    const discarded = await prisma.assessment.findUnique({ where: { id: draft2.body.id } });
    const live2After = await prisma.assessment.findUnique({ where: { id: live2.id } });
    assert.equal(discarded, null);
    assert.equal(live2After.isPublished, true);
    assert.equal(live2After.supersededAt, null);
  });

  test("4) review-credit lock holds result until staff accepts or rejects", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const courseId = `r10-lock-course-${stamp}`;
    const moduleId = `r10-lock-module-${stamp}`;
    await prisma.course.create({ data: { id: courseId, programmeId: ids.programme, title: "R10 Lock Course", appliedThreshold: 70 } });
    await prisma.module.create({ data: { id: moduleId, courseId, title: "R10 Lock Module" } });
    created.courses.push(courseId);
    created.modules.push(moduleId);

    const lockedLearner = await createUser("lockedLearner", `r10-locked-${stamp}@example.com`, "R10 Locked Learner");
    await grant(lockedLearner.id, "learner");
    const rejectLearner = await createUser("rejectLearner", `r10-reject-${stamp}@example.com`, "R10 Reject Learner");
    await grant(rejectLearner.id, "learner");

    const assessment = await createAssessment({ moduleId, type: "applied", title: "R10 Lock Assessment", passMark: 70, isPublished: true, publishedAt: new Date() });
    await addSingleChoice(assessment.id, "Lock choice", "Right", "Wrong", 10);
    await addAppliedEvidence(assessment.id, "Lock explain");

    const lockedEnrolment = await createEnrolment({
      learnerId: lockedLearner.id,
      courseId,
      programmeId: ids.programme,
      status: "enrolled",
      appliedAssessmentScore: 40,
      enrolmentScore: 40,
      reviewCreditLockedAt: new Date(),
    });
    const attempt = await prisma.assessmentAttempt.create({
      data: { assessmentId: assessment.id, enrolmentId: lockedEnrolment.id, learnerId: lockedLearner.id, status: "graded", score: 9, maxScore: 10, percent: 90, passed: true, gradedAt: new Date() },
    });
    created.attempts.push(attempt.id);

    await evaluateEnrolment(lockedEnrolment.id, "attempt_graded", { attemptId: attempt.id });
    const afterEval = await prisma.enrolment.findUnique({ where: { id: lockedEnrolment.id } });
    assert.equal(afterEval.appliedAssessmentScore, 40, "locked review credit must keep applied score");
    assert.equal(afterEval.pendingAssessmentScore, 90, "graded attempt should be held pending");

    const list = await authed(tokens.trainer, "GET", `/enrolments`);
    assert.equal(list.status, 200);
    const listed = list.body.find((e) => e.id === lockedEnrolment.id);
    assert.ok(listed, "staff enrolment list should include held enrolment");
    assert.equal(listed.pendingAssessmentScore, 90);

    const accepted = await authed(tokens.trainer, "POST", `/enrolments/${lockedEnrolment.id}/accept-assessment-score`);
    assert.equal(accepted.status, 200);
    const afterAccept = await prisma.enrolment.findUnique({ where: { id: lockedEnrolment.id } });
    assert.equal(afterAccept.appliedAssessmentScore, 90);
    assert.equal(afterAccept.pendingAssessmentScore, null);
    const acceptAudit = await prisma.auditLog.findFirst({ where: { entityId: lockedEnrolment.id, action: "ASSESSMENT_SCORE_ACCEPTED" } });
    assert.ok(acceptAudit, "accept should write audit");

    const rejectEnrolment = await createEnrolment({
      learnerId: rejectLearner.id, courseId, programmeId: ids.programme, status: "enrolled", appliedAssessmentScore: 55, enrolmentScore: 55, reviewCreditLockedAt: new Date(),
    });
    const rejectAttempt = await prisma.assessmentAttempt.create({
      data: { assessmentId: assessment.id, enrolmentId: rejectEnrolment.id, learnerId: rejectLearner.id, status: "graded", score: 8, maxScore: 10, percent: 80, passed: true, gradedAt: new Date() },
    });
    created.attempts.push(rejectAttempt.id);
    await evaluateEnrolment(rejectEnrolment.id, "attempt_graded", { attemptId: rejectAttempt.id });
    const rejected = await authed(tokens.trainer, "POST", `/enrolments/${rejectEnrolment.id}/reject-assessment-score`);
    assert.equal(rejected.status, 200);
    const afterReject = await prisma.enrolment.findUnique({ where: { id: rejectEnrolment.id } });
    assert.equal(afterReject.appliedAssessmentScore, 55);
    assert.equal(afterReject.pendingAssessmentScore, null);
    assert.equal(afterReject.pendingRejectedScore, 80);
  });

  test("5) learner cannot see answer keys; staff can; published question edit requires new version", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const assessment = await createAssessment({ moduleId: ids.moduleA, type: "applied", title: "R10 Key Hide", passMark: 70, isPublished: false });
    const q = await addSingleChoice(assessment.id, "Key hide choice", "Right", "Wrong", 10);
    await addAppliedEvidence(assessment.id, "Key hide explain");
    assert.equal((await publish(assessment.id, {})).status, 200);

    const started = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`);
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId;
    created.attempts.push(attemptId);
    const question = started.body.questions.find((x) => x.kind === "single_choice");
    assert.ok(question, "choice question returned");
    assert.equal(Object.prototype.hasOwnProperty.call(question, "rubric"), false);
    for (const opt of question.options) {
      assert.equal(Object.prototype.hasOwnProperty.call(opt, "isCorrect"), false);
    }

    const learnerAnswers = await authed(tokens.learner, "GET", `/attempts/${attemptId}/answers`);
    assert.equal(learnerAnswers.status, 403);

    const staffAnswers = await authed(tokens.trainer, "GET", `/attempts/${attemptId}/answers`);
    assert.equal(staffAnswers.status, 200);
    const staffChoice = staffAnswers.body.questions.find((x) => x.id === q.id);
    assert.ok(staffChoice, "staff should see question");
    assert.equal(typeof staffChoice.rubric === "string" || staffChoice.rubric === null, true);
    assert.ok(staffChoice.options.some((o) => o.isCorrect === true), "staff should see isCorrect");

    const edit = await authed(tokens.trainer, "PATCH", `/questions/${q.id}?programmeId=${ids.programme}`, { prompt: "Changed prompt", kind: "single_choice", points: 10 });
    assert.equal(edit.status, 409, JSON.stringify(edit.body));
    assert.equal(edit.body.requiresNewVersion === true || edit.body.code === "published", true, JSON.stringify(edit.body));
  });

  test("6) evaluation queue dedupes, is single-claimed, reclaims stale, and fails at max attempts", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const courseId = ids.courseQueue;
    await prisma.evaluationJob.deleteMany({ where: { courseId } });

    const running = await prisma.evaluationJob.create({ data: { courseId, trigger: "assessment_published", status: "running", startedAt: new Date(), heartbeatAt: new Date(), attempts: 0 } });
    created.evaluationJobs.push(running.id);
    const first = await enqueueCourseEvaluation(courseId, "content_changed");
    const second = await enqueueCourseEvaluation(courseId, "content_changed");
    assert.notEqual(first.id, running.id);
    assert.equal(first.id, second.id, "pending follow-up should be deduped");
    const pendingCount = await prisma.evaluationJob.count({ where: { courseId, status: "pending" } });
    assert.equal(pendingCount, 1);

    await prisma.evaluationJob.deleteMany({ where: { courseId } });
    const pending = await prisma.evaluationJob.create({ data: { courseId, trigger: "content_changed", status: "pending", attempts: 0 } });
    created.evaluationJobs.push(pending.id);
    const [tickA, tickB] = await Promise.all([runEvaluationWorkerTick(), runEvaluationWorkerTick()]);
    assert.ok(tickA + tickB >= 1, "at least one worker tick should claim a job");
    for (let i = 0; i < 5; i++) {
      const j = await prisma.evaluationJob.findUnique({ where: { id: pending.id } });
      if (j.status !== "pending") break;
      await runEvaluationWorkerTick();
    }
    const done = await prisma.evaluationJob.findUnique({ where: { id: pending.id } });
    assert.equal(done.status, "done", `job ended as ${done.status} attempts=${done.attempts} lastError=${done.lastError}`);

    await prisma.evaluationJob.deleteMany({ where: { courseId } });
    const stale = await prisma.evaluationJob.create({
      data: { courseId, trigger: "content_changed", status: "running", attempts: 0, startedAt: new Date(Date.now() - 60_000), heartbeatAt: new Date(Date.now() - 60_000) },
    });
    created.evaluationJobs.push(stale.id);
    const reclaimed = await reclaimStaleEvaluationJobs(new Date(), 1_000);
    assert.equal(reclaimed, 1);
    const reclaimedJob = await prisma.evaluationJob.findUnique({ where: { id: stale.id } });
    assert.equal(reclaimedJob.status, "pending");
    assert.equal(reclaimedJob.attempts, 1);
    assert.equal(reclaimedJob.lastError, "reclaimed after restart");
    const status = await evaluationStatusFor(courseId);
    assert.equal(status.stale, false);
    assert.equal(status.pending, true);

    await prisma.evaluationJob.deleteMany({ where: { courseId } });
    const failing = await prisma.evaluationJob.create({
      data: { courseId, trigger: "content_changed", status: "running", attempts: EVALUATION_MAX_ATTEMPTS - 1, startedAt: new Date(Date.now() - 60_000), heartbeatAt: new Date(Date.now() - 60_000) },
    });
    created.evaluationJobs.push(failing.id);
    const reclaimedFail = await reclaimStaleEvaluationJobs(new Date(), 1_000);
    assert.equal(reclaimedFail, 1);
    const failedJob = await prisma.evaluationJob.findUnique({ where: { id: failing.id } });
    assert.equal(failedJob.status, "failed");
    assert.equal(failedJob.attempts, EVALUATION_MAX_ATTEMPTS);
    assert.equal(failedJob.lastError, "reclaimed after restart");
    const failAudit = await prisma.auditLog.findFirst({ where: { entityId: failing.id, action: "EVALUATION_JOB_FAILED" } });
    assert.ok(failAudit, "max-attempt reclaim should audit failure");

    const afterFail = await enqueueCourseEvaluation(courseId, "assessment_published");
    assert.equal(afterFail.status, "pending");
    assert.notEqual(afterFail.id, failing.id);
  });

  test("7) sign-off is preserved on lower automatic pending result, cleared on accept, preserved on reject", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const courseId = `r10-signoff-course-${stamp}`;
    const moduleId = `r10-signoff-module-${stamp}`;
    await prisma.course.create({ data: { id: courseId, programmeId: ids.programme, title: "R10 Signoff Course", appliedThreshold: 70 } });
    await prisma.module.create({ data: { id: moduleId, courseId, title: "R10 Signoff Module" } });
    created.courses.push(courseId);
    created.modules.push(moduleId);

    const learner = await createUser("signoffLearner", `r10-signoff-${stamp}@example.com`, "R10 Signoff Learner");
    await grant(learner.id, "learner");
    await prisma.user.update({ where: { id: learner.id }, data: { managerId: users.manager.id } });

    const enrolment = await createEnrolment({
      learnerId: learner.id, courseId, programmeId: ids.programme, status: "enrolled",
      appliedScoreSource: "manual", appliedAssessmentScore: 50, enrolmentScore: 50,
      managerSignOff: true, managerSignOffBy: users.manager.id, managerSignOffAt: new Date("2026-01-01T00:00:00Z"),
    });

    const assessment = await createAssessment({ moduleId, type: "applied", title: "R10 Signoff Assessment", passMark: 70, isPublished: true, publishedAt: new Date() });
    await addSingleChoice(assessment.id, "Signoff choice", "Right", "Wrong", 10);
    await addAppliedEvidence(assessment.id, "Signoff explain");

    const lowerAttempt = await prisma.assessmentAttempt.create({
      data: { assessmentId: assessment.id, enrolmentId: enrolment.id, learnerId: learner.id, status: "graded", score: 4, maxScore: 10, percent: 40, passed: false, gradedAt: new Date() },
    });
    created.attempts.push(lowerAttempt.id);
    await evaluateEnrolment(enrolment.id, "attempt_graded", { attemptId: lowerAttempt.id });
    const afterLower = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(afterLower.pendingAssessmentScore, 40);
    assert.equal(afterLower.appliedAssessmentScore, 50);
    assert.equal(afterLower.managerSignOff, true, "lower automatic result must not clear sign-off");

    const accepted = await authed(tokens.trainer, "POST", `/enrolments/${enrolment.id}/accept-assessment-score`);
    assert.equal(accepted.status, 200);
    const afterAccept = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(afterAccept.appliedAssessmentScore, 40);
    assert.equal(afterAccept.managerSignOff, false, "accepting changed score should clear sign-off");
    const managerNotice = await prisma.notification.findFirst({
      where: { userId: users.manager.id, type: "manager_signoff_required", createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(managerNotice, "line manager should be notified after sign-off cleared by accept");

    await prisma.enrolment.update({
      where: { id: enrolment.id },
      data: { appliedScoreSource: "manual", appliedAssessmentScore: 50, enrolmentScore: 50, managerSignOff: true, managerSignOffBy: users.manager.id, managerSignOffAt: new Date("2026-01-02T00:00:00Z"), pendingAssessmentScore: null, pendingAssessmentScoreAt: null, pendingRejectedScore: null },
    });
    await prisma.assessmentAttempt.deleteMany({ where: { enrolmentId: enrolment.id } });
    const rejectAttempt = await prisma.assessmentAttempt.create({
      data: { assessmentId: assessment.id, enrolmentId: enrolment.id, learnerId: learner.id, status: "graded", score: 3, maxScore: 10, percent: 30, passed: false, gradedAt: new Date() },
    });
    created.attempts.push(rejectAttempt.id);
    await evaluateEnrolment(enrolment.id, "attempt_graded", { attemptId: rejectAttempt.id });
    const beforeReject = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(beforeReject.pendingAssessmentScore, 30);
    const rejected = await authed(tokens.trainer, "POST", `/enrolments/${enrolment.id}/reject-assessment-score`);
    assert.equal(rejected.status, 200);
    const afterReject = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(afterReject.pendingAssessmentScore, null);
    assert.equal(afterReject.pendingRejectedScore, 30);
    assert.equal(afterReject.appliedAssessmentScore, 50);
    assert.equal(afterReject.managerSignOff, true, "rejecting pending result must not clear sign-off");
  });
});
