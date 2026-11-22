import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { attemptStats } from "../dist/services/assessmentAttempts.js";
import { evaluateEnrolment } from "../dist/services/enrolmentOutcome.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Round 11 attempt limits use one version chain", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r11-org-${stamp}`,
    otherProgramme: `r11-other-prog-${stamp}`,
    course: `r11-course-${stamp}`,
    module: `r11-module-${stamp}`,
    outcomeCourse: `r11-outcome-course-${stamp}`,
    outcomeModule: `r11-outcome-module-${stamp}`,
  };
  const users = {};
  const tokens = {};
  let enrolment;
  let outcomeEnrolment;
  let openV1;
  let finishedV1;
  let finishedV2;
  let passedV1;
  let passedV2;
  let newPaperV1;
  let newPaperV2;
  let outcomeV1;
  let outcomeV2;

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

  const createAssessment = async (moduleId, over = {}) => {
    const assessment = await prisma.assessment.create({
      data: {
        moduleId,
        type: "applied",
        title: `R11 paper ${stamp}`,
        passMark: 80,
        maxAttempts: 2,
        isPublished: true,
        publishedAt: new Date(),
        ...over,
      },
    });
    const question = await prisma.question.create({
      data: { assessmentId: assessment.id, kind: "single_choice", prompt: "Pick one", points: 1, order: 0 },
    });
    await prisma.questionOption.create({ data: { questionId: question.id, text: "Right", isCorrect: true, order: 0 } });
    await prisma.questionOption.create({ data: { questionId: question.id, text: "Wrong", isCorrect: false, order: 1 } });
    return assessment;
  };

  const successor = async (previous, changeKind, over = {}) => {
    const next = await createAssessment(previous.moduleId, {
      version: previous.version + 1,
      supersedesId: previous.id,
      changeKind,
      passMark: previous.passMark,
      maxAttempts: previous.maxAttempts,
      ...over,
    });
    await prisma.assessment.update({
      where: { id: previous.id },
      data: { isPublished: false, publishedAt: null, supersededAt: new Date() },
    });
    return next;
  };

  const createAttempt = async (assessmentId, targetEnrolment, learnerId, over = {}) => prisma.assessmentAttempt.create({
    data: {
      assessmentId,
      enrolmentId: targetEnrolment.id,
      learnerId,
      attemptNumber: 1,
      startedAt: new Date(),
      status: "in_progress",
      ...over,
    },
  });

  const start = (assessmentId) => authed(tokens.learner, "POST", `/assessments/${assessmentId}/attempts`);
  const reset = (token, assessmentId) => authed(token, "POST", `/assessments/${assessmentId}/attempts/reset`, { enrolmentId: enrolment.id });

  before(async () => {
    if (!requireDatabase("round11-attempt-limits.test.js")) return;
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

    const passwordHash = await hashPassword("pw");
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner"]);
    await prisma.organization.create({ data: { id: ids.org, name: "R11 Org" } });
    await prisma.programme.createMany({
      data: [
        { id: ids.otherProgramme, orgId: ids.org, name: "R11 Other Programme", type: "Test", owner: "owner" },
      ],
    });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.otherProgramme, title: "R11 Course", appliedThreshold: 70 } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module" } });
    await prisma.course.create({ data: { id: ids.outcomeCourse, programmeId: ids.otherProgramme, title: "R11 Outcome Course", appliedThreshold: 70 } });
    await prisma.module.create({ data: { id: ids.outcomeModule, courseId: ids.outcomeCourse, title: "Outcome Module" } });

    const trainer = await prisma.user.create({ data: { orgId: ids.org, name: "R11 Trainer", email: `r11-trainer-${stamp}@example.com`, passwordHash } });
    const otherTrainer = await prisma.user.create({ data: { orgId: ids.org, name: "R11 Other Trainer", email: `r11-other-trainer-${stamp}@example.com`, passwordHash } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "R11 Learner", email: `r11-learner-${stamp}@example.com`, passwordHash } });
    Object.assign(users, { trainer, otherTrainer, learner });
    await prisma.userRole.create({ data: { userId: trainer.id, roleId: "trainer", programmeId: ids.otherProgramme } });
    await prisma.userRole.create({ data: { userId: otherTrainer.id, roleId: "trainer", programmeId: null } });

    enrolment = await prisma.enrolment.create({
      data: { learnerId: learner.id, courseId: ids.course, programmeId: ids.otherProgramme, status: "enrolled" },
    });
    outcomeEnrolment = await prisma.enrolment.create({
      data: { learnerId: learner.id, courseId: ids.outcomeCourse, programmeId: ids.otherProgramme, status: "enrolled" },
    });
    const content = await prisma.contentItem.create({
      data: { orgId: ids.org, moduleId: ids.outcomeModule, type: "text", title: "R11 required content", required: true },
    });
    await prisma.contentProgress.create({
      data: { enrolmentId: outcomeEnrolment.id, contentItemId: content.id, status: "completed", completedAt: new Date() },
    });

    openV1 = await createAssessment(ids.module, { maxAttempts: 1 });
    finishedV1 = await createAssessment(ids.module, { maxAttempts: 3 });
    finishedV2 = await successor(finishedV1, "minor");
    passedV1 = await createAssessment(ids.module, { maxAttempts: 1 });
    passedV2 = await successor(passedV1, "minor");
    newPaperV1 = await createAssessment(ids.module, { maxAttempts: 1 });
    newPaperV2 = await successor(newPaperV1, "new_paper");
    outcomeV1 = await createAssessment(ids.outcomeModule, { maxAttempts: 1 });
    outcomeV2 = await successor(outcomeV1, "minor");

    await createAttempt(finishedV1.id, enrolment, learner.id, { status: "graded", score: 40, percent: 40, gradedAt: new Date() });
    await createAttempt(passedV1.id, enrolment, learner.id, { status: "graded", score: 90, percent: 90, gradedAt: new Date() });
    await createAttempt(newPaperV1.id, enrolment, learner.id, { status: "graded", score: 40, percent: 40, gradedAt: new Date() });
    await createAttempt(outcomeV1.id, outcomeEnrolment, learner.id, { status: "graded", score: 90, percent: 90, gradedAt: new Date() });

    tokens.learner = signToken({ id: learner.id, role: "learner", orgId: ids.org, tokenVersion: 0 });
    tokens.trainer = signToken({ id: trainer.id, role: "trainer", orgId: ids.org, tokenVersion: 0 });
    tokens.otherTrainer = signToken({ id: otherTrainer.id, role: "trainer", orgId: ids.org, tokenVersion: 0 });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((user) => user.id);
      const courseIds = [ids.course, ids.outcomeCourse];
      const moduleIds = [ids.module, ids.outcomeModule];
      const assessmentIds = (await prisma.assessment.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } })).map((a) => a.id);
      const enrolmentIds = (await prisma.enrolment.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })).map((e) => e.id);
      await prisma.evaluationJob.deleteMany({ where: { courseId: { in: courseIds } } }).catch(() => null);
      await prisma.attemptAnswer.deleteMany({ where: { OR: [{ attempt: { assessmentId: { in: assessmentIds } } }, { attempt: { enrolmentId: { in: enrolmentIds } } }] } }).catch(() => null);
      await prisma.assessmentAttempt.deleteMany({ where: { OR: [{ assessmentId: { in: assessmentIds } }, { enrolmentId: { in: enrolmentIds } }, { learnerId: { in: userIds } }] } }).catch(() => null);
      await prisma.certificate.deleteMany({ where: { OR: [{ enrolmentId: { in: enrolmentIds } }, { learnerId: { in: userIds } }, { courseId: { in: courseIds } }] } }).catch(() => null);
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
      await prisma.programme.deleteMany({ where: { id: ids.otherProgramme } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("a minor successor inherits an open attempt and reset clears the whole chain", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const first = await start(openV1.id);
    assert.equal(first.status, 201);
    assert.equal(first.body.attemptsUsed, 0);
    assert.equal(first.body.maxAttempts, 1);

    const openV2 = await successor(openV1, "minor");
    const blocked = await start(openV2.id);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.locked, true);
    assert.equal(blocked.body.attemptsUsed, 1);
    assert.equal(blocked.body.maxAttempts, 1);

    assert.equal((await reset(tokens.otherTrainer, openV2.id)).status, 403);
    assert.equal((await reset(tokens.learner, openV2.id)).status, 403);
    const cleared = await reset(tokens.trainer, openV2.id);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.reset, 1);
    assert.deepEqual(cleared.body.chainAssessmentIds, [openV2.id, openV1.id]);
    assert.equal(await prisma.assessmentAttempt.count({ where: { assessmentId: { in: [openV1.id, openV2.id] } } }), 0);

    const again = await start(openV2.id);
    assert.equal(again.status, 201);
    assert.equal(again.body.attemptsUsed, 0);
    const resumed = await start(openV2.id);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body.attemptsUsed, 0);
    assert.equal(await prisma.assessmentAttempt.count({ where: { assessmentId: { in: [openV1.id, openV2.id] } } }), 1);
  });

  test("finished attempts carry forward and an in-progress attempt on the current paper does not", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const first = await start(finishedV2.id);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.attemptsUsed, 1);
    const resumed = await start(finishedV2.id);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body.attemptsUsed, 1);

    await prisma.assessmentAttempt.update({ where: { id: resumed.body.attemptId }, data: { status: "graded", score: 40, percent: 40, gradedAt: new Date() } });
    const second = await start(finishedV2.id);
    assert.equal(second.status, 201);
    assert.equal(second.body.attemptNumber, 3);
    assert.equal(second.body.attemptsUsed, 2);
    await prisma.assessmentAttempt.update({ where: { id: second.body.attemptId }, data: { status: "graded", score: 40, percent: 40, gradedAt: new Date() } });

    const blocked = await start(finishedV2.id);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.attemptsUsed, 3);
    assert.equal(blocked.body.maxAttempts, 3);
  });

  test("a pass on an earlier minor version unlocks the current paper", async (t) => {
    if (!server) return t.skip("database unavailable");
    const res = await start(passedV2.id);
    assert.equal(res.status, 201);
    assert.equal(res.body.attemptsUsed, 1);
    assert.equal(res.body.attemptNumber, 2);
  });

  test("a new paper starts a fresh chain", async (t) => {
    if (!server) return t.skip("database unavailable");
    const res = await start(newPaperV2.id);
    assert.equal(res.status, 201);
    assert.equal(res.body.attemptsUsed, 0);
    assert.equal(res.body.attemptNumber, 1);
  });

  test("the enrolment outcome uses the same chain for pass, best score and attempts", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const outcome = await evaluateEnrolment(outcomeEnrolment.id, "manual_status");
    assert.equal(outcome.competent, true);
    assert.equal(outcome.appliedScore, 90);
    const stats = await attemptStats(prisma, outcomeV2, outcomeEnrolment.id, 80);
    assert.deepEqual(stats.chainIds, [outcomeV2.id, outcomeV1.id]);
    assert.equal(stats.bestScore, 90);
    assert.equal(stats.passedBefore, true);
    assert.equal(stats.attemptsUsed, 1);

    await createAttempt(outcomeV2.id, outcomeEnrolment, users.learner.id, { status: "graded", score: 60, percent: 60, gradedAt: new Date() });
    const afterRetry = await evaluateEnrolment(outcomeEnrolment.id, "manual_status");
    assert.equal(afterRetry.competent, true);
    assert.equal(afterRetry.appliedScore, 90);
    const retried = await attemptStats(prisma, outcomeV2, outcomeEnrolment.id, 80);
    assert.equal(retried.bestScore, 90);
    assert.equal(retried.passedBefore, true);
    assert.equal(retried.attemptsUsed, 2);
  });
});
