// Round 9 / Phase 1 — nothing about an enrolment's outcome comes from the client.
//
// The hole this suite exists to close: `PATCH /enrolments/:id` used to accept any key in the body
// and let the learner set their own status, so a learner could send
// `{ status: "completed", reason: "a long enough reason" }` and be handed a certificate and a
// streak for content and assessments they had never done. The scores were also computed from
// `{ ...current, ...patch }`, so a `deadlineDate` in the request moved `timelinessScore`.
import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { issueCertificateForEnrolment } from "../dist/services/certificates.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Round 9 phase 1 — an enrolment outcome is never taken from the client", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r9p1-org-${stamp}`,
    otherOrg: `r9p1-org-b-${stamp}`,
    programme: `r9p1-prog-${stamp}`,
    otherProgramme: `r9p1-prog-b-${stamp}`,
    course: `r9p1-course-${stamp}`,
    otherCourse: `r9p1-course-b-${stamp}`,
    module: `r9p1-module-${stamp}`,
    learner: `r9p1-learner-${stamp}@example.com`,
    otherLearner: `r9p1-learner-b-${stamp}@example.com`,
    trainer: `r9p1-trainer-${stamp}@example.com`,
    manager: `r9p1-manager-${stamp}@example.com`,
    otherTrainer: `r9p1-other-trainer-${stamp}@example.com`,
  };
  const tokens = {};
  const users = {};
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
  const reload = () => prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } });

  before(async () => {
    if (!requireDatabase("round9-phase1.test.js")) return;
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
    await prisma.organization.createMany({ data: [{ id: ids.org, name: "R9P1 Org" }, { id: ids.otherOrg, name: "R9P1 Other" }] });
    await prisma.programme.createMany({
      data: [
        { id: ids.programme, orgId: ids.org, name: "R9P1 Prog", type: "Test", owner: "t" },
        { id: ids.otherProgramme, orgId: ids.otherOrg, name: "R9P1 Other Prog", type: "Test", owner: "t" },
      ],
    });
    // A validity window makes the course certificate-requiring, so issue/no-issue is observable.
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R9P1 Course", appliedThreshold: 70, validityMonths: 12 } });
    await prisma.course.create({ data: { id: ids.otherCourse, programmeId: ids.otherProgramme, title: "Other Course" } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module" } });

    const mkUser = async (orgId, email, name, extra = {}) => prisma.user.create({ data: { orgId, name, email, passwordHash: pw, ...extra } });
    const manager = await mkUser(ids.org, ids.manager, "R9P1 Manager");
    const learner = await mkUser(ids.org, ids.learner, "R9P1 Learner", { managerId: manager.id });
    const otherLearner = await mkUser(ids.org, ids.otherLearner, "R9P1 Other Learner");
    const trainer = await mkUser(ids.org, ids.trainer, "R9P1 Trainer");
    const otherTrainer = await mkUser(ids.otherOrg, ids.otherTrainer, "R9P1 Other Trainer");
    Object.assign(users, { manager, learner, otherLearner, trainer, otherTrainer });

    await prisma.userRole.create({ data: { userId: trainer.id, roleId: "trainer", programmeId: ids.programme } });
    await prisma.userRole.create({ data: { userId: otherTrainer.id, roleId: "admin", programmeId: null } });

    const e = await prisma.enrolment.create({
      data: {
        learnerId: learner.id,
        courseId: ids.course,
        programmeId: ids.programme,
        status: "enrolled",
        appliedAssessmentScore: 62,
        applicationScore: 74,
        deadlineDate: new Date("2026-01-15T00:00:00Z"),
        timelinessScore: 50,
        enrolmentScore: 55.2,
      },
    });
    enrolmentId = e.id;

    tokens.learner = signToken({ id: learner.id, role: "learner", orgId: ids.org, tokenVersion: 0 });
    tokens.otherLearner = signToken({ id: otherLearner.id, role: "learner", orgId: ids.org, tokenVersion: 0 });
    tokens.trainer = signToken({ id: trainer.id, role: "admin", orgId: ids.org, tokenVersion: 0 });
    // The read-only stakeholder role is enforced before any route: the line manager here is an
    // ordinary member whose only extra right is the sign-off (its own rule checks managerId).
    tokens.manager = signToken({ id: manager.id, role: "learner", orgId: ids.org, tokenVersion: 0 });
    tokens.otherTrainer = signToken({ id: otherTrainer.id, role: "admin", orgId: ids.otherOrg, tokenVersion: 0 });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.certificate.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.recognition.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { entityId: enrolmentId } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.module.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.course, ids.otherCourse] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programme, ids.otherProgramme] } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // 1.1 — the learner cannot complete themselves, however good the reason looks.
  test("a learner completing themselves gets 403 and the enrolment does not move", async (t) => {
    if (!server) return t.skip("database unreachable");
    const before = await reload();
    const res = await authed(tokens.learner, "PATCH", `/enrolments/${enrolmentId}`, {
      status: "completed",
      reason: "I have finished everything, honestly",
    });
    // status is a real field of the endpoint, so the learner's role is what refuses it.
    assert.equal(res.status, 403);
    assert.match(res.body.error, /may not set status/);
    const after = await reload();
    assert.equal(after.status, before.status);
    assert.equal(after.completionDate, null);
    assert.equal(after.completionSource, null);
    const certificates = await prisma.certificate.count({ where: { enrolmentId } });
    assert.equal(certificates, 0, "no certificate may be issued from a refused status change");
    const recognitions = await prisma.recognition.count({ where: { userId: users.learner.id } });
    assert.equal(recognitions, 0, "no streak recognition may be issued from a refused status change");
  });

  // 1.1 — a deadline in the body used to move timelinessScore. It must not be reachable at all.
  test("a learner cannot move completionDate or deadlineDate, and the stored scores are untouched", async (t) => {
    if (!server) return t.skip("database unreachable");
    const before = await reload();
    const a = await authed(tokens.learner, "PATCH", `/enrolments/${enrolmentId}`, { completionDate: "2026-01-01T00:00:00Z" });
    assert.equal(a.status, 403);
    const b = await authed(tokens.learner, "PATCH", `/enrolments/${enrolmentId}`, { deadlineDate: "2030-01-01T00:00:00Z" });
    assert.equal(b.status, 403);
    const after = await reload();
    assert.deepEqual(
      { applied: after.appliedAssessmentScore, deadline: after.deadlineDate, timeliness: after.timelinessScore, score: after.enrolmentScore },
      { applied: before.appliedAssessmentScore, deadline: before.deadlineDate, timeliness: before.timelinessScore, score: before.enrolmentScore },
    );
  });

  // 1.1 — scope: a trainer of another programme, in another organization, sees nothing.
  test("a trainer of another programme cannot override this enrolment", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.otherTrainer, "PATCH", `/enrolments/${enrolmentId}`, {
      status: "completed",
      reason: "closing it out from the outside",
    });
    assert.equal(res.status, 404, "organization scope hides the row rather than naming it");
  });

  // 1.1 — an unknown key is an error, never a silent no-op.
  test("an unknown field is a 400 for staff too", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, { reviewCreditLockedAt: "2020-01-01T00:00:00Z" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unknown field/);
  });

  test("a score outside 0–100 and an unparseable date are refused", async (t) => {
    if (!server) return t.skip("database unreachable");
    const high = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, { appliedAssessmentScore: 130, reason: "a reason long enough" });
    assert.equal(high.status, 400);
    const bad = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, { completionDate: "not-a-date", reason: "a reason long enough" });
    assert.equal(bad.status, 400);
    const status = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, { status: "graded", reason: "a reason long enough" });
    assert.equal(status.status, 400);
  });

  // 1.1 + 1.2 — a staff override works, records "manual", and is audited.
  test("staff may complete with a reason: completionSource is manual and the override is audited", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, {
      status: "completed",
      reason: "evidence checked offline with the line manager",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.completionSource, "manual");
    const after = await reload();
    assert.equal(after.status, "completed");
    assert.equal(after.completionSource, "manual");
    assert.ok(after.completionDate, "a completion date is set when staff complete by hand");
    const audit = await prisma.auditLog.findFirst({ where: { entityId: enrolmentId, action: "ENROLMENT_STATUS_OVERRIDDEN" } });
    assert.ok(audit, "the override is in the audit trail");
    assert.match(audit.details, /manual/);
    const cert = await prisma.certificate.findFirst({ where: { enrolmentId }, orderBy: { expiresAt: "desc" } });
    assert.ok(cert, "a manual completion by staff does issue the certificate it justifies");
  });

  // 1.1 — the reason rule still applies to a staff override.
  test("staff without a long enough reason cannot override", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, { appliedAssessmentScore: 90, reason: "short" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least 10 characters/);
  });

  // 1.1 — the sign-off belongs to the line manager, and to nobody else.
  test("only the learner's line manager can sign off", async (t) => {
    if (!server) return t.skip("database unreachable");
    const notManager = await authed(tokens.trainer, "PATCH", `/enrolments/${enrolmentId}`, { managerSignOff: true });
    assert.equal(notManager.status, 403, "managerSignOff belongs to the line manager alone");
    const ok = await authed(tokens.manager, "PATCH", `/enrolments/${enrolmentId}`, { managerSignOff: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.managerSignOff, true);
    const otherLearner = await authed(tokens.otherLearner, "PATCH", `/enrolments/${enrolmentId}`, { managerSignOff: true });
    assert.equal(otherLearner.status, 403);
  });

  // 1.2 — defence in depth: no completion source, no certificate.
  test("issueCertificateForEnrolment refuses an enrolment with no completion source", async () => {
    if (!prisma) return;
    const bare = await prisma.enrolment.create({
      data: { learnerId: users.otherLearner.id, courseId: ids.course, programmeId: ids.programme, status: "completed", completionSource: null },
    });
    const result = await issueCertificateForEnrolment(bare.id);
    assert.equal(result.issued, false);
    assert.equal(result.reason, "no completion source");
    assert.equal(await prisma.certificate.count({ where: { enrolmentId: bare.id } }), 0);
    await prisma.enrolment.delete({ where: { id: bare.id } }).catch(() => null);
  });
});
