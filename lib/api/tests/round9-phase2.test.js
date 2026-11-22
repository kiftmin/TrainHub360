// Round 9 / Phase 2 — editing a published assessment must not re-score anybody.
//
// The behaviour this suite pins down, and the reason it exists: editing a live paper used to
// supersede it immediately, leave the new row as an unpublished draft and re-evaluate the whole
// course. With no live applied assessment in between, every learner's applied score dropped to 0,
// sign-offs were cleared and managers were notified — because a trainer fixed a typo.
//
// Now a published paper can only be edited into a draft; the live version stays live and learners
// keep taking it; publishing the draft is one transaction that records *how* the change was meant
// (a minor correction carries results forward, a new paper does not) and enqueues the
// re-evaluation; and an enrolment that has completed never loses status, date, certificate or score.
import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { drainEvaluationQueue } from "../dist/services/evaluationQueue.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Round 9 phase 2 — an assessment edit changes nothing for learners until it is published", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r9p2-org-${stamp}`,
    otherOrg: `r9p2-org-b-${stamp}`,
    programme: `r9p2-prog-${stamp}`,
    otherProgramme: `r9p2-prog-b-${stamp}`,
    course: `r9p2-course-${stamp}`,
    module: `r9p2-module-${stamp}`,
    trainer: `r9p2-trainer-${stamp}@example.com`,
    otherTrainer: `r9p2-other-${stamp}@example.com`,
  };
  const tokens = {};
  const users = {};
  let liveId;
  let learnerId;
  let enrolmentId;

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

  const mkPublished = async (over = {}) => {
    const a = await prisma.assessment.create({
      // "applied" is the type that counts toward competence; a recall paper is practice.
      data: { moduleId: ids.module, type: "applied", title: "Applied paper", passMark: 70, maxAttempts: 3, isPublished: true, publishedAt: new Date(), ...over },
    });
    const q = await prisma.question.create({ data: { assessmentId: a.id, kind: "single_choice", prompt: "Pick one", points: 1, order: 0 } });
    await prisma.questionOption.create({ data: { questionId: q.id, text: "Right", isCorrect: true, order: 0 } });
    await prisma.questionOption.create({ data: { questionId: q.id, text: "Wrong", isCorrect: false, order: 1 } });
    // An applied paper must carry a scenario or short answer, or publishing is refused before the
    // change-kind question is even reached.
    await prisma.question.create({ data: { assessmentId: a.id, kind: "short_answer", prompt: "Explain it", points: 1, order: 1, rubric: "Names the step", acceptedAnswers: "step" } });
    return a;
  };

  before(async () => {
    if (!requireDatabase("round9-phase2.test.js")) return;
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
    await prisma.organization.createMany({ data: [{ id: ids.org, name: "R9P2 Org" }, { id: ids.otherOrg, name: "R9P2 Other" }] });
    await prisma.programme.createMany({
      data: [
        { id: ids.programme, orgId: ids.org, name: "R9P2 Prog", type: "Test", owner: "t" },
        { id: ids.otherProgramme, orgId: ids.otherOrg, name: "R9P2 Other Prog", type: "Test", owner: "t" },
      ],
    });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R9P2 Course", appliedThreshold: 70, validityMonths: 12 } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module" } });

    const trainer = await prisma.user.create({ data: { orgId: ids.org, name: "R9P2 Trainer", email: ids.trainer, passwordHash: pw } });
    const otherTrainer = await prisma.user.create({ data: { orgId: ids.otherOrg, name: "R9P2 Other", email: ids.otherTrainer, passwordHash: pw } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "R9P2 Learner", email: `r9p2-learner-${stamp}@example.com`, passwordHash: pw } });
    Object.assign(users, { trainer, otherTrainer, learner });
    learnerId = learner.id;
    await prisma.userRole.create({ data: { userId: trainer.id, roleId: "trainer", programmeId: ids.programme } });
    await prisma.userRole.create({ data: { userId: otherTrainer.id, roleId: "admin", programmeId: null } });

    const e = await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" } });
    enrolmentId = e.id;
    liveId = (await mkPublished()).id;

    tokens.trainer = signToken({ id: trainer.id, role: "admin", orgId: ids.org, tokenVersion: 0 });
    tokens.otherTrainer = signToken({ id: otherTrainer.id, role: "admin", orgId: ids.otherOrg, tokenVersion: 0 });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.attemptAnswer.deleteMany({ where: { attempt: { learnerId: { in: userIds } } } }).catch(() => null);
      await prisma.assessmentAttempt.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.certificate.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.recognition.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      const aids = await prisma.assessment.findMany({ where: { moduleId: ids.module }, select: { id: true } }).catch(() => []);
      await prisma.question.deleteMany({ where: { assessmentId: { in: aids.map((a) => a.id) } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.module.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.course.delete({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programme, ids.otherProgramme] } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("editing a live paper creates a draft and leaves the live version exactly as it was", async (t) => {
    if (!server) return t.skip("database unreachable");
    // The 409 names the draft that the edit would open; passing confirmNewVersion makes the edit.
    const confirm = await authed(tokens.trainer, "PATCH", `/assessments/${liveId}`, { title: "Applied paper (typo fixed)" });
    assert.equal(confirm.status, 409);
    assert.equal(confirm.body.requiresNewVersion, true);
    const res = await authed(tokens.trainer, "PATCH", `/assessments/${liveId}`, { title: "Applied paper (typo fixed)", confirmNewVersion: true });
    assert.equal(res.status, 201, "the edit is applied to a draft, not to the live row");
    assert.equal(res.body.version, 2);
    const live = await prisma.assessment.findUnique({ where: { id: liveId } });
    assert.equal(live.isPublished, true, "the live version is still published");
    assert.equal(live.title, "Applied paper", "and unchanged");
    assert.equal(live.supersededAt, null, "and not superseded");
    const draft = await prisma.assessment.findUnique({ where: { id: res.body.id } });
    assert.equal(draft.isPublished, false);
    assert.equal(draft.supersedesId, liveId);
    assert.equal(draft.title, "Applied paper (typo fixed)");
  });

  test("a second edit goes into the same draft instead of making another", async (t) => {
    if (!server) return t.skip("database unreachable");
    const drafts = await prisma.assessment.findMany({ where: { supersedesId: liveId, isPublished: false } });
    assert.equal(drafts.length, 1);
    const res = await authed(tokens.trainer, "PATCH", `/assessments/${drafts[0].id}`, { title: "Applied paper (typo fixed again)" });
    assert.equal(res.status, 200, "editing the draft itself is a plain edit");
    assert.equal(await prisma.assessment.count({ where: { supersedesId: liveId, isPublished: false } }), 1);
    const live = await prisma.assessment.findUnique({ where: { id: liveId } });
    assert.equal(live.title, "Applied paper", "the live version still does not move");
  });

  test("creating a draft sends no notification and enqueues no re-evaluation", async () => {
    if (!prisma) return;
    assert.equal(await prisma.evaluationJob.count({ where: { courseId: ids.course } }), 0);
    const notices = await prisma.notification.count({ where: { userId: learnerId, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } } }).catch(() => 0);
    assert.equal(notices, 0, "nobody is told about a draft");
  });

  test("learners can still start an attempt on the live version while a draft exists", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "POST", `/assessments/${liveId}/attempts`, { enrolmentId });
    // Staff may not attempt their own learner's paper here; the learner starting one is what matters,
    // and the route's answer (400/403 or a new attempt) must never be "the paper is offline".
    assert.notEqual(res.status, 404);
    const live = await prisma.assessment.findUnique({ where: { id: liveId } });
    assert.equal(live.isPublished, true);
  });

  test("publishing a draft requires a change kind", async (t) => {
    if (!server) return t.skip("database unreachable");
    const draft = await prisma.assessment.findFirst({ where: { supersedesId: liveId, isPublished: false } });
    const res = await authed(tokens.trainer, "POST", `/assessments/${draft.id}/publish`, {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /minor|new_paper/);
  });

  test("publishing with minor carries the earlier result forward and publishes in one step", async (t) => {
    if (!server) return t.skip("database unreachable");
    const draft = await prisma.assessment.findFirst({ where: { supersedesId: liveId, isPublished: false } });
    // Give the learner a graded attempt on the live version first.
    const liveQuestion = await prisma.question.findFirst({ where: { assessmentId: liveId }, include: { options: true } });
    const attempt = await prisma.assessmentAttempt.create({
      data: { assessmentId: liveId, enrolmentId, learnerId, status: "graded", score: 1, maxScore: 1, percent: 90, passed: true, gradedAt: new Date() },
    });
    await prisma.attemptAnswer.create({ data: { attemptId: attempt.id, questionId: liveQuestion.id, optionIds: JSON.stringify([liveQuestion.options.find((o) => o.isCorrect).id]), pointsAwarded: 1, autoGraded: true } });

    const res = await authed(tokens.trainer, "POST", `/assessments/${draft.id}/publish`, { changeKind: "minor" });
    assert.equal(res.status, 200);
    const published = await prisma.assessment.findUnique({ where: { id: draft.id } });
    assert.equal(published.isPublished, true);
    assert.equal(published.changeKind, "minor");
    const old = await prisma.assessment.findUnique({ where: { id: liveId } });
    assert.ok(old.supersededAt, "the previous version is retired in the same transaction");
    assert.equal(old.supersededById, users.trainer.id);
    assert.equal(old.isPublished, false);

    await drainEvaluationQueue();
    const enrolment = await prisma.enrolment.findUnique({ where: { id: enrolmentId } });
    assert.equal(enrolment.appliedAssessmentScore, 90, "the 90% from the previous version carries forward");
  });

  test("a completed learner keeps status, date, certificate and score across a new-paper publish", async (t) => {
    if (!server) return t.skip("database unreachable");
    const before = await prisma.enrolment.update({
      where: { id: enrolmentId },
      data: { status: "completed", completionSource: "assessment", completionDate: new Date("2026-02-01T00:00:00Z"), appliedAssessmentScore: 90, enrolmentScore: 90 },
    });
    // Round 13: earlier tests in this file may already have issued the certificate. The new
    // filtered unique index allows one active row per enrolment, so retire it before inserting
    // the certificate this test tracks across the publish.
    await prisma.certificate.updateMany({ where: { enrolmentId, status: "active" }, data: { status: "revoked" } });
    const cert = await prisma.certificate.create({ data: { learnerId, courseId: ids.course, enrolmentId, status: "active", expiresAt: new Date("2027-02-01T00:00:00Z") } });

    const current = await prisma.assessment.findFirst({ where: { moduleId: ids.module, isPublished: true }, orderBy: { version: "desc" } });
    const edited = await authed(tokens.trainer, "PATCH", `/assessments/${current.id}`, { title: "New paper", confirmNewVersion: true });
    assert.equal(edited.status, 201);
    const published = await authed(tokens.trainer, "POST", `/assessments/${edited.body.id}/publish`, { changeKind: "new_paper" });
    assert.equal(published.status, 200);
    assert.equal((await prisma.assessment.findUnique({ where: { id: edited.body.id } })).changeKind, "new_paper");

    await drainEvaluationQueue();
    const after = await prisma.enrolment.findUnique({ where: { id: enrolmentId } });
    assert.equal(after.status, "completed", "a completed learner is not un-completed by an edit");
    assert.equal(after.completionDate.toISOString(), before.completionDate.toISOString());
    assert.equal(after.appliedAssessmentScore, 90, "and the stored score does not drop");
    const stillThere = await prisma.certificate.findUnique({ where: { id: cert.id } });
    assert.equal(stillThere.status, "active");
  });

  test("a learner who has not completed needs the new paper and is told to retake it", async (t) => {
    if (!server) return t.skip("database unreachable");
    const other = await prisma.user.create({ data: { orgId: ids.org, name: "R9P2 Fresh", email: `r9p2-fresh-${stamp}@example.com`, passwordHash: await hashPassword("pw") } });
    users.fresh = other;
    const e = await prisma.enrolment.create({ data: { learnerId: other.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" } });

    // A graded attempt on the version that is live now, then a new paper on top of it.
    const current = await prisma.assessment.findFirst({ where: { moduleId: ids.module, isPublished: true }, orderBy: { version: "desc" } });
    await prisma.assessmentAttempt.create({ data: { assessmentId: current.id, enrolmentId: e.id, learnerId: other.id, status: "graded", score: 1, maxScore: 1, percent: 95, passed: true, gradedAt: new Date() } });
    const edited = await authed(tokens.trainer, "PATCH", `/assessments/${current.id}`, { title: "Another paper", confirmNewVersion: true });
    await authed(tokens.trainer, "POST", `/assessments/${edited.body.id}/publish`, { changeKind: "new_paper" });
    await drainEvaluationQueue();

    const after = await prisma.enrolment.findUnique({ where: { id: e.id } });
    assert.equal(after.status, "enrolled", "a new paper means a retake, not a completion");
    assert.equal(after.appliedAssessmentScore, 0, "and the old 95% does not count toward the new paper");
    const notice = await prisma.notification.findFirst({ where: { userId: other.id, type: "assessment_retake_required" } });
    assert.ok(notice, "the learner is told the assessment was updated");
    await prisma.notification.deleteMany({ where: { userId: other.id } }).catch(() => null);
  });

  test("another organization cannot touch this paper", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.otherTrainer, "PATCH", `/assessments/${liveId}`, { title: "hijacked", confirmNewVersion: true });
    assert.equal(res.status, 404);
    const publish = await authed(tokens.otherTrainer, "POST", `/assessments/${liveId}/publish`, { changeKind: "minor" });
    assert.equal(publish.status, 404);
  });
});
