import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("cohorts", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `cohort-org-${stamp}`,
    prog: `cohort-prog-${stamp}`,
    course: `cohort-course-${stamp}`,
    cohort: `cohort-${stamp}`,
  };
  let token = "";
  const learnerIds = [];

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
    await prisma.organization.create({ data: { id: ids.org, name: "Cohort Org" } });
    for (const r of ["owner", "admin", "trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    await prisma.programme.create({ data: { id: ids.prog, orgId: ids.org, name: "C Prog", type: "Test", owner: "t" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.prog, title: "C Course" } });
    const admin = await prisma.user.create({ data: { orgId: ids.org, name: "C Admin", email: `cohort-admin-${stamp}@example.com`, passwordHash: pw } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "owner" } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id, programmeId: null } });
    for (let i = 0; i < 3; i += 1) {
      const u = await prisma.user.create({ data: { orgId: ids.org, name: `CL${i}`, email: `cohort-learner-${i}-${stamp}@example.com`, passwordHash: pw } });
      learnerIds.push(u.id);
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `cohort-admin-${stamp}@example.com`, password: "pw" }),
    });
    token = (await login.json()).accessToken;
  });

  after(async () => {
    if (prisma) {
      await prisma.enrolment.deleteMany({ where: { programmeId: ids.prog } }).catch(() => null);
      await prisma.cohortMember.deleteMany({ where: { cohortId: ids.cohort } }).catch(() => null);
      await prisma.cohort.deleteMany({ where: { id: ids.cohort } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.prog } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const authed = (method, p, body) =>
    fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });

  test("cohort enrol creates one enrolment per member", async (t) => {
    if (!server) return t.skip("database unreachable");
    const created = await (await authed("POST", "/cohorts", { name: "Test Cohort", department: "Ops" })).json();
    ids.cohort = created.id;
    const members = await (await authed("POST", `/cohorts/${ids.cohort}/members`, { userIds: learnerIds })).json();
    assert.equal(members.added, 3);
    const enrol = await (await authed("POST", `/cohorts/${ids.cohort}/enrol`, { courseId: ids.course })).json();
    assert.equal(enrol.enrolled, 3);
    const count = await prisma.enrolment.count({ where: { courseId: ids.course } });
    assert.equal(count, 3);
  });

  test("kpi job includes per-cohort coverage", async (t) => {
    if (!server) return t.skip("database unreachable");
    const { runKpiJob } = await import("../dist/jobs/kpiJob.js");
    const payload = await runKpiJob(ids.org);
    const row = payload.coverageByCohort.find((c) => c.cohortId === ids.cohort);
    assert.ok(row, "coverage row exists");
    assert.equal(row.completionRate, 0);
  });
});
