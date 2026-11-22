import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { applyAttemptOutcome } from "../dist/services/assessment.js";
import { enqueueCourseEvaluation } from "../dist/services/evaluationQueue.js";
import { evaluateEnrolment } from "../dist/services/enrolmentOutcome.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Round 11 review — grading, evaluation queue, and certificate edge cases", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r11e-org-${stamp}`,
    otherOrg: `r11e-other-org-${stamp}`,
    programmeA: `r11e-prog-a-${stamp}`,
    programmeB: `r11e-prog-b-${stamp}`,
    otherProgramme: `r11e-other-prog-${stamp}`,
    courseA: `r11e-course-a-${stamp}`,
    courseB: `r11e-course-b-${stamp}`,
    queueCourseA: `r11e-queue-a-${stamp}`,
    queueCourseB: `r11e-queue-b-${stamp}`,
    otherCourse: `r11e-other-course-${stamp}`,
    moduleA: `r11e-module-a-${stamp}`,
    moduleB: `r11e-module-b-${stamp}`,
    otherModule: `r11e-other-module-${stamp}`,
  };
  const users = {};
  const tokens = {};
  let enrolments;
  let assessment;
  let gradingAssessment;
  let statusJob;
  let runningJob;

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

  const tokenFor = (user, role) => signToken({ id: user.id, role, orgId: user.orgId, tokenVersion: 0 });

  const createObjectiveAssessment = async (moduleId, over = {}) => {
    const row = await prisma.assessment.create({
      data: {
        moduleId,
        type: "applied",
        title: `R11E objective ${stamp}`,
        passMark: 80,
        isPublished: true,
        publishedAt: new Date(),
        ...over,
      },
    });
    const question = await prisma.question.create({
      data: { assessmentId: row.id, kind: "single_choice", prompt: "Pick one", points: 10, order: 0 },
    });
    await prisma.questionOption.create({ data: { questionId: question.id, text: "Right", isCorrect: true, order: 0 } });
    await prisma.questionOption.create({ data: { questionId: question.id, text: "Wrong", isCorrect: false, order: 1 } });
    return row;
  };

  const createManualAssessment = async (moduleId, over = {}) => {
    const row = await prisma.assessment.create({
      data: {
        moduleId,
        type: "applied",
        title: `R11E manual ${stamp}`,
        passMark: 80,
        isPublished: false,
        publishedAt: null,
        ...over,
      },
    });
    const question = await prisma.question.create({
      data: { assessmentId: row.id, kind: "scenario", prompt: "Explain the step", points: 10, order: 0, rubric: "Names the step" },
    });
    return { assessment: row, question };
  };

  const createAttempt = async (assessmentId, enrolmentId, learnerId, over = {}) => prisma.assessmentAttempt.create({
    data: {
      assessmentId,
      enrolmentId,
      learnerId,
      attemptNumber: 1,
      startedAt: new Date(),
      status: "in_progress",
      ...over,
    },
  });

  const patchEnrolment = (enrolmentId, body) => authed(tokens.orgOwner, "PATCH", `/enrolments/${enrolmentId}`, body);

  before(async () => {
    if (!requireDatabase("round11-edge-cases.test.js")) return;
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
    await prisma.$executeRawUnsafe(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_evaluation_jobs_one_pending_per_course' AND object_id = OBJECT_ID('dbo.evaluation_jobs'))
        CREATE UNIQUE INDEX UX_evaluation_jobs_one_pending_per_course ON dbo.evaluation_jobs (course_id) WHERE status = 'pending'
    `);

    const passwordHash = await hashPassword("pw");
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner"]);
    await prisma.organization.createMany({
      data: [
        { id: ids.org, name: "R11E Org" },
        { id: ids.otherOrg, name: "R11E Other Org" },
      ],
    });
    await prisma.programme.createMany({
      data: [
        { id: ids.programmeA, orgId: ids.org, name: "R11E Programme A", type: "Compliance", owner: "owner" },
        { id: ids.programmeB, orgId: ids.org, name: "R11E Programme B", type: "Test", owner: "owner" },
        { id: ids.otherProgramme, orgId: ids.otherOrg, name: "R11E Other Programme", type: "Test", owner: "owner" },
      ],
    });
    await prisma.course.createMany({
      data: [
        { id: ids.courseA, programmeId: ids.programmeA, title: "R11E Compliance", category: "compliance", validityMonths: 12, appliedThreshold: 70 },
        { id: ids.courseB, programmeId: ids.programmeB, title: "R11E Plain", appliedThreshold: 70 },
        { id: ids.queueCourseA, programmeId: ids.programmeA, title: "R11E Queue A", appliedThreshold: 70 },
        { id: ids.queueCourseB, programmeId: ids.programmeA, title: "R11E Queue B", appliedThreshold: 70 },
        { id: ids.otherCourse, programmeId: ids.otherProgramme, title: "R11E Other", appliedThreshold: 70 },
      ],
    });
    await prisma.module.createMany({
      data: [
        { id: ids.moduleA, courseId: ids.courseA, title: "Module A" },
        { id: ids.moduleB, courseId: ids.courseB, title: "Module B" },
        { id: ids.otherModule, courseId: ids.otherCourse, title: "Other Module" },
      ],
    });

    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "R11E Learner", email: `r11e-learner-${stamp}@example.com`, passwordHash } });
    const trainer = await prisma.user.create({ data: { orgId: ids.org, name: "R11E Trainer", email: `r11e-trainer-${stamp}@example.com`, passwordHash } });
    const trainerB = await prisma.user.create({ data: { orgId: ids.org, name: "R11E Trainer B", email: `r11e-trainer-b-${stamp}@example.com`, passwordHash } });
    const staleTrainer = await prisma.user.create({ data: { orgId: ids.org, name: "R11E Stale Trainer", email: `r11e-stale-${stamp}@example.com`, passwordHash } });
    const orgAdmin = await prisma.user.create({ data: { orgId: ids.org, name: "R11E Org Admin", email: `r11e-admin-${stamp}@example.com`, passwordHash } });
    const orgOwner = await prisma.user.create({ data: { orgId: ids.org, name: "R11E Org Owner", email: `r11e-owner-${stamp}@example.com`, passwordHash } });
    const outsider = await prisma.user.create({ data: { orgId: ids.otherOrg, name: "R11E Outsider", email: `r11e-outsider-${stamp}@example.com`, passwordHash } });
    Object.assign(users, { learner, trainer, trainerB, staleTrainer, orgAdmin, orgOwner, outsider });

    const grants = [];
    for (const data of [
      { userId: learner.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: trainer.id, roleId: "trainer", programmeId: ids.programmeA },
      { userId: trainerB.id, roleId: "trainer", programmeId: ids.programmeB },
      { userId: staleTrainer.id, roleId: "trainer", programmeId: ids.programmeA },
      { userId: orgAdmin.id, roleId: "admin", programmeId: null },
      { userId: orgOwner.id, roleId: "owner", programmeId: null },
      { userId: outsider.id, roleId: "admin", programmeId: null },
    ]) {
      grants.push(await prisma.userRole.create({ data }));
    }
    const staleGrant = grants.find((grant) => grant.userId === staleTrainer.id);
    await prisma.userRole.delete({ where: { id: staleGrant.id } });

    enrolments = {
      certificate: await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" } }),
      repeat: await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" } }),
      manual: await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" } }),
      grading: await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" } }),
    };
    const content = await prisma.contentItem.create({
      data: { orgId: ids.org, moduleId: ids.moduleA, type: "text", title: "R11E required content", required: true },
    });
    await prisma.contentProgress.createMany({
      data: [enrolments.certificate.id, enrolments.repeat.id].map((enrolmentId) => ({
        enrolmentId,
        contentItemId: content.id,
        status: "completed",
        completedAt: new Date(),
      })),
    });

    assessment = await createObjectiveAssessment(ids.moduleA);
    const manual = await createManualAssessment(ids.moduleA);
    gradingAssessment = manual;

    statusJob = await prisma.evaluationJob.create({ data: { courseId: ids.courseA, trigger: "assessment_published", status: "pending" } });
    runningJob = await prisma.evaluationJob.create({
      data: { courseId: ids.queueCourseA, trigger: "content_changed", status: "running", attempts: 1, startedAt: new Date(), heartbeatAt: new Date() },
    });

    tokens.learner = tokenFor(learner, "learner");
    tokens.trainer = tokenFor(trainer, "trainer");
    tokens.trainerB = tokenFor(trainerB, "trainer");
    tokens.staleTrainer = tokenFor(staleTrainer, "trainer");
    tokens.orgAdmin = tokenFor(orgAdmin, "admin");
    tokens.orgOwner = tokenFor(orgOwner, "owner");
    tokens.outsider = tokenFor(outsider, "admin");

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const courseIds = [ids.courseA, ids.courseB, ids.queueCourseA, ids.queueCourseB, ids.otherCourse];
      const moduleIds = [ids.moduleA, ids.moduleB, ids.otherModule];
      const userIds = Object.values(users).map((user) => user.id);
      const assessmentIds = (await prisma.assessment.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } })).map((row) => row.id);
      const enrolmentIds = (await prisma.enrolment.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })).map((row) => row.id);
      const attemptIds = (await prisma.assessmentAttempt.findMany({ where: { enrolmentId: { in: enrolmentIds } }, select: { id: true } })).map((row) => row.id);
      const jobIds = (await prisma.evaluationJob.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })).map((row) => row.id);
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [...enrolmentIds, ...attemptIds, ...jobIds] } } }).catch(() => null);
      await prisma.evaluationJob.deleteMany({ where: { courseId: { in: courseIds } } }).catch(() => null);
      await prisma.attemptAnswer.deleteMany({ where: { attempt: { enrolmentId: { in: enrolmentIds } } } }).catch(() => null);
      await prisma.assessmentAttempt.deleteMany({ where: { enrolmentId: { in: enrolmentIds } } }).catch(() => null);
      await prisma.certificate.deleteMany({ where: { enrolmentId: { in: enrolmentIds } } }).catch(() => null);
      await prisma.recognition.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.contentProgress.deleteMany({ where: { enrolmentId: { in: enrolmentIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { id: { in: enrolmentIds } } }).catch(() => null);
      await prisma.questionOption.deleteMany({ where: { question: { assessmentId: { in: assessmentIds } } } }).catch(() => null);
      await prisma.question.deleteMany({ where: { assessmentId: { in: assessmentIds } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } }).catch(() => null);
      await prisma.contentItem.deleteMany({ where: { moduleId: { in: moduleIds } } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: { in: moduleIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: courseIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programmeA, ids.programmeB, ids.otherProgramme] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("two triggers that complete the same enrolment issue exactly one certificate", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const attempt = await createAttempt(assessment.id, enrolments.certificate.id, users.learner.id, {
      status: "graded", score: 100, percent: 100, passed: true, gradedAt: new Date(),
    });
    const [first, second] = await Promise.all([
      evaluateEnrolment(enrolments.certificate.id, "content_progress", { attemptId: attempt.id }),
      evaluateEnrolment(enrolments.certificate.id, "attempt_graded", { attemptId: attempt.id }),
    ]);
    assert.equal(first.completed, true);
    assert.equal(second.completed, true);
    assert.equal(Number(first.certificateIssued) + Number(second.certificateIssued), 1);
    const repeated = await evaluateEnrolment(enrolments.certificate.id, "manual_status", { attemptId: attempt.id });
    assert.equal(repeated.certificateIssued, false);
    assert.equal(repeated.newlyCompleted, false);
    const certificates = await prisma.certificate.findMany({ where: { enrolmentId: enrolments.certificate.id } });
    assert.equal(certificates.length, 1);
    assert.equal(certificates[0].status, "active");
    assert.equal(certificates[0].attemptId, attempt.id);
  });

  test("an uncomplete/re-complete cycle revokes once and issues one fresh certificate", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const completed = await patchEnrolment(enrolments.manual.id, { status: "completed", reason: "Initial manual completion" });
    assert.equal(completed.status, 200);
    const initial = await prisma.certificate.findFirst({ where: { enrolmentId: enrolments.manual.id, status: "active" } });
    assert.ok(initial);

    const uncompleted = await patchEnrolment(enrolments.manual.id, { status: "enrolled", reason: "Evidence was overturned on review" });
    assert.equal(uncompleted.status, 200);
    const revoked = await prisma.certificate.findUnique({ where: { id: initial.id } });
    assert.equal(revoked?.status, "revoked");
    assert.equal(await prisma.certificate.count({ where: { enrolmentId: enrolments.manual.id, status: "active" } }), 0);
    const row = await prisma.enrolment.findUnique({ where: { id: enrolments.manual.id } });
    assert.equal(row?.completionDate, null);
    assert.equal(row?.completionSource, null);
    const revokeAudits = await prisma.auditLog.count({ where: { entity: "enrolment", entityId: enrolments.manual.id, action: "CERTIFICATE_REVOKED" } });
    assert.equal(revokeAudits, 1);

    const again = await patchEnrolment(enrolments.manual.id, { status: "enrolled", reason: "Confirming the un-completion" });
    assert.equal(again.status, 200);
    assert.equal(await prisma.auditLog.count({ where: { entity: "enrolment", entityId: enrolments.manual.id, action: "CERTIFICATE_REVOKED" } }), 1);

    const reissued = await patchEnrolment(enrolments.manual.id, { status: "completed", reason: "Fresh evidence accepted after appeal" });
    assert.equal(reissued.status, 200);
    const active = await prisma.certificate.findMany({ where: { enrolmentId: enrolments.manual.id, status: "active" } });
    assert.equal(active.length, 1);
    assert.notEqual(active[0].id, initial.id);
    assert.equal(active[0].attemptId, null);
    assert.equal(await prisma.certificate.count({ where: { enrolmentId: enrolments.manual.id } }), 2);
  });

  test("manual grading checks the live programme grant rather than the token role", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const attempt = await createAttempt(gradingAssessment.assessment.id, enrolments.grading.id, users.learner.id, { status: "grading" });
    await prisma.attemptAnswer.create({ data: { attemptId: attempt.id, questionId: gradingAssessment.question.id, answer: "step" } });
    const body = { grades: [{ answerId: (await prisma.attemptAnswer.findFirst({ where: { attemptId: attempt.id } })).id, points: 10 }] };

    const stale = await authed(tokens.staleTrainer, "POST", `/attempts/${attempt.id}/grade`, body);
    assert.equal(stale.status, 403);
    assert.match(stale.body.error, /forbidden for this programme/);
    const orgOnly = await authed(tokens.orgAdmin, "POST", `/attempts/${attempt.id}/grade`, body);
    assert.equal(orgOnly.status, 403);
    assert.match(orgOnly.body.error, /forbidden for this programme/);
    const answers = await authed(tokens.staleTrainer, "GET", `/attempts/${attempt.id}/answers`);
    assert.equal(answers.status, 403);
    const self = await authed(tokens.learner, "POST", `/attempts/${attempt.id}/grade`, body);
    assert.equal(self.status, 403);
    assert.match(self.body.error, /cannot grade your own attempt/);

    const unchanged = await prisma.assessmentAttempt.findUnique({ where: { id: attempt.id } });
    assert.equal(unchanged?.status, "grading");
    assert.equal(unchanged?.gradedBy, null);
    assert.equal(await prisma.auditLog.count({ where: { entity: "assessment_attempt", entityId: attempt.id, action: "ATTEMPT_GRADED" } }), 0);

    const graded = await authed(tokens.trainer, "POST", `/attempts/${attempt.id}/grade`, body);
    assert.equal(graded.status, 200);
    const after = await prisma.assessmentAttempt.findUnique({ where: { id: attempt.id } });
    assert.equal(after?.status, "graded");
    assert.equal(after?.gradedBy, users.trainer.id);
  });

  test("evaluation status is course, programme and organization scoped", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const own = await authed(tokens.trainer, "GET", `/courses/${ids.courseA}/evaluation-status`);
    assert.equal(own.status, 200);
    assert.equal(own.body.pending, true);
    assert.equal(own.body.job.id, statusJob.id);
    assert.equal(own.body.job.courseId, ids.courseA);
    assert.equal(own.body.attempts, 0);
    assert.equal(own.body.stale, false);
    assert.equal(own.body.lastError, null);

    const learner = await authed(tokens.learner, "GET", `/courses/${ids.courseA}/evaluation-status`);
    assert.equal(learner.status, 403);
    assert.match(learner.body.error, /programme staff access required/);
    const otherProgramme = await authed(tokens.trainerB, "GET", `/courses/${ids.courseA}/evaluation-status`);
    assert.equal(otherProgramme.status, 403);
    const outsider = await authed(tokens.outsider, "GET", `/courses/${ids.courseA}/evaluation-status`);
    assert.equal(outsider.status, 404);

    const ownerOther = await authed(tokens.orgOwner, "GET", `/courses/${ids.courseB}/evaluation-status`);
    assert.equal(ownerOther.status, 200);
    assert.equal(ownerOther.body.pending, false);
    assert.equal(ownerOther.body.job, null);
    const trainerOther = await authed(tokens.trainerB, "GET", `/courses/${ids.courseB}/evaluation-status`);
    assert.equal(trainerOther.status, 200);
    assert.equal(trainerOther.body.pending, false);
  });

  test("parallel enqueues reuse one pending row per course without touching a running row", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const [aResults, bResults] = await Promise.all([
      Promise.all(Array.from({ length: 8 }, () => enqueueCourseEvaluation(ids.queueCourseA, "assessment_published"))),
      Promise.all(Array.from({ length: 8 }, () => enqueueCourseEvaluation(ids.queueCourseB, "content_changed"))),
    ]);
    assert.ok(aResults.every((job) => job.id === aResults[0].id));
    assert.ok(bResults.every((job) => job.id === bResults[0].id));
    assert.notEqual(aResults[0].id, bResults[0].id);
    assert.notEqual(aResults[0].id, runningJob.id);
    assert.equal(await prisma.evaluationJob.count({ where: { courseId: ids.queueCourseA, status: "pending" } }), 1);
    assert.equal(await prisma.evaluationJob.count({ where: { courseId: ids.queueCourseB, status: "pending" } }), 1);
    const unchanged = await prisma.evaluationJob.findUnique({ where: { id: runningJob.id } });
    assert.equal(unchanged?.status, "running");
    assert.equal(unchanged?.attempts, 1);
    assert.equal(unchanged?.heartbeatAt?.getTime(), runningJob.heartbeatAt.getTime());
  });

  test("attempt outcome ignores queued attempts, pins certificate identity and backfills a manual certificate", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const attempt = await createAttempt(assessment.id, enrolments.repeat.id, users.learner.id, { status: "grading" });
    const queued = await applyAttemptOutcome(attempt.id);
    assert.equal(queued.competenceMet, false);
    assert.equal(queued.appliedScore, null);
    assert.equal(queued.certificateIssued, false);
    assert.equal(await prisma.certificate.count({ where: { enrolmentId: enrolments.repeat.id } }), 0);

    await prisma.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: "graded", score: 100, percent: 100, passed: true, gradedAt: new Date() },
    });
    const graded = await applyAttemptOutcome(attempt.id);
    assert.equal(graded.competenceMet, true);
    assert.equal(graded.appliedScore, 100);
    assert.equal(graded.certificateIssued, true);
    const row = await prisma.enrolment.findUnique({ where: { id: enrolments.repeat.id } });
    assert.equal(row?.status, "completed");
    assert.equal(row?.completionSource, "assessment");
    const certificate = await prisma.certificate.findFirst({ where: { enrolmentId: enrolments.repeat.id, status: "active" } });
    assert.ok(certificate);
    assert.equal(certificate.attemptId, attempt.id);

    const repeated = await applyAttemptOutcome(attempt.id);
    assert.equal(repeated.certificateIssued, false);
    const afterRepeat = await prisma.certificate.findFirst({ where: { enrolmentId: enrolments.repeat.id, status: "active" } });
    assert.equal(afterRepeat?.id, certificate.id);
    assert.equal(afterRepeat?.attemptId, attempt.id);
    assert.equal(await prisma.certificate.count({ where: { enrolmentId: enrolments.repeat.id } }), 1);

    const backfillAttempt = await createAttempt(assessment.id, enrolments.manual.id, users.learner.id, {
      status: "graded", score: 100, percent: 100, passed: true, gradedAt: new Date(),
    });
    await evaluateEnrolment(enrolments.manual.id, "attempt_graded", { attemptId: backfillAttempt.id });
    const manualCertificate = await prisma.certificate.findFirst({ where: { enrolmentId: enrolments.manual.id, status: "active" } });
    assert.ok(manualCertificate);
    assert.equal(manualCertificate.attemptId, backfillAttempt.id);
  });
});
