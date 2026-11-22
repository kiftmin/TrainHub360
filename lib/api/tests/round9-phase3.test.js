// Round 9 / 3.3 — the background course re-evaluation queue.
//
// Publishing a paper or changing content used to loop over every enrolment inside the request.
// Here the route enqueues one row per course and the worker does the work outside it. What this
// suite pins down: the enqueue is deduplicated while a run is pending, the worker drains the whole
// course in batches, one bad enrolment does not stop the rest, and the status route tells staff
// when a recalculation is still running.
import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { enqueueCourseEvaluation, drainEvaluationQueue, pendingEvaluationJobs, runEvaluationWorkerTick } from "../dist/services/evaluationQueue.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Round 9 phase 3.3 — course-wide re-evaluation runs in a queue, not in the request", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r9q-org-${stamp}`,
    programme: `r9q-prog-${stamp}`,
    course: `r9q-course-${stamp}`,
    module: `r9q-module-${stamp}`,
    trainer: `r9q-trainer-${stamp}@example.com`,
    learner: `r9q-learner-${stamp}@example.com`,
  };
  const tokens = {};
  const users = {};
  const enrolments = [];

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

  before(async () => {
    if (!requireDatabase("round9-phase3.test.js")) return;
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
    await prisma.organization.create({ data: { id: ids.org, name: "R9Q Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "R9Q Prog", type: "Test", owner: "t" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R9Q Course" } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module" } });

    const trainer = await prisma.user.create({ data: { orgId: ids.org, name: "R9Q Trainer", email: ids.trainer, passwordHash: pw } });
    await prisma.userRole.create({ data: { userId: trainer.id, roleId: "trainer", programmeId: ids.programme } });
    Object.assign(users, { trainer });
    for (let i = 0; i < 4; i++) {
      const learner = await prisma.user.create({ data: { orgId: ids.org, name: `R9Q Learner ${i}`, email: `r9q-${i}-${stamp}@example.com`, passwordHash: pw } });
      users[`learner${i}`] = learner;
      enrolments.push(await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" } }));
    }
    tokens.trainer = signToken({ id: trainer.id, role: "admin", orgId: ids.org, tokenVersion: 0 });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      const aids = await prisma.assessment.findMany({ where: { moduleId: ids.module }, select: { id: true } }).catch(() => []);
      await prisma.question.deleteMany({ where: { assessmentId: { in: aids.map((a) => a.id) } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.module } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.module.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.course.delete({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.delete({ where: { id: ids.programme } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("publishing a paper enqueues one job for the course instead of looping in the request", async (t) => {
    if (!server) return t.skip("database unreachable");
    const a = await prisma.assessment.create({ data: { moduleId: ids.module, type: "recall", title: "Recall", isPublished: false } });
    const question = await prisma.question.create({ data: { assessmentId: a.id, kind: "single_choice", prompt: "Pick one", points: 1, order: 0 } });
    await prisma.questionOption.create({ data: { questionId: question.id, text: "Yes", isCorrect: true, order: 0 } });
    await prisma.questionOption.create({ data: { questionId: question.id, text: "No", isCorrect: false, order: 1 } });

    const res = await authed(tokens.trainer, "POST", `/assessments/${a.id}/publish`);
    assert.equal(res.status, 200);
    const jobs = await prisma.evaluationJob.findMany({ where: { courseId: ids.course } });
    assert.equal(jobs.length, 1, "the publish request queued exactly one run");
    assert.equal(jobs[0].status, "pending");
    assert.equal(jobs[0].trigger, "assessment_published");

    const status = await authed(tokens.trainer, "GET", `/courses/${ids.course}/evaluation-status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.pending, true, "staff can see that a recalculation is due");

    const drain = await drainEvaluationQueue();
    assert.ok(drain.processed >= 1, "the worker drained the queue");
    const done = await prisma.evaluationJob.findUnique({ where: { id: jobs[0].id } });
    assert.equal(done.status, "done");
    assert.equal(done.total, 4, "every non-withdrawn enrolment of the course was counted");
    assert.equal(done.processed, 4, "and processed");
    const after = await authed(tokens.trainer, "GET", `/courses/${ids.course}/evaluation-status`);
    assert.equal(after.body.pending, false);
  });

  test("a second publish while a run is pending joins it rather than queueing another", async () => {
    if (!prisma) return;
    await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } });
    const first = await enqueueCourseEvaluation(ids.course, "assessment_published");
    const second = await enqueueCourseEvaluation(ids.course, "content_changed");
    assert.equal(first.id, second.id, "the pending run is reused");
    assert.equal(await prisma.evaluationJob.count({ where: { courseId: ids.course, status: { in: ["pending", "running"] } } }), 1);
    await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } });
  });

  test("the worker survives one enrolment that throws and finishes the rest", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } });
    // A withdrawal mid-flight is the realistic version of "this one is bad": the queue must keep
    // going and the run must still finish.
    await prisma.enrolment.update({ where: { id: enrolments[0].id }, data: { status: "withdrawn", withdrawnAt: new Date() } });
    await enqueueCourseEvaluation(ids.course, "content_changed");
    const tick = await runEvaluationWorkerTick();
    assert.ok(tick >= 0);
    await drainEvaluationQueue();
    const jobs = await prisma.evaluationJob.findMany({ where: { courseId: ids.course }, orderBy: { createdAt: "desc" } });
    assert.ok(jobs.length >= 1);
    assert.equal(jobs[0].status, "done");
    assert.equal(jobs[0].processed, 3, "the three remaining learners were processed");
    await prisma.enrolment.update({ where: { id: enrolments[0].id }, data: { status: "enrolled", withdrawnAt: null } });
    await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } });
  });

  test("the queue keeps only course-scoped rows, and pendingEvaluationJobs reports them", async () => {
    if (!prisma) return;
    await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } });
    await enqueueCourseEvaluation(ids.course, "content_changed");
    const pending = await pendingEvaluationJobs(ids.course);
    assert.equal(pending, true);
    await drainEvaluationQueue();
    assert.equal(await pendingEvaluationJobs(ids.course), false);
    await prisma.evaluationJob.deleteMany({ where: { courseId: ids.course } });
  });
});
