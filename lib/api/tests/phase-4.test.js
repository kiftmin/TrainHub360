// Phase 4 — the assessment loop: questions, server-side grading, the review queue, and what a
// result sets off (enrolment score, competence, certificate).
//
// The failures this suite exists to catch are the ones where a learner or a client can make a
// result true by saying so: a posted score, a leaked answer key, a self-graded scenario, an
// attempt limit that is not enforced, a competence claim that comes from something other than the
// applied assessment.
import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Phase 4 assessment, grading and competence", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `p4-org-${stamp}`,
    otherOrg: `p4-org-b-${stamp}`,
    programme: `p4-prog-${stamp}`,
    otherProgramme: `p4-prog-b-${stamp}`,
    course: `p4-course-${stamp}`,
    otherCourse: `p4-course-b-${stamp}`,
    module: `p4-module-${stamp}`,
    learner: `p4-learner-${stamp}@example.com`,
    trainer: `p4-trainer-${stamp}@example.com`,
    outsider: `p4-outsider-${stamp}@example.com`,
    otherTrainer: `p4-other-trainer-${stamp}@example.com`,
  };
  const tokens = {};
  const users = {};

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

  const mkAssessment = async (over = {}) =>
    prisma.assessment.create({
      data: { moduleId: ids.module, type: "applied", title: "Applied", passMark: 70, isPublished: true, publishedAt: new Date(), ...over },
    });

  // A recall question with a known key: correct option is the one at `correctIndex`.
  const mkChoice = async (assessmentId, { kind = "single_choice", correct = 0, points = 1, order = 0 } = {}) => {
    const question = await prisma.question.create({ data: { assessmentId, kind, prompt: `Q${order}`, points, order } });
    const options = [];
    for (let i = 0; i < 3; i++) {
      options.push(await prisma.questionOption.create({ data: { questionId: question.id, text: `Option ${i}`, isCorrect: i === correct, order: i } }));
    }
    return { question, options };
  };

  const mkScenario = async (assessmentId, { points = 4, order = 1 } = {}) =>
    prisma.question.create({ data: { assessmentId, kind: "scenario", prompt: "Handle this", scenarioContext: "A learner is absent", points, rubric: "Names the escalation path", order } });

  const enrol = async (learnerId, courseId = ids.course) => {
    const existing = await prisma.enrolment.findFirst({ where: { learnerId, courseId } });
    if (existing) return existing;
    return prisma.enrolment.create({ data: { learnerId, courseId, programmeId: ids.programme, status: "enrolled" } });
  };

  before(async () => {
    if (!requireDatabase("phase-4.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    const pw = await hashPassword("pw");
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner"]);
    await prisma.organization.createMany({ data: [{ id: ids.org, name: "P4 Org" }, { id: ids.otherOrg, name: "P4 Other" }] });
    await prisma.programme.createMany({
      data: [
        { id: ids.programme, orgId: ids.org, name: "P4 Prog", type: "Test", owner: "t" },
        { id: ids.otherProgramme, orgId: ids.otherOrg, name: "P4 Other Prog", type: "Test", owner: "t" },
      ],
    });
    // A validity window makes the course certificate-requiring, so issuing one is observable.
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "P4 Course", appliedThreshold: 75, validityMonths: 12 } });
    await prisma.course.create({ data: { id: ids.otherCourse, programmeId: ids.otherProgramme, title: "Other Course" } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module" } });

    const mkUser = async (orgId, email, name) => prisma.user.create({ data: { orgId, name, email, passwordHash: pw } });
    const learner = await mkUser(ids.org, ids.learner, "P4 Learner");
    const trainer = await mkUser(ids.org, ids.trainer, "P4 Trainer");
    const outsider = await mkUser(ids.otherOrg, ids.outsider, "P4 Outsider");
    const otherTrainer = await mkUser(ids.otherOrg, ids.otherTrainer, "P4 Other Trainer");
    Object.assign(users, { learner, trainer, outsider, otherTrainer });

    await prisma.userRole.create({ data: { userId: trainer.id, roleId: "trainer", programmeId: ids.programme } });
    await prisma.userRole.create({ data: { userId: trainer.id, roleId: "admin", programmeId: null } });
    await prisma.userRole.create({ data: { userId: otherTrainer.id, roleId: "admin", programmeId: null } });
    await enrol(learner.id);

    tokens.learner = signToken({ id: learner.id, role: "learner", orgId: ids.org, tokenVersion: 0 });
    tokens.trainer = signToken({ id: trainer.id, role: "admin", orgId: ids.org, tokenVersion: 0 });
    tokens.outsider = signToken({ id: outsider.id, role: "learner", orgId: ids.otherOrg, tokenVersion: 0 });
    tokens.otherTrainer = signToken({ id: otherTrainer.id, role: "admin", orgId: ids.otherOrg, tokenVersion: 0 });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.attemptAnswer.deleteMany({ where: { attempt: { learnerId: { in: userIds } } } }).catch(() => null);
      await prisma.assessmentAttempt.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.certificate.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.recognition.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.question.deleteMany({ where: { assessment: { moduleId: ids.module } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: ids.module } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.course, ids.otherCourse] } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programme, ids.otherProgramme] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("the stub route no longer accepts a client score", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learner, "POST", `/courses/${ids.course}/attempts`, { appliedScore: 100, recallScore: 100 });
    assert.equal(res.status, 410, "client-submitted scores must be refused");
    const enrolment = await prisma.enrolment.findFirst({ where: { courseId: ids.course, learnerId: users.learner.id } });
    assert.equal(enrolment.appliedAssessmentScore, null, "nothing may be written from that route");
  });

  test("learner attempt responses never carry the answer key or the rubric", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment();
    await mkChoice(assessment.id, { correct: 1, order: 0 });
    await mkScenario(assessment.id, { order: 1 });
    const res = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.equal(res.status, 201);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("isCorrect"), "isCorrect must not be serialized to a learner");
    assert.ok(!raw.includes("rubric"), "the rubric must not be serialized to a learner");
    assert.ok(!raw.includes("Names the escalation path"));
    assert.equal(res.body.questions.length, 2);

    const view = await authed(tokens.learner, "GET", `/attempts/${res.body.attemptId}`);
    assert.equal(view.status, 200);
    const viewRaw = JSON.stringify(view.body);
    assert.ok(!viewRaw.includes("isCorrect"));
    assert.ok(!viewRaw.includes("rubric"));
  });

  test("server-side auto-grading: all of the correct options and none of the wrong ones", async (t) => {
    if (!server) return t.skip("database unreachable");
    // Two assessments so the first one's pass does not decide this one.
    const assessment = await mkAssessment({ type: "recall", passMark: 60 });
    const single = await mkChoice(assessment.id, { kind: "single_choice", correct: 0, order: 0 });
    const multi = await mkChoice(assessment.id, { kind: "multi_choice", correct: 0, points: 2, order: 1 });
    // Make the second question a two-of-three answer.
    await prisma.questionOption.update({ where: { id: multi.options[1].id }, data: { isCorrect: true } });

    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    const attemptId = start.body.attemptId;
    const submit = await authed(tokens.learner, "POST", `/attempts/${attemptId}/submit`, {
      answers: [
        { questionId: single.question.id, optionIds: [single.options[0].id] },
        // Correct pair plus a wrong one: a multi-choice answer must be exactly right.
        { questionId: multi.question.id, optionIds: [multi.options[0].id, multi.options[1].id, multi.options[2].id] },
      ],
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.body.graded, true, "a purely objective attempt is graded on submit");
    assert.equal(submit.body.earnedPoints, 1, "partial multi-choice earns nothing");
    assert.equal(submit.body.totalPoints, 3);
    assert.equal(submit.body.score, 33.3);
    assert.equal(submit.body.passed, false);
  });

  test("a client-sent score is ignored; grading reads the stored answers", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment();
    const question = await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    const submit = await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      score: 100,
      percent: 100,
      passed: true,
      answers: [{ questionId: question.question.id, optionIds: [question.options[2].id] }],
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.body.score, 0, "a wrong answer scores zero whatever the body claims");
    assert.equal(submit.body.passed, false);
  });

  test("scenario attempts wait in the queue, and a learner cannot grade their own", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment();
    const choice = await mkChoice(assessment.id, { kind: "single_choice", correct: 0, order: 0 });
    const scenario = await mkScenario(assessment.id, { points: 3, order: 1 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    const submit = await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      answers: [
        { questionId: choice.question.id, optionIds: [choice.options[0].id] },
        { questionId: scenario.id, text: "Escalate to the line manager and record it." },
      ],
    });
    assert.equal(submit.body.graded, false, "a scenario answer cannot be marked by the server");
    assert.equal(submit.body.status, "grading");
    assert.equal(submit.body.awaitingGrading, 1);
    assert.equal(submit.body.score, null, "an unfinished attempt must not report a score");

    const stored = await prisma.assessmentAttempt.findUnique({ where: { id: start.body.attemptId } });
    assert.equal(stored.status, "grading");
    assert.equal(stored.percent, null);

    const selfGrade = await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/grade`, {
      grades: [{ questionId: scenario.id, points: 3 }],
    });
    assert.equal(selfGrade.status, 403, "a learner may never grade their own attempt");

    const queue = await authed(tokens.trainer, "GET", "/assessments/grading/queue");
    assert.equal(queue.status, 200);
    assert.ok(queue.body.some((row) => row.attemptId === start.body.attemptId), "the attempt must be in the review queue");

    const graded = await authed(tokens.trainer, "POST", `/attempts/${start.body.attemptId}/grade`, {
      grades: [{ questionId: scenario.id, points: 3, comment: "Good escalation." }],
    });
    assert.equal(graded.status, 200);
    assert.equal(graded.body.status, "graded");
    assert.equal(graded.body.score, 100);
    assert.equal(graded.body.passed, true);
    // Round 8 competence is course-wide: every live applied assessment must be passed. Earlier
    // tests in this suite leave live applied papers in this course without a passing attempt, so
    // a single good paper here cannot make the whole enrolment competent. The dedicated
    // competence test retires those papers before it asserts a true.
    assert.equal(graded.body.competenceMet, false, "one paper's pass is not course-wide competence");

    const after = await authed(tokens.learner, "GET", `/attempts/${start.body.attemptId}`);
    assert.equal(after.body.score, 100);
    assert.equal(after.body.questions.find((q) => q.id === scenario.id).yourAnswer.text, "Escalate to the line manager and record it.");
    assert.ok(after.body.questions.find((q) => q.id === scenario.id).graderComment, "the learner sees the grader's comment");
  });

  test("a graded attempt cannot be graded twice", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall" });
    const question = await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      answers: [{ questionId: question.question.id, optionIds: [question.options[0].id] }],
    });
    const regrade = await authed(tokens.trainer, "POST", `/attempts/${start.body.attemptId}/grade`, {
      grades: [{ questionId: question.question.id, points: 1 }],
    });
    assert.equal(regrade.status, 409, "an already graded objective attempt is not re-marked");
  });

  test("maxAttempts is enforced and a pass keeps the seat", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall", passMark: 101, maxAttempts: 2 });
    const question = await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    for (let i = 0; i < 2; i++) {
      const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
      assert.ok([200, 201].includes(start.status), `attempt ${i + 1} should start`);
      await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
        answers: [{ questionId: question.question.id, optionIds: [question.options[1].id] }],
      });
    }
    const third = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.equal(third.status, 403);
    assert.equal(third.body.locked, true);
    assert.match(String(third.body.error), /no attempts remaining/i);
  });

  test("a started attempt is resumed, not counted again", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall", maxAttempts: 1 });
    await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    const first = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    const second = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.equal(second.status, 200, "reloading must not burn an attempt");
    assert.equal(second.body.resumed, true);
    assert.equal(second.body.attemptId, first.body.attemptId);
  });

  test("the pass mark falls back to the course applied threshold", async (t) => {
    if (!server) return t.skip("database unreachable");
    // The course's appliedThreshold is 75; this assessment sets none of its own.
    const assessment = await mkAssessment({ passMark: null });
    const choice = await mkChoice(assessment.id, { kind: "single_choice", correct: 0, order: 0 });
    const scenario = await mkScenario(assessment.id, { points: 3, order: 1 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    const view = await authed(tokens.learner, "GET", `/attempts/${start.body.attemptId}`);
    assert.equal(view.body.passMark, 75, "an applied assessment with no pass mark uses the course threshold");
    assert.equal(view.body.passMarkSource, "course_applied_threshold");

    await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      answers: [
        { questionId: choice.question.id, optionIds: [choice.options[0].id] },
        { questionId: scenario.id, text: "Escalate." },
      ],
    });
    const graded = await authed(tokens.trainer, "POST", `/attempts/${start.body.attemptId}/grade`, {
      grades: [{ questionId: scenario.id, points: 1 }],
    });
    assert.equal(graded.body.passMark, 75);
    assert.equal(graded.body.score, 50, "2 of 4 points against a 75% threshold");
    assert.equal(graded.body.passed, false);
  });

  test("competence flips only from the applied result, on the best attempt", async (t) => {
    if (!server) return t.skip("database unreachable");
    // Complete the content first: competence needs completion plus the applied assessment.
    await prisma.enrolment.updateMany({ where: { learnerId: users.learner.id, courseId: ids.course }, data: { status: "completed", completionDate: new Date() } });

    // Competence means every live applied assessment of the course is met. The assessments the
    // earlier tests left behind were graded partially on purpose, so they are cleared away here:
    // this test is about the rule, not about the fixture's history. Attempts have cascade off by
    // design (history must not vanish by accident), hence the explicit order.
    // Assessments with no live applied attempt are superseded in place (the API then refuses new
    // attempts on them); the rest are removed with their attempts, because a live applied
    // assessment the learner never passed would hold competence back for the wrong reason.
    const retiredIds = (await prisma.assessment.findMany({ where: { module: { courseId: ids.course }, type: "applied" }, select: { id: true } })).map((a) => a.id);
    for (const id of retiredIds) {
      const graded = await prisma.assessmentAttempt.findFirst({ where: { assessmentId: id, status: "graded" } });
      if (graded) {
        await prisma.assessment.update({ where: { id }, data: { isPublished: false, publishedAt: null } });
        continue;
      }
      await prisma.attemptAnswer.deleteMany({ where: { attempt: { assessmentId: id } } });
      await prisma.assessmentAttempt.deleteMany({ where: { assessmentId: id } });
      await prisma.question.deleteMany({ where: { assessmentId: id } });
      await prisma.assessment.delete({ where: { id } });
    }

    const assessment = await mkAssessment({ passMark: 70 });
    const choice = await mkChoice(assessment.id, { kind: "single_choice", correct: 0, order: 0 });
    const scenario = await mkScenario(assessment.id, { points: 3, order: 1 });
    const before = await prisma.enrolment.findFirst({ where: { learnerId: users.learner.id, courseId: ids.course } });
    // Completion is what competence needs on the content side, and the route's own check reads
    // `completionDate`; setting only `status` is what the staff route does, so keep both in step.
    assert.ok(before.completionDate, "the fixture must have finished the content");

    // A failing attempt first.
    const failing = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    await authed(tokens.learner, "POST", `/attempts/${failing.body.attemptId}/submit`, {
      answers: [
        { questionId: choice.question.id, optionIds: [choice.options[1].id] },
        { questionId: scenario.id, text: "Nothing." },
      ],
    });
    const failed = await authed(tokens.trainer, "POST", `/attempts/${failing.body.attemptId}/grade`, {
      grades: [{ questionId: scenario.id, points: 0 }],
    });
    assert.equal(failed.body.passed, false, JSON.stringify(failed.body));
    let enrolment = await prisma.enrolment.findFirst({ where: { learnerId: users.learner.id, courseId: ids.course } });
    // Round 8 standing score: the average of each live applied assessment's best result. Every
    // earlier applied assessment is retired above, so this course now holds one live paper whose
    // best is zero until the passing attempt below.
    assert.equal(enrolment.appliedAssessmentScore, 0, "a live applied assessment with only a failed attempt counts as zero");

    // Then a passing one, which is the one competence comes from.
    const passing = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    await authed(tokens.learner, "POST", `/attempts/${passing.body.attemptId}/submit`, {
      answers: [
        { questionId: choice.question.id, optionIds: [choice.options[0].id] },
        { questionId: scenario.id, text: "Escalate to the line manager and log it." },
      ],
    });
    const passed = await authed(tokens.trainer, "POST", `/attempts/${passing.body.attemptId}/grade`, {
      grades: [{ questionId: scenario.id, points: 3, comment: "Clear." }],
    });
    assert.equal(passed.body.passed, true);
    assert.equal(passed.body.appliedScore, 100, "best applied attempt, not the latest");
    assert.equal(passed.body.competenceMet, true);

    enrolment = await prisma.enrolment.findFirst({ where: { learnerId: users.learner.id, courseId: ids.course } });
    assert.equal(enrolment.appliedAssessmentScore, 100);
    assert.ok(enrolment.enrolmentScore !== null && enrolment.enrolmentScore > 0, "the review-credit score is recomputed");

    const certificate = await prisma.certificate.findFirst({ where: { enrolmentId: enrolment.id, status: "active" } });
    assert.ok(certificate, "a completed, competent enrolment on a validity-window course issues a certificate");
    // The certificate belongs to the enrolment, which earned it on its best applied attempt: the
    // one that flipped competence (here the earlier pass, not this test's replay of it).
    assert.ok(certificate.attemptId, "the certificate points at the attempt that earned it");

    // A later, worse attempt must not take the competence back.
    const worse = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    await authed(tokens.learner, "POST", `/attempts/${worse.body.attemptId}/submit`, {
      answers: [
        { questionId: choice.question.id, optionIds: [choice.options[2].id] },
        { questionId: scenario.id, text: "No idea." },
      ],
    });
    const worseGraded = await authed(tokens.trainer, "POST", `/attempts/${worse.body.attemptId}/grade`, {
      grades: [{ questionId: scenario.id, points: 0 }],
    });
    assert.equal(worseGraded.body.passed, false);
    assert.equal(worseGraded.body.appliedScore, 100, "the best attempt stands");
    enrolment = await prisma.enrolment.findFirst({ where: { learnerId: users.learner.id, courseId: ids.course } });
    assert.equal(enrolment.appliedAssessmentScore, 100);
  });

  test("a recall assessment cannot be published with a scenario, nor an applied one without", async (t) => {
    if (!server) return t.skip("database unreachable");
    const recall = await mkAssessment({ type: "recall", isPublished: false, publishedAt: null });
    await mkScenario(recall.id);
    const recallPublish = await authed(tokens.trainer, "POST", `/assessments/${recall.id}/publish`, {});
    assert.equal(recallPublish.status, 400);
    assert.match(String(recallPublish.body.error), /recall assessment/i);

    const applied = await mkAssessment({ type: "applied", isPublished: false, publishedAt: null });
    await mkChoice(applied.id, { kind: "single_choice", correct: 0 });
    const appliedPublish = await authed(tokens.trainer, "POST", `/assessments/${applied.id}/publish`, {});
    assert.equal(appliedPublish.status, 400);
    assert.match(String(appliedPublish.body.error), /scenario or short answer/i);
  });

  test("publishing freezes the questions; editing starts a new version", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall", isPublished: false, publishedAt: null });
    const original = await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    const publish = await authed(tokens.trainer, "POST", `/assessments/${assessment.id}/publish`, {});
    assert.equal(publish.status, 200);
    assert.ok(publish.body.publishedAt, "a published assessment records when it was frozen");

    const edit = await authed(tokens.trainer, "POST", `/assessments/${assessment.id}/questions`, {
      kind: "single_choice",
      prompt: "A second question",
      options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }],
    });
    assert.equal(edit.status, 201);
    assert.equal(edit.body.versionCreated, true);
    assert.notEqual(edit.body.assessmentId, assessment.id, "the edit lands in a new version");
    assert.equal(edit.body.version, 2);

    // The old row is still there, keeping the attempt history, but is no longer the live copy.
    const old = await prisma.assessment.findUnique({ where: { id: assessment.id } });
    assert.equal(old.isPublished, false);
    assert.equal(old.publishedAt, null);
    const oldQuestions = await prisma.question.count({ where: { assessmentId: assessment.id } });
    assert.equal(oldQuestions, 1, "the old version keeps exactly the questions it was published with");

    const newDoc = await authed(tokens.trainer, "GET", `/assessments/${edit.body.assessmentId}`);
    assert.equal(newDoc.body.version, 2);
    assert.equal(newDoc.body.editable, true);
    assert.equal(newDoc.body.questions.length, 2);
    assert.ok(original.question.id, "the original question still exists");

    // A superseded version accepts no new attempts.
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.equal(start.status, 403, "a superseded version is not open for attempts");
  });

  test("enrolment is required, and another organization's assessment is not found", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall" });
    await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });

    // Unenrol the learner briefly: without an enrolment the attempt is refused.
    await prisma.enrolment.updateMany({ where: { learnerId: users.learner.id, courseId: ids.course }, data: { status: "withdrawn" } });
    const noEnrolment = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.equal(noEnrolment.status, 403);
    assert.match(String(noEnrolment.body.error), /enrolment required/i);
    await prisma.enrolment.updateMany({ where: { learnerId: users.learner.id, courseId: ids.course }, data: { status: "enrolled" } });

    // Another organization's learner cannot see or start it.
    const cross = await authed(tokens.outsider, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.equal(cross.status, 404, "cross-org isolation: not found, not forbidden");
  });

  test("another organization's trainer cannot walk the queue or grade", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall", passMark: 60 });
    const question = await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      answers: [{ questionId: question.question.id, optionIds: [question.options[0].id] }],
    });
    const queue = await authed(tokens.otherTrainer, "GET", "/assessments/grading/queue");
    assert.equal(queue.status, 200);
    assert.ok(!queue.body.some((row) => row.attemptId === start.body.attemptId), "another org's queue must not list it");

    const grading = await authed(tokens.otherTrainer, "POST", `/attempts/${start.body.attemptId}/grade`, {
      grades: [{ questionId: question.question.id, points: 1 }],
    });
    assert.equal(grading.status, 404);

    const answers = await authed(tokens.otherTrainer, "GET", `/attempts/${start.body.attemptId}/answers`);
    assert.equal(answers.status, 404);
  });

  test("a short answer with accepted forms is marked without a person", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "applied", passMark: 50 });
    const question = await prisma.question.create({
      data: {
        assessmentId: assessment.id,
        kind: "short_answer",
        prompt: "Which team do you escalate a safeguarding concern to?",
        points: 2,
        order: 0,
        rubric: "Names the safeguarding lead",
        acceptedAnswers: JSON.stringify(["the safeguarding team", "safeguarding lead"]),
      },
    });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    const submit = await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      answers: [{ questionId: question.id, text: "  The Safeguarding Team. " }],
    });
    assert.equal(submit.body.graded, true);
    assert.equal(submit.body.score, 100, "case, spacing and a trailing full stop do not matter");
    assert.equal(submit.body.results[0].manual, false);
  });

  test("the time limit is enforced when saving answers", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall", timeLimitMinutes: 1 });
    const question = await mkChoice(assessment.id, { kind: "single_choice", correct: 0 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});
    assert.ok(start.body.expiresAt, "a timed assessment reports when it closes");

    // Move the clock: the attempt started two minutes ago, so a one-minute limit has passed.
    await prisma.assessmentAttempt.update({ where: { id: start.body.attemptId }, data: { startedAt: new Date(Date.now() - 120_000) } });
    const late = await authed(tokens.learner, "PUT", `/attempts/${start.body.attemptId}/answers`, {
      answers: [{ questionId: question.question.id, optionIds: [question.options[0].id] }],
    });
    assert.equal(late.status, 409);
    assert.equal(late.body.expired, true);

    // Submitting still works: what the learner entered is graded, they are not locked out.
    const submit = await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, { answers: [] });
    assert.equal(submit.status, 200);
    assert.equal(submit.body.status, "graded");
  });

  test("answers can be saved before submitting and are graded from what was saved", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessment = await mkAssessment({ type: "recall", passMark: 50 });
    const q1 = await mkChoice(assessment.id, { kind: "single_choice", correct: 0, order: 0 });
    const q2 = await mkChoice(assessment.id, { kind: "single_choice", correct: 2, points: 2, order: 1 });
    const start = await authed(tokens.learner, "POST", `/assessments/${assessment.id}/attempts`, {});

    const saved = await authed(tokens.learner, "PUT", `/attempts/${start.body.attemptId}/answers`, {
      answers: [{ questionId: q1.question.id, optionIds: [q1.options[0].id] }],
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.saved, 1);

    const view = await authed(tokens.learner, "GET", `/attempts/${start.body.attemptId}`);
    const mine = view.body.questions.find((q) => q.id === q1.question.id);
    assert.deepEqual(mine.yourAnswer.optionIds, [q1.options[0].id]);
    assert.equal(mine.pointsAwarded ?? null, null, "a saved answer is not graded before submit");

    const submit = await authed(tokens.learner, "POST", `/attempts/${start.body.attemptId}/submit`, {
      answers: [{ questionId: q2.question.id, optionIds: [q2.options[2].id] }],
    });
    assert.equal(submit.body.earnedPoints, 3, "the earlier save and the submit answer are both graded");
    assert.equal(submit.body.totalPoints, 3);
    assert.equal(submit.body.passed, true);
  });
});
