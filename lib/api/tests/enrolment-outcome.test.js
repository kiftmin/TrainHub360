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

describe("enrolment outcome loop (round 8 phase 1)", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `outcome-org-${stamp}`,
    programme: `outcome-programme-${stamp}`,
    course: `outcome-course-${stamp}`,
    module: `outcome-module-${stamp}`,
    owner: `outcome-owner-${stamp}@example.com`,
    admin: `outcome-admin-${stamp}@example.com`,
    manager: `outcome-manager-${stamp}@example.com`,
    learner: `outcome-learner-${stamp}@example.com`,
  };
  let ownerToken = "";
  let adminToken = "";
  let learnerToken = "";
  let learnerId = "";
  let managerId = "";
  let contentId = "";
  let assessmentA = "";
  let assessmentB = "";
  let correctA = "";
  let correctB = "";

  const auth = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });
  const post = (p, token, body) => fetch(`${baseUrl}/api${p}`, { method: "POST", headers: auth(token), body: JSON.stringify(body ?? {}) });
  const patch = (p, token, body) => fetch(`${baseUrl}/api${p}`, { method: "PATCH", headers: auth(token), body: JSON.stringify(body ?? {}) });
  const get = (p, token) => fetch(`${baseUrl}/api${p}`, { headers: auth(token) });

  async function createApplied(title) {
    const created = await post(`/modules/${ids.module}/assessments`, ownerToken, { type: "applied", title, passMark: 70 });
    assert.equal(created.status, 201, "assessment created");
    const a = await created.json();
    const q = await post(`/assessments/${a.id}/questions`, ownerToken, {
      type: "applied",
      kind: "single_choice",
      prompt: `${title} question`,
      points: 10,
      options: [
        { text: "right", isCorrect: true },
        { text: "wrong", isCorrect: false },
      ],
    });
    assert.equal(q.status, 201, "question created");
    const question = await q.json();
    // Published applied papers need a non-choice question; this one is marked without a person.
    const s = await post(`/assessments/${a.id}/questions`, ownerToken, {
      type: "applied",
      kind: "short_answer",
      prompt: `${title} why`,
      points: 1,
      acceptedAnswers: ["because"],
    });
    assert.equal(s.status, 201, "short answer created");
    const published = await post(`/assessments/${a.id}/publish`, ownerToken, {});
    assert.equal(published.status, 200, "published");
    return { assessmentId: a.id, correctOptionId: question.options.find((o) => o.isCorrect).id };
  }

  async function submit(assessmentId, optionId) {
    const started = await post(`/assessments/${assessmentId}/attempts`, learnerToken, {});
    assert.equal(started.status, 201, "attempt started");
    const attempt = await started.json();
    const choice = attempt.questions.find((q) => q.kind === "single_choice");
    const short = attempt.questions.find((q) => q.kind === "short_answer");
    const submitted = await post(`/attempts/${attempt.attemptId}/submit`, learnerToken, {
      answers: [
        { questionId: choice.id, optionIds: [optionId] },
        { questionId: short.id, text: "because" },
      ],
    });
    assert.equal(submitted.status, 200, "attempt submitted");
    return submitted.json();
  }

  before(async () => {
    await resetTestState();
    if (!requireDatabase("enrolment-outcome.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      console.error("enrolment-outcome test database unreachable:", e.message);
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    const pw = await hashPassword("pw");
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.create({ data: { id: ids.org, name: "Outcome Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "Outcome Programme", type: "course", owner: "O" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "Outcome Course", category: "compliance", validityMonths: 12 } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module 1" } });
    const owner = await prisma.user.create({ data: { orgId: ids.org, name: "Owner", email: ids.owner, passwordHash: pw } });
    const admin = await prisma.user.create({ data: { orgId: ids.org, name: "Admin", email: ids.admin, passwordHash: pw } });
    const manager = await prisma.user.create({ data: { orgId: ids.org, name: "Manager", email: ids.manager, passwordHash: pw } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "Learner", email: ids.learner, passwordHash: pw, managerId: manager.id } });
    learnerId = learner.id;
    managerId = manager.id;
    const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
    await prisma.userRole.create({ data: { userId: owner.id, roleId: roles.owner, programmeId: null } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: roles.admin, programmeId: null } });
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
    adminToken = await login(ids.admin);
    learnerToken = await login(ids.learner);

    const content = await post(`/modules/${ids.module}/content`, ownerToken, { type: "native", title: "Intro", body: "Read", required: true });
    assert.equal(content.status, 201);
    contentId = (await content.json()).id;
    const a = await createApplied("Applied A");
    assessmentA = a.assessmentId;
    correctA = a.correctOptionId;
    const b = await createApplied("Applied B");
    assessmentB = b.assessmentId;
    correctB = b.correctOptionId;
  });

  after(async () => {
    if (prisma) {
      await prisma.assessmentAttempt.deleteMany({ where: { enrolment: { courseId: ids.course } } }).catch(() => null);
      await prisma.certificate.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.contentProgress.deleteMany({ where: { contentItem: { moduleId: ids.module } } }).catch(() => null);
      await prisma.contentItem.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: ids.module } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.notification.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [ids.course] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("assessment passed first, then content finished, completes and issues a certificate", async (t) => {
    if (!server) return t.skip("database unreachable");
    const resultA = await submit(assessmentA, correctA);
    assert.equal(resultA.passed, true);
    const resultB = await submit(assessmentB, correctB);
    assert.equal(resultB.passed, true);
    let enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    assert.notEqual(enrolment.status, "completed", "content is not complete yet");

    const progress = await post(`/content/${contentId}/progress`, learnerToken, { status: "completed" });
    assert.equal(progress.status, 200);
    enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    assert.equal(enrolment.status, "completed");
    assert.ok(enrolment.completionDate, "completion date set");
    assert.ok(enrolment.contentCompletedAt, "content completed at set");
    const cert = await prisma.certificate.findFirst({ where: { enrolmentId: enrolment.id, status: "active" } });
    assert.ok(cert, "certificate issued");
  });

  test("a required item added later removes content-complete until finished", async (t) => {
    if (!server) return t.skip("database unreachable");
    const added = await post(`/modules/${ids.module}/content`, ownerToken, { type: "native", title: "Extra", body: "More", required: true });
    assert.equal(added.status, 201);
    let enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    assert.equal(enrolment.contentCompletedAt, null, "content no longer complete");
    const extraId = (await added.json()).id;
    const progress = await post(`/content/${extraId}/progress`, learnerToken, { status: "completed" });
    assert.equal(progress.status, 200);
    enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    assert.ok(enrolment.contentCompletedAt, "content complete again");
  });

  test("a locked period does not move the score, and leaves an audit entry and notification", async (t) => {
    if (!server) return t.skip("database unreachable");
    // Pass A only: two live applied assessments average to 50, so not competent.
    let enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    await prisma.enrolment.update({ where: { id: enrolment.id }, data: { appliedAssessmentScore: 50, status: "enrolled", completionDate: null, reviewCreditLockedAt: new Date() } });
    const before = (await prisma.enrolment.findUnique({ where: { id: enrolment.id } })).appliedAssessmentScore;
    await submit(assessmentB, correctB);
    enrolment = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(enrolment.appliedAssessmentScore, before, "locked score did not move");
    const audit = await prisma.auditLog.findFirst({ where: { action: "ASSESSMENT_RESULT_NOT_APPLIED_LOCKED", entityId: enrolment.id } });
    assert.ok(audit, "locked-result audit entry exists");
    const admin = await prisma.user.findUnique({ where: { email: ids.admin } });
    const notification = await prisma.notification.findFirst({ where: { userId: admin.id, type: "assessment_result_locked" } });
    assert.ok(notification, "programme admin notified");
  });

  test("an org admin who is not an owner cannot override a locked enrolment", async (t) => {
    if (!server) return t.skip("database unreachable");
    const enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    const r = await patch(`/enrolments/${enrolment.id}`, adminToken, { appliedAssessmentScore: 99, reason: "locked override attempt" });
    assert.equal(r.status, 403);
  });

  test("a manual score needs a reason, is stored and audited, and blocks an automatic overwrite", async (t) => {
    if (!server) return t.skip("database unreachable");
    const enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    await prisma.enrolment.update({ where: { id: enrolment.id }, data: { reviewCreditLockedAt: null } });

    const noReason = await patch(`/enrolments/${enrolment.id}`, ownerToken, { appliedAssessmentScore: 55 });
    assert.equal(noReason.status, 400);

    const withReason = await patch(`/enrolments/${enrolment.id}`, ownerToken, { appliedAssessmentScore: 55, reason: "Moderation adjustment for cohort" });
    assert.equal(withReason.status, 200);
    let saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.appliedAssessmentScore, 55);
    assert.equal(saved.appliedScoreSource, "manual");
    assert.equal(saved.appliedScoreOverrideReason, "Moderation adjustment for cohort");
    const audit = await prisma.auditLog.findFirst({ where: { action: "ENROLMENT_SCORE_OVERRIDDEN", entityId: enrolment.id } });
    assert.ok(audit, "override audited");

    // A later automatic result must not silently replace the override.
    await submit(assessmentB, correctB);
    saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.appliedAssessmentScore, 55, "manual score retained");
    assert.ok(saved.pendingAssessmentScore != null, "automatic result held as pending");

    const accepted = await post(`/enrolments/${enrolment.id}/accept-assessment-score`, ownerToken, {});
    assert.equal(accepted.status, 200);
    saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.appliedScoreSource, "assessment");
    assert.equal(saved.pendingAssessmentScore, null);
    assert.equal(saved.appliedAssessmentScore, 100, "average of both live applied assessments");
  });

  test("a changed score clears manager sign-off and notifies the manager", async (t) => {
    if (!server) return t.skip("database unreachable");
    const enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    await prisma.enrolment.update({ where: { id: enrolment.id }, data: { managerSignOff: true, managerSignOffBy: managerId, managerSignOffAt: new Date(), appliedAssessmentScore: 10, appliedScoreSource: "assessment" } });
    await submit(assessmentA, correctA);
    const saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.managerSignOff, false, "sign-off cleared");
    const notification = await prisma.notification.findFirst({ where: { userId: managerId, type: "manager_signoff_required" } });
    assert.ok(notification, "manager notified to re-confirm");
  });

  test("a superseded version no longer inflates the standing score", async (t) => {
    if (!server) return t.skip("database unreachable");
    const enrolment = await prisma.enrolment.findFirst({ where: { learnerId, courseId: ids.course } });
    await prisma.enrolment.update({ where: { id: enrolment.id }, data: { appliedAssessmentScore: 0, appliedScoreSource: "assessment" } });
    await post(`/content/${contentId}/progress`, learnerToken, { status: "completed" });
    let saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.appliedAssessmentScore, 100, "two passed live assessments average to 100");

    await prisma.assessment.update({ where: { id: assessmentA }, data: { supersededAt: new Date() } });
    await post(`/content/${contentId}/progress`, learnerToken, { status: "completed" });
    saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.appliedAssessmentScore, 100, "only the live assessment counts (it passed)");
    // Prove the superseded row is excluded: make the live one unpassed.
    await prisma.assessmentAttempt.deleteMany({ where: { assessmentId: assessmentB, enrolmentId: enrolment.id } });
    await post(`/content/${contentId}/progress`, learnerToken, { status: "completed" });
    saved = await prisma.enrolment.findUnique({ where: { id: enrolment.id } });
    assert.equal(saved.appliedAssessmentScore, 0, "superseded A cannot inflate the score");
  });
});
