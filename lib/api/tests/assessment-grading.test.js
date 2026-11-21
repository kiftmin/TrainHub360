import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";
import { resetTestState } from "./support/resetTestState.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("assessment builder, grading and versions (round 8 phase 2)", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `grade-org-${stamp}`,
    programme: `grade-programme-${stamp}`,
    course: `grade-course-${stamp}`,
    module: `grade-module-${stamp}`,
    owner: `grade-owner-${stamp}@example.com`,
    trainer: `grade-trainer-${stamp}@example.com`,
    learner: `grade-learner-${stamp}@example.com`,
  };
  let ownerToken = "";
  let trainerToken = "";
  let learnerToken = "";
  let learnerId = "";

  const auth = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });
  const post = (p, token, body) => fetch(`${baseUrl}/api${p}`, { method: "POST", headers: auth(token), body: JSON.stringify(body ?? {}) });
  const patch = (p, token, body) => fetch(`${baseUrl}/api${p}`, { method: "PATCH", headers: auth(token), body: JSON.stringify(body ?? {}) });
  const put = (p, token, body) => fetch(`${baseUrl}/api${p}`, { method: "PUT", headers: auth(token), body: JSON.stringify(body ?? {}) });
  const get = (p, token) => fetch(`${baseUrl}/api${p}`, { headers: auth(token) });

  async function newAssessment(type, title) {
    const r = await post(`/modules/${ids.module}/assessments`, ownerToken, { type, title, passMark: 70 });
    assert.equal(r.status, 201);
    return (await r.json()).id;
  }

  async function addQuestion(assessmentId, body) {
    return post(`/assessments/${assessmentId}/questions`, ownerToken, body);
  }

  before(async () => {
    await resetTestState();
    if (!requireDatabase("assessment-grading.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      console.error("assessment-grading test database unreachable:", e.message);
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    const pw = await hashPassword("pw");
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.create({ data: { id: ids.org, name: "Grade Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "Grade Programme", type: "course", owner: "O" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "Grade Course" } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module 1" } });
    const owner = await prisma.user.create({ data: { orgId: ids.org, name: "Owner", email: ids.owner, passwordHash: pw } });
    const trainer = await prisma.user.create({ data: { orgId: ids.org, name: "Trainer", email: ids.trainer, passwordHash: pw } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "Learner", email: ids.learner, passwordHash: pw } });
    learnerId = learner.id;
    const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
    await prisma.userRole.create({ data: { userId: owner.id, roleId: roles.owner, programmeId: null } });
    await prisma.userRole.create({ data: { userId: trainer.id, roleId: roles.trainer, programmeId: ids.programme } });
    await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.course, programmeId: ids.programme } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = async (email) =>
      (await (await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "pw" }),
      })).json()).accessToken;
    ownerToken = await login(ids.owner);
    trainerToken = await login(ids.trainer);
    learnerToken = await login(ids.learner);
  });

  after(async () => {
    if (prisma) {
      await prisma.assessmentAttempt.deleteMany({ where: { enrolment: { courseId: ids.course } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: ids.module } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.notification.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("publish problems are returned for the builder", async (t) => {
    if (!server) return t.skip("database unreachable");
    const recall = await newAssessment("recall", "Recall");
    const scenario = await addQuestion(recall, { kind: "scenario", prompt: "Scenario", points: 5, rubric: "r" });
    assert.equal(scenario.status, 400);
    assert.match((await scenario.json()).error, /scenario/i);

    const applied = await newAssessment("applied", "Applied");
    const choice = await addQuestion(applied, {
      kind: "single_choice", prompt: "Pick", points: 5,
      options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }],
    });
    assert.equal(choice.status, 201);
    const q = await choice.json();
    assert.equal(q.kind, "single_choice");
    const publish = await post(`/assessments/${applied}/publish`, ownerToken, {});
    assert.equal(publish.status, 400);
    assert.match((await publish.json()).error, /scenario or short-answer/i);

    const short = await addQuestion(applied, { kind: "short_answer", prompt: "Explain", points: 5, acceptedAnswers: ["because"] });
    assert.equal(short.status, 201);
    assert.equal((await post(`/assessments/${applied}/publish`, ownerToken, {})).status, 200);
  });

  test("a manual answer enters the queue, grading enforces the cap and notifies", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessmentId = await newAssessment("applied", "Practical");
    const choice = await addQuestion(assessmentId, {
      kind: "single_choice", prompt: "Pick", points: 10,
      options: [{ text: "right", isCorrect: true }, { text: "wrong", isCorrect: false }],
    });
    assert.equal(choice.status, 201);
    const choiceQ = await choice.json();
    assert.equal((await addQuestion(assessmentId, { kind: "short_answer", prompt: "Explain", points: 10 })).status, 201);
    assert.equal((await addQuestion(assessmentId, { kind: "scenario", prompt: "What would you do?", points: 10, rubric: "Look for empathy" })).status, 201);
    assert.equal((await post(`/assessments/${assessmentId}/publish`, ownerToken, {})).status, 200);

    const started = await post(`/assessments/${assessmentId}/attempts`, learnerToken, {});
    assert.equal(started.status, 201);
    const attempt = await started.json();
    assert.deepEqual(attempt.questions.map((q) => q.kind).sort(), ["scenario", "short_answer", "single_choice"]);
    const choiceView = attempt.questions.find((q) => q.kind === "single_choice");
    assert.ok(!("isCorrect" in choiceView.options[0]), "answer key is never sent");

    const saved = await put(`/attempts/${attempt.attemptId}/answers`, learnerToken, {
      answers: [
        { questionId: choiceQ.id, optionIds: [choiceQ.options.find((o) => o.isCorrect).id] },
        { questionId: attempt.questions.find((q) => q.kind === "short_answer").id, text: "Because it matters" },
        { questionId: attempt.questions.find((q) => q.kind === "scenario").id, text: "I would listen first" },
      ],
    });
    assert.equal(saved.status, 200);

    const submitted = await post(`/attempts/${attempt.attemptId}/submit`, learnerToken, {});
    assert.equal(submitted.status, 200);
    const result = await submitted.json();
    assert.equal(result.status, "grading");
    assert.equal(result.score, null);
    assert.equal(result.percent, null);
    assert.equal(result.passed, null);

    const trainer = await prisma.user.findUnique({ where: { email: ids.trainer } });
    const queued = await prisma.notification.findFirst({ where: { userId: trainer.id, type: "grading_queued" } });
    assert.ok(queued, "trainer notified when the attempt enters the queue");

    const queue = await get("/assessments/grading/queue", trainerToken);
    assert.equal(queue.status, 200);
    const queueRows = await queue.json();
    assert.ok(queueRows.some((r) => r.id === attempt.attemptId), "queue lists the attempt for the trainer's programme");

    assert.equal((await get(`/attempts/${attempt.attemptId}/answers`, learnerToken)).status, 403, "learner cannot reach grading screen");
    const answers = await get(`/attempts/${attempt.attemptId}/answers`, trainerToken);
    assert.equal(answers.status, 200);
    const detail = await answers.json();
    const scenario = detail.questions.find((q) => q.kind === "scenario");
    assert.equal(scenario.rubric, "Look for empathy");
    const short = detail.questions.find((q) => q.kind === "short_answer");

    const tooMany = await post(`/attempts/${attempt.attemptId}/grade`, trainerToken, {
      answers: [{ answerId: short.answer.id, pointsAwarded: 11 }],
    });
    assert.equal(tooMany.status, 400);

    const graded = await post(`/attempts/${attempt.attemptId}/grade`, trainerToken, {
      answers: [
        { answerId: short.answer.id, pointsAwarded: 10, comment: "Good" },
        { answerId: scenario.answer.id, pointsAwarded: 10, comment: "Empathetic" },
      ],
    });
    assert.equal(graded.status, 200);
    const final = await graded.json();
    assert.equal(final.score, 100);
    assert.equal(final.passed, true);
    const learnerNote = await prisma.notification.findFirst({ where: { userId: learnerId, type: "attempt_graded" } });
    assert.ok(learnerNote, "learner notified when graded");

    const own = await get(`/attempts/${attempt.attemptId}`, learnerToken);
    const ownBody = await own.json();
    assert.equal(ownBody.score, 100);
    assert.equal(ownBody.passed, true);
  });

  test("an in-flight attempt survives a new version; new attempts use the live version", async (t) => {
    if (!server) return t.skip("database unreachable");
    const assessmentId = await newAssessment("recall", "Quiz");
    const choice = await addQuestion(assessmentId, {
      kind: "single_choice", prompt: "Pick", points: 10,
      options: [{ text: "right", isCorrect: true }, { text: "wrong", isCorrect: false }],
    });
    const choiceQ = await choice.json();
    assert.equal((await post(`/assessments/${assessmentId}/publish`, ownerToken, {})).status, 200);

    const started = await post(`/assessments/${assessmentId}/attempts`, learnerToken, {});
    assert.equal(started.status, 201);
    const oldAttempt = await started.json();
    assert.equal(oldAttempt.version, 1);

    const blocked = await patch(`/assessments/${assessmentId}`, ownerToken, { title: "Quiz v2" });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).requiresNewVersion, true);

    const next = await patch(`/assessments/${assessmentId}`, ownerToken, { title: "Quiz v2", confirmNewVersion: true });
    assert.equal(next.status, 201);
    const nextBody = await next.json();
    assert.equal(nextBody.version, 2);
    // Round 9 / 2.2: publishing over a live version states how the change was meant. A retitled
    // paper is a minor correction, so the results already earned carry forward.
    assert.equal((await post(`/assessments/${nextBody.id}/publish`, ownerToken, { changeKind: "minor" })).status, 200);

    // The old attempt still submits against the paper it started on.
    const submitted = await post(`/attempts/${oldAttempt.attemptId}/submit`, learnerToken, {
      answers: [{ questionId: choiceQ.id, optionIds: [choiceQ.options.find((o) => o.isCorrect).id] }],
    });
    assert.equal(submitted.status, 200);
    assert.equal((await submitted.json()).score, 100);

    const fresh = await post(`/assessments/${nextBody.id}/attempts`, learnerToken, {});
    assert.equal(fresh.status, 201);
    const freshBody = await fresh.json();
    assert.equal(freshBody.assessmentId, nextBody.id);
    assert.equal(freshBody.version, 2);
  });
});
