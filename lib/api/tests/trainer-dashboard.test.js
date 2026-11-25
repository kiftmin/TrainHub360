import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { db } from "../dist/db.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Trainer dashboard — scoped overview", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `trainerdash-${stamp}`;
  const ids = {
    orgA: `${prefix}-org-a`,
    orgB: `${prefix}-org-b`,
    progA: `${prefix}-prog-a`,
    progB: `${prefix}-prog-b`,
    progEmpty: `${prefix}-prog-empty`,
    progOther: `${prefix}-prog-other`,
    progOrgB: `${prefix}-prog-org-b`,
    courseA: `${prefix}-course-a`,
    courseB: `${prefix}-course-b`,
    courseOther: `${prefix}-course-other`,
    courseOrgB: `${prefix}-course-org-b`,
    sessionA: `${prefix}-session-a`,
    sessionB: `${prefix}-session-b`,
    sessionOther: `${prefix}-session-other`,
    sessionOrgB: `${prefix}-session-org-b`,
    sessionPast: `${prefix}-session-past`,
  };
  const users = {};
  const tokens = {};
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);

  const authed = (token, method, p) => fetch(`${baseUrl}/api${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const bodyOf = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  before(async () => {
    if (!requireDatabase("trainer-dashboard.test.js")) return;
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
    await seedRoles(prisma, ["learner", "trainer", "admin", "owner"]);
    await prisma.organization.createMany({ data: [
      { id: ids.orgA, name: "Trainer dashboard org A" },
      { id: ids.orgB, name: "Trainer dashboard org B" },
    ] });
    await prisma.programme.createMany({ data: [
      { id: ids.progA, orgId: ids.orgA, name: "Alpha programme", type: "Test", owner: "Owner" },
      { id: ids.progB, orgId: ids.orgA, name: "Beta programme", type: "Test", owner: "Owner" },
      { id: ids.progEmpty, orgId: ids.orgA, name: "Empty programme", type: "Test", owner: "Owner" },
      { id: ids.progOther, orgId: ids.orgA, name: "Unassigned programme", type: "Test", owner: "Owner" },
      { id: ids.progOrgB, orgId: ids.orgB, name: "Other org programme", type: "Test", owner: "Owner" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.progA, title: "Alpha course", appliedThreshold: 70 },
      { id: ids.courseB, programmeId: ids.progB, title: "Beta course", appliedThreshold: 70 },
      { id: ids.courseOther, programmeId: ids.progOther, title: "Unassigned course", appliedThreshold: 70 },
      { id: ids.courseOrgB, programmeId: ids.progOrgB, title: "Other org course", appliedThreshold: 70 },
    ] });
    for (const [key, name, orgId] of [
      ["trainerMulti", "Multi Trainer", ids.orgA],
      ["trainerOne", "Single Trainer", ids.orgA],
      ["trainerEmpty", "Empty Trainer", ids.orgA],
      ["trainerNoGrant", "No Grant", ids.orgA],
      ["learner", "Learner One", ids.orgA],
      ["learnerTwo", "Learner Two", ids.orgA],
      ["learnerOther", "Learner Other", ids.orgA],
      ["learnerOrgB", "Learner Org B", ids.orgB],
      ["orgOwner", "Org Owner", ids.orgA],
      ["orgAdmin", "Org Admin", ids.orgA],
      ["programmeAdmin", "Programme Admin", ids.orgA],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.trainerMulti.id, roleId: "trainer", programmeId: ids.progA },
      { userId: users.trainerMulti.id, roleId: "trainer", programmeId: ids.progB },
      { userId: users.trainerOne.id, roleId: "trainer", programmeId: ids.progA },
      { userId: users.trainerEmpty.id, roleId: "trainer", programmeId: ids.progEmpty },
      { userId: users.learner.id, roleId: "learner", programmeId: ids.progA },
      { userId: users.learnerTwo.id, roleId: "learner", programmeId: ids.progB },
      { userId: users.learnerOther.id, roleId: "learner", programmeId: ids.progOther },
      { userId: users.learnerOrgB.id, roleId: "learner", programmeId: ids.progOrgB },
      { userId: users.orgOwner.id, roleId: "owner", programmeId: null },
      { userId: users.orgAdmin.id, roleId: "admin", programmeId: null },
      { userId: users.programmeAdmin.id, roleId: "admin", programmeId: ids.progA },
    ] });
    await prisma.course.updateMany({ where: { id: { in: [ids.courseA, ids.courseB, ids.courseOther, ids.courseOrgB] } }, data: { trainerId: users.trainerMulti.id } });
    await prisma.enrolment.createMany({ data: [
      { learnerId: users.learner.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled", progress: 40 },
      { learnerId: users.learnerTwo.id, courseId: ids.courseB, programmeId: ids.progB, status: "completed", progress: 100, completionDate: new Date() },
      { learnerId: users.learnerOther.id, courseId: ids.courseOther, programmeId: ids.progOther, status: "enrolled", progress: 10 },
      { learnerId: users.learnerOrgB.id, courseId: ids.courseOrgB, programmeId: ids.progOrgB, status: "enrolled", progress: 20 },
    ] });
    await prisma.session.createMany({ data: [
      { id: ids.sessionA, title: "Alpha session", programmeId: ids.progA, orgId: ids.orgA, trainerId: users.trainerMulti.id, trainer: users.trainerMulti.name, courseId: ids.courseA, date: future.toISOString().slice(0, 10), time: "10:00", startsAt: future, status: "scheduled" },
      { id: ids.sessionB, title: "Beta session", programmeId: ids.progB, orgId: ids.orgA, trainerId: users.trainerMulti.id, trainer: users.trainerMulti.name, courseId: ids.courseB, date: future.toISOString().slice(0, 10), time: "11:00", startsAt: future, status: "scheduled" },
      { id: ids.sessionOther, title: "Unassigned session", programmeId: ids.progOther, orgId: ids.orgA, trainerId: users.trainerMulti.id, trainer: users.trainerMulti.name, courseId: ids.courseOther, date: future.toISOString().slice(0, 10), time: "12:00", startsAt: future, status: "scheduled" },
      { id: ids.sessionOrgB, title: "Other org session", programmeId: ids.progOrgB, orgId: ids.orgB, trainerId: users.trainerMulti.id, trainer: users.trainerMulti.name, courseId: ids.courseOrgB, date: future.toISOString().slice(0, 10), time: "13:00", startsAt: future, status: "scheduled" },
      { id: ids.sessionPast, title: "Past session", programmeId: ids.progA, orgId: ids.orgA, trainerId: users.trainerMulti.id, trainer: users.trainerMulti.name, courseId: ids.courseA, date: past.toISOString().slice(0, 10), time: "09:00", startsAt: past, status: "scheduled" },
    ] });
    for (const [key, user] of Object.entries(users)) {
      tokens[key] = signToken({ id: user.id, role: "member", orgId: user.orgId, tokenVersion: 0 });
    }
    tokens.forgedTrainer = signToken({ id: users.trainerNoGrant.id, role: "trainer", orgId: ids.orgA, tokenVersion: 0 });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((user) => user.id);
      await prisma.sessionRSVP.deleteMany({ where: { session: { id: { in: Object.values(ids).filter((id) => id.includes("session")) } } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: { in: [ids.sessionA, ids.sessionB, ids.sessionOther, ids.sessionOrgB, ids.sessionPast] } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB, ids.courseOther, ids.courseOrgB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progB, ids.progEmpty, ids.progOther, ids.progOrgB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("anonymous callers receive 401", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(null, "GET", "/trainer/dashboard/summary");
    assert.equal(res.status, 401);
    await res.arrayBuffer();
  });

  test("organisation staff and non-trainers are denied", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const key of ["orgOwner", "orgAdmin", "programmeAdmin", "learner", "trainerNoGrant", "forgedTrainer"]) {
      const res = await authed(tokens[key], "GET", "/trainer/dashboard/summary");
      assert.equal(res.status, 403, `${key} must be denied`);
      assert.deepEqual(await bodyOf(res), { error: "trainer access required" });
    }
  });

  test("a trainer cannot use the organisation-wide dashboard", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const path of ["/dashboard/summary", "/kpi/summary"]) {
      const res = await authed(tokens.trainerMulti, "GET", path);
      assert.equal(res.status, 403, `${path} must stay org-staff-only`);
      await res.arrayBuffer();
    }
  });

  test("organisation owner and admin dashboards remain unchanged", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const key of ["orgOwner", "orgAdmin"]) {
      const res = await authed(tokens[key], "GET", "/dashboard/summary");
      assert.equal(res.status, 200);
      const body = await bodyOf(res);
      assert.ok(Array.isArray(body.weeklyActivity));
      assert.ok(Array.isArray(body.expiringItems));
    }
  });

  test("a trainer with one programme sees only that programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainerOne, "GET", "/trainer/dashboard/summary");
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.deepEqual(body.programmes.map((p) => p.id), [ids.progA]);
    assert.deepEqual(body.courses.map((c) => c.id), []);
    assert.deepEqual(body.enrolments.map((e) => e.id).length, 1);
    assert.ok(body.enrolments.every((e) => e.programmeId === ids.progA));
    assert.ok(body.learners.every((l) => l.programmeId === ids.progA));
    assert.ok(body.sessions.every((s) => s.programmeId === ids.progA));
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes("Beta programme"));
    assert.ok(!serialised.includes("Unassigned programme"));
    assert.ok(!serialised.includes("Other org programme"));
    assert.ok(!serialised.includes("budget"));
    assert.ok(!serialised.includes("complianceHealth"));
  });

  test("a trainer with multiple programmes sees all and only authorised programmes", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainerMulti, "GET", "/trainer/dashboard/summary");
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.deepEqual(body.programmes.map((p) => p.id).sort(), [ids.progA, ids.progB].sort());
    assert.deepEqual(body.courses.map((c) => c.id).sort(), [ids.courseA, ids.courseB].sort());
    assert.equal(body.summary.programmeCount, 2);
    assert.equal(body.summary.courseCount, 2);
    assert.equal(body.summary.learnerCount, 2);
    assert.equal(body.summary.enrolmentCount, 2);
    assert.equal(body.summary.upcomingSessionCount, 2);
    assert.deepEqual(body.sessions.map((s) => s.id).sort(), [ids.sessionA, ids.sessionB].sort());
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes(ids.progOther));
    assert.ok(!serialised.includes(ids.progOrgB));
    assert.ok(!serialised.includes("Learner Other"));
    assert.ok(!serialised.includes("Learner Org B"));
    assert.ok(!serialised.includes(ids.sessionPast));
  });

  test("client programme and organisation overrides are ignored", async (t) => {
    if (!server) return t.skip("database unreachable");
    const direct = await bodyOf(await authed(tokens.trainerMulti, "GET", "/trainer/dashboard/summary"));
    const overridden = await bodyOf(await authed(tokens.trainerMulti, "GET", `/trainer/dashboard/summary?programmeId=${ids.progOther}&orgId=${ids.orgB}`));
    assert.deepEqual(overridden, direct);
  });

  test("a trainer with grants but no data receives a safe zero state", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainerEmpty, "GET", "/trainer/dashboard/summary");
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.deepEqual(body.programmes.map((p) => p.id), [ids.progEmpty]);
    assert.deepEqual(body.courses, []);
    assert.deepEqual(body.learners, []);
    assert.deepEqual(body.enrolments, []);
    assert.deepEqual(body.sessions, []);
    assert.equal(body.summary.learnerCount, 0);
  });

  test("database failure returns an error instead of an empty dashboard", async (t) => {
    if (!server) return t.skip("database unreachable");
    const original = db.userRole.findMany;
    db.userRole.findMany = async () => {
      throw new Prisma.PrismaClientKnownRequestError("forced database outage", { code: "P1001", clientVersion: "5.22.0" });
    };
    try {
      const res = await authed(tokens.trainerOne, "GET", "/trainer/dashboard/summary");
      assert.equal(res.status, 503);
      const body = await bodyOf(res);
      assert.notDeepEqual(body, { programmes: [], courses: [], learners: [], enrolments: [], sessions: [] });
      assert.match(JSON.stringify(body), /service unavailable|MSSQL unreachable/);
    } finally {
      db.userRole.findMany = original;
    }
  });
});
