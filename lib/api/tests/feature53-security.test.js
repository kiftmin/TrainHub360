import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Feature 5.3 security — server-side authorisation", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `f53sec-${stamp}`;
  const ids = {
    orgA: `${prefix}-org-a`,
    orgB: `${prefix}-org-b`,
    progA: `${prefix}-prog-a`,
    progB: `${prefix}-prog-b`,
    progBOrgB: `${prefix}-prog-b2`,
    courseA: `${prefix}-course-a`,
    courseB: `${prefix}-course-b`,
    courseBOrgB: `${prefix}-course-b2`,
  };
  const users = {};
  const tokens = {};

  const authed = (token, method, p, body) => fetch(`${baseUrl}/api${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bodyOf = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  before(async () => {
    if (!requireDatabase("feature53-security.test.js")) return;
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
      { id: ids.orgA, name: "Security Org A" },
      { id: ids.orgB, name: "Security Org B" },
    ] });
    await prisma.programme.createMany({ data: [
      { id: ids.progA, orgId: ids.orgA, name: "Security Programme A", type: "Test", owner: "Owner A" },
      { id: ids.progB, orgId: ids.orgA, name: "Security Programme B", type: "Test", owner: "Owner A" },
      { id: ids.progBOrgB, orgId: ids.orgB, name: "Security Programme B2", type: "Test", owner: "Owner B" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.progA, title: "Course A", appliedThreshold: 70 },
      { id: ids.courseB, programmeId: ids.progB, title: "Course B", appliedThreshold: 70 },
      { id: ids.courseBOrgB, programmeId: ids.progBOrgB, title: "Course B2", appliedThreshold: 70 },
    ] });
    for (const [key, name, orgId] of [
      ["learnerA", "Learner A", ids.orgA],
      ["learnerA2", "Learner A2", ids.orgA],
      ["trainerA", "Trainer A", ids.orgA],
      ["adminOrgA", "Org Admin A", ids.orgA],
      ["adminProgA", "Programme Admin A", ids.orgA],
      ["ownerB", "Owner B", ids.orgB],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.learnerA.id, roleId: "learner", programmeId: ids.progA },
      { userId: users.learnerA2.id, roleId: "learner", programmeId: ids.progB },
      { userId: users.trainerA.id, roleId: "trainer", programmeId: ids.progA },
      { userId: users.adminOrgA.id, roleId: "owner", programmeId: null },
      { userId: users.adminProgA.id, roleId: "admin", programmeId: ids.progA },
      { userId: users.ownerB.id, roleId: "owner", programmeId: null },
    ] });
    await prisma.enrolment.createMany({ data: [
      { learnerId: users.learnerA.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" },
      { learnerId: users.learnerA2.id, courseId: ids.courseB, programmeId: ids.progB, status: "enrolled" },
    ] });
    for (const [key, user] of Object.entries(users)) {
      tokens[key] = signToken({ id: user.id, role: "member", orgId: user.orgId, tokenVersion: 0 });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.booking.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB, ids.courseBOrgB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progB, ids.progBOrgB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const managementRoutes = [
    "/dashboard/summary",
    "/kpi/summary",
    "/review-credit/settings",
    "/review-credit/export",
    `/organizations/${ids.orgA}/review-credits`,
    "/audit/logs",
    "/email-failures",
  ];

  test("unauthenticated callers cannot reach protected reporting routes", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const p of [...managementRoutes, "/me/learner-dashboard", "/workspace"]) {
      const res = await authed(null, "GET", p);
      assert.equal(res.status, 401, `${p} must require authentication`);
      await res.arrayBuffer();
    }
  });

  test("learners cannot reach organisation management reporting", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const p of managementRoutes) {
      const res = await authed(tokens.learnerA, "GET", p);
      assert.equal(res.status, 403, `${p} must deny learners`);
      const body = await bodyOf(res);
      assert.ok(!JSON.stringify(body).includes("Learner A"), `${p} must not return learner data`);
    }
  });

  test("programme staff cannot reach organisation-wide reporting", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const p of managementRoutes) {
      const res = await authed(tokens.adminProgA, "GET", p);
      assert.equal(res.status, 403, `${p} must deny programme-scoped staff`);
      await res.arrayBuffer();
    }
  });

  test("organisation staff retain access to their own reporting", async (t) => {
    if (!server) return t.skip("database unreachable");
    for (const p of managementRoutes) {
      const res = await authed(tokens.adminOrgA, "GET", p);
      assert.equal(res.status, 200, `${p} must allow org staff`);
      await res.arrayBuffer();
    }
  });

  test("organisation staff cannot read another organisation's review credits", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.adminOrgA, "GET", `/organizations/${ids.orgB}/review-credits`);
    assert.equal(res.status, 403);
    assert.deepEqual(await bodyOf(res), { error: "cross-organization access denied" });
  });

  test("learner dashboard is identity-scoped despite query overrides", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learnerA, "GET", `/me/learner-dashboard?learnerId=${users.learnerA2.id}&orgId=${ids.orgB}`);
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.equal(body.learner.id, users.learnerA.id);
    assert.ok(!JSON.stringify(body).includes(ids.orgB));
  });

  test("learners cannot enumerate organisation programme or course metadata", async (t) => {
    if (!server) return t.skip("database unreachable");
    const programmes = await bodyOf(await authed(tokens.learnerA, "GET", "/programmes"));
    const courses = await bodyOf(await authed(tokens.learnerA, "GET", "/courses"));
    for (const row of programmes) {
      assert.ok(!("budget" in row), "budget must not be exposed to learners");
      assert.ok(!("owner" in row), "owner must not be exposed to learners");
      assert.ok(!("slaHours" in row), "slaHours must not be exposed to learners");
    }
    assert.ok(Array.isArray(courses));
    assert.ok(!courses.some((row) => row.id === ids.courseB), "unrelated programme courses must not be exposed");
  });
});
