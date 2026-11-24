import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Feature 5.3 phase 1 — learner dashboard and data isolation", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `f53dash-${stamp}`;
  const ids = {
    orgA: `${prefix}-org-a`,
    orgB: `${prefix}-org-b`,
    programmeA: `${prefix}-programme-a`,
    programmeB: `${prefix}-programme-b`,
    courseA: `${prefix}-course-a`,
    courseB: `${prefix}-course-b`,
    moduleA: `${prefix}-module-a`,
    contentA: `${prefix}-content-a`,
    certificateA: `${prefix}-cert-a`,
    certificateOther: `${prefix}-cert-other`,
  };
  const users = {};
  const tokens = {};

  const authed = async (token, method, p, options = {}) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };

  before(async () => {
    if (!requireDatabase("feature53-phase1.test.js")) return;
    process.env.NODE_ENV = "test";
    const { default: app } = await import("../dist/index.js");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma, ["learner", "trainer"]);
    await prisma.organization.createMany({ data: [
      { id: ids.orgA, name: "F53 Org A" },
      { id: ids.orgB, name: "F53 Org B" },
    ] });
    await prisma.programme.createMany({ data: [
      { id: ids.programmeA, orgId: ids.orgA, name: "F53 Programme A", type: "Test", owner: "owner" },
      { id: ids.programmeB, orgId: ids.orgB, name: "F53 Programme B", type: "Test", owner: "owner" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.programmeA, title: "F53 Course A", appliedThreshold: 70 },
      { id: ids.courseB, programmeId: ids.programmeB, title: "F53 Course B", appliedThreshold: 70 },
    ] });
    for (const [key, name, orgId] of [
      ["learner", "F53 Learner", ids.orgA],
      ["otherLearner", "F53 Other Learner", ids.orgA],
      ["trainer", "F53 Trainer", ids.orgA],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.learner.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: users.otherLearner.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programmeA },
    ] });
    const enrolmentA = await prisma.enrolment.create({ data: {
      learnerId: users.learner.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled", progress: 25,
    } });
    await prisma.enrolment.create({ data: {
      learnerId: users.learner.id, courseId: ids.courseB, programmeId: ids.programmeB, status: "enrolled",
    } });
    await prisma.enrolment.create({ data: {
      learnerId: users.otherLearner.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled",
    } });
    await prisma.module.create({ data: { id: ids.moduleA, courseId: ids.courseA, title: "F53 Module", order: 1 } });
    await prisma.contentItem.create({ data: {
      id: ids.contentA, orgId: ids.orgA, moduleId: ids.moduleA, type: "external_link", title: "F53 Evidence", completionMode: "trainer_verified",
    } });
    await prisma.contentProgress.create({ data: {
      enrolmentId: enrolmentA.id, contentItemId: ids.contentA, status: "pending_verification", evidenceNote: "Please verify",
    } });
    await prisma.notification.create({ data: {
      userId: users.learner.id, orgId: ids.orgA, type: "test", title: "F53 Dashboard Notification", body: "Visible", link: "/my-learning",
    } });
    await prisma.certificate.create({ data: {
      id: ids.certificateA, learnerId: users.learner.id, courseId: ids.courseA, enrolmentId: enrolmentA.id, status: "active",
    } });
    await prisma.certificate.create({ data: {
      id: ids.certificateOther, learnerId: users.otherLearner.id, courseId: ids.courseA, status: "revoked",
    } });
    for (const key of Object.keys(users)) {
      tokens[key] = signToken({ id: users[key].id, role: "member", orgId: ids.orgA, tokenVersion: 0 });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.certificate.deleteMany({ where: { id: { in: [ids.certificateA, ids.certificateOther] } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
      await prisma.contentProgress.deleteMany({ where: { contentItemId: ids.contentA } }).catch(() => null);
      await prisma.contentItem.deleteMany({ where: { id: ids.contentA } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: ids.moduleA } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programmeA, ids.programmeB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("learner dashboard ignores identity and org query overrides and returns only own data", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learner, "GET", `/me/learner-dashboard?orgId=${ids.orgB}&learnerId=${users.otherLearner.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.learner.id, users.learner.id);
    assert.deepEqual(res.body.courses.map((c) => c.courseId), [ids.courseA]);
    assert.equal(res.body.summary.assignedCourses, 1);
    assert.ok(res.body.pendingVerifications.some((p) => p.contentTitle === "F53 Evidence"));
    assert.deepEqual(res.body.certificates.map((c) => c.id), [ids.certificateA]);
    assert.ok(res.body.notifications.some((n) => n.title === "F53 Dashboard Notification"));
    assert.ok(res.body.nextActions.some((a) => a.type === "trainer_verification"));
  });

  test("empty learner dashboard returns a safe zero state", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "GET", "/me/learner-dashboard");
    assert.equal(res.status, 200);
    assert.equal(res.body.learner.id, users.trainer.id);
    assert.deepEqual(res.body.courses, []);
    assert.deepEqual(res.body.certificates, []);
    assert.equal(res.body.summary.assignedCourses, 0);
    assert.equal(res.body.summary.completedCourses, 0);
  });

  test("certificate print is self-or-staff only", async (t) => {
    if (!server) return t.skip("database unreachable");
    const own = await authed(tokens.learner, "GET", `/certificates/${ids.certificateA}/print`);
    assert.equal(own.status, 200);
    assert.match(own.body, /ACTIVE/);
    assert.match(own.body, /F53 Course A/);
    const other = await authed(tokens.learner, "GET", `/certificates/${ids.certificateOther}/print`);
    assert.equal(other.status, 403);
  });

  test("certificate list is identity-scoped for non-staff", async (t) => {
    if (!server) return t.skip("database unreachable");
    const learner = await authed(tokens.learner, "GET", "/certificates");
    assert.equal(learner.status, 200);
    assert.deepEqual(learner.body.map((c) => c.id), [ids.certificateA]);
    const other = await authed(tokens.otherLearner, "GET", "/certificates");
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.map((c) => c.id), [ids.certificateOther]);
  });

  test("enrolments and bookings cannot be enumerated with query parameter overrides", async (t) => {
    if (!server) return t.skip("database unreachable");
    const enrolments = await authed(tokens.learner, "GET", `/enrolments?learnerId=${users.otherLearner.id}&orgId=${ids.orgB}`);
    assert.equal(enrolments.status, 200);
    const enrolmentLearnerIds = new Set(enrolments.body.map((e) => e.learnerId));
    assert.ok(enrolmentLearnerIds.has(users.learner.id));
    assert.ok(!enrolmentLearnerIds.has(users.otherLearner.id));
    assert.ok(!enrolments.body.some((e) => e.courseId === ids.courseB));

    await prisma.booking.create({ data: {
      trainer: "F53 Trainer", trainerId: users.trainer.id, learnerId: users.otherLearner.id,
      orgId: ids.orgA, date: "2026-12-01", time: "10:00", startsAt: new Date("2026-12-01T10:00:00Z"),
    } });
    try {
      const bookings = await authed(tokens.learner, "GET", `/bookings?learnerId=${users.otherLearner.id}`);
      assert.equal(bookings.status, 200);
      assert.deepEqual(bookings.body, []);
    } finally {
      await prisma.booking.deleteMany({ where: { trainerId: users.trainer.id, learnerId: users.otherLearner.id } });
    }
  });
});
