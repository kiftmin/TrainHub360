import { resetTestState } from "./support/resetTestState.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("course content and assessment flow", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  let ownerToken = "";
  let learnerToken = "";
  const stamp = Date.now();
  const ids = {
    org: `content-org-${stamp}`,
    programme: `content-programme-${stamp}`,
    course: `content-course-${stamp}`,
    module: `content-module-${stamp}`,
    owner: `content-owner-${stamp}@example.com`,
    learner: `content-learner-${stamp}@example.com`,
  };

  before(async () => {
    await resetTestState();
    if (!requireDatabase("content-assessment.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      console.error("content-assessment test database unreachable:", e.message);
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    const pw = await hashPassword("pw");
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.create({ data: { id: ids.org, name: "Content Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "Content Programme", type: "course", owner: "O" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "Content Course" } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module 1" } });
    const owner = await prisma.user.create({ data: { orgId: ids.org, name: "Owner", email: ids.owner, passwordHash: pw } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "Learner", email: ids.learner, passwordHash: pw } });
    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: "owner" } });
    await prisma.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id, programmeId: null } });
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
    learnerToken = await login(ids.learner);
  });

  after(async () => {
    if (prisma) {
      await prisma.assessmentAttempt.deleteMany({ where: { assessment: { moduleId: ids.module } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.contentProgress.deleteMany({ where: { contentItem: { moduleId: ids.module } } }).catch(() => null);
      await prisma.contentItem.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: ids.module } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("learner completes content and a published recall assessment", async (t) => {
    if (!server) return t.skip("database unreachable");
    const auth = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });

    const created = await fetch(`${baseUrl}/api/modules/${ids.module}/content`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ type: "native", title: "Intro", body: "Read this", required: true }),
    });
    assert.equal(created.status, 201);
    const contentId = (await created.json()).id;

    const learnerContent = await fetch(`${baseUrl}/api/courses/${ids.course}/content`, { headers: auth(learnerToken) });
    assert.equal(learnerContent.status, 200);
    const payload = await learnerContent.json();
    assert.equal(payload.modules[0].contentItems[0].id, contentId);

    const progress = await fetch(`${baseUrl}/api/content/${contentId}/progress`, {
      method: "POST",
      headers: auth(learnerToken),
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(progress.status, 200);
    assert.equal((await progress.json()).enrolmentProgress, 100);

    const assessment = await fetch(`${baseUrl}/api/modules/${ids.module}/assessments`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ type: "recall", title: "Quiz", passMark: 70 }),
    });
    assert.equal(assessment.status, 201);
    const assessmentId = (await assessment.json()).id;

    // A published assessment is frozen; the builder takes questions in the phase-4 shape.
    const question = await fetch(`${baseUrl}/api/assessments/${assessmentId}/questions`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({
        kind: "single_choice",
        prompt: "What is 2 + 2?",
        points: 1,
        options: [
          { text: "4", isCorrect: true },
          { text: "5", isCorrect: false },
        ],
      }),
    });
    assert.equal(question.status, 201);

    assert.equal((await fetch(`${baseUrl}/api/assessments/${assessmentId}/publish`, { method: "POST", headers: auth(ownerToken) })).status, 200);

    const started = await fetch(`${baseUrl}/api/assessments/${assessmentId}/attempts`, { method: "POST", headers: auth(learnerToken) });
    assert.equal(started.status, 201);
    const attempt = await started.json();
    assert.equal(attempt.questions.length, 1);
    assert.ok(!("isCorrect" in attempt.questions[0].options[0]), "correct answers must not be serialized");
    const correct = attempt.questions[0].options.find((o) => o.text === "4");

    const submitted = await fetch(`${baseUrl}/api/attempts/${attempt.attemptId}/submit`, {
      method: "POST",
      headers: auth(learnerToken),
      body: JSON.stringify({ answers: [{ questionId: attempt.questions[0].id, optionIds: [correct.id] }] }),
    });
    assert.equal(submitted.status, 200);
    const result = await submitted.json();
    assert.equal(result.score, 100);
    assert.equal(result.passed, true);
  });
});
