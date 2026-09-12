import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("programme-scoped RBAC", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `rbac-org-${stamp}`,
    progA: `rbac-prog-a-${stamp}`,
    progB: `rbac-prog-b-${stamp}`,
    courseA: `rbac-course-a-${stamp}`,
    learner: `rbac-learner-${stamp}@example.com`,
    manager: `rbac-manager-${stamp}@example.com`,
    adminA: `rbac-admin-a-${stamp}@example.com`,
    owner: `rbac-owner-${stamp}@example.com`,
  };
  let enrolmentId = "";
  const tokens = {};

  const loginAs = async (email, password) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).accessToken;
  };

  before(async () => {
    if (!process.env.DATABASE_URL) return;
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
    await prisma.organization.create({ data: { id: ids.org, name: "RBAC Org" } });
    for (const r of ["owner", "admin", "trainer", "learner", "stakeholder"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    await prisma.programme.createMany({
      data: [
        { id: ids.progA, orgId: ids.org, name: "Prog A", type: "Test", owner: "t" },
        { id: ids.progB, orgId: ids.org, name: "Prog B", type: "Test", owner: "t" },
      ],
    });
    await prisma.course.create({ data: { id: ids.courseA, programmeId: ids.progA, title: "Course A" } });
    const mkUser = async (email, name, managerId = null) =>
      prisma.user.create({ data: { orgId: ids.org, name, email, passwordHash: pw, managerId } });
    const manager = await mkUser(ids.manager, "Manager");
    const learner = await mkUser(ids.learner, "Learner", manager.id);
    const adminA = await mkUser(ids.adminA, "Admin A");
    const owner = await mkUser(ids.owner, "Owner");
    const grant = (userId, roleName, programmeId) =>
      prisma.userRole.create({ data: { userId, roleId: roleName, programmeId } });
    await grant(learner.id, "learner", ids.progA);
    await grant(manager.id, "trainer", ids.progA);
    await grant(adminA.id, "admin", ids.progA);
    await grant(owner.id, "owner", null);
    const enr = await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" } });
    enrolmentId = enr.id;
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    tokens.learner = await loginAs(ids.learner, "pw");
    tokens.manager = await loginAs(ids.manager, "pw");
    tokens.adminA = await loginAs(ids.adminA, "pw");
    tokens.owner = await loginAs(ids.owner, "pw");
  });

  after(async () => {
    if (prisma) {
      await prisma.enrolment.deleteMany({ where: { programmeId: { in: [ids.progA, ids.progB] } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.courseA } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: (await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => [])).map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const authed = (token, method, p, body) =>
    fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });

  test("learner cannot create a course", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learner, "POST", "/courses", { programmeId: ids.progA, title: "Nope" });
    assert.equal(res.status, 403);
  });

  test("learner cannot set their own appliedAssessmentScore", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learner, "PATCH", `/enrolments/${enrolmentId}`, { appliedAssessmentScore: 99 });
    assert.equal(res.status, 403);
  });

  test("learner cannot set their own managerSignOff", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learner, "PATCH", `/enrolments/${enrolmentId}`, { managerSignOff: true });
    assert.equal(res.status, 403);
  });

  test("the learner's actual manager can sign off", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.manager, "PATCH", `/enrolments/${enrolmentId}`, { managerSignOff: true });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.managerSignOff, true);
    assert.ok(data.managerSignOffBy);
  });

  test("programme-A admin gets 403 on programme-B course creation", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.adminA, "POST", "/courses", { programmeId: ids.progB, title: "Sneaky" });
    assert.equal(res.status, 403);
  });

  test("programme-A admin can create in programme A", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.adminA, "POST", "/courses", { programmeId: ids.progA, title: "Allowed" });
    assert.equal(res.status, 201);
    const created = await res.json();
    await prisma.course.delete({ where: { id: created.id } }).catch(() => null);
  });

  test("org owner succeeds across programmes", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.owner, "POST", "/courses", { programmeId: ids.progB, title: "Owner course" });
    assert.equal(res.status, 201);
    const created = await res.json();
    await prisma.course.delete({ where: { id: created.id } }).catch(() => null);
  });

  test("stakeholder reads programmes but cannot mutate", async (t) => {
    if (!server) return t.skip("database unreachable");
    const email = `rbac-stake-${stamp}@example.com`;
    const sh = await prisma.user.create({ data: { orgId: ids.org, name: "Stake", email, passwordHash: await hashPassword("pw") } });
    await prisma.userRole.create({ data: { userId: sh.id, roleId: "stakeholder", programmeId: ids.progA } });
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "pw" }),
    });
    assert.equal(login.status, 200);
    const token = (await login.json()).accessToken;
    const get = await fetch(`${baseUrl}/api/programmes`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(get.status, 200);
    const rows = await get.json();
    assert.ok(rows.every((r) => r.id === ids.progA), "stakeholder sees only granted programmes");
    for (const [method, path, body] of [
      ["POST", "/courses", { programmeId: ids.progA, title: "X" }],
      ["PATCH", `/enrolments/${enrolmentId}`, { status: "completed" }],
      ["DELETE", `/enrolments/${enrolmentId}`, undefined],
    ]) {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(res.status, 403, `${method} ${path} must be forbidden for stakeholder`);
    }
    await prisma.userRole.deleteMany({ where: { userId: sh.id } }).catch(() => null);
    await prisma.user.delete({ where: { id: sh.id } }).catch(() => null);
  });
});
