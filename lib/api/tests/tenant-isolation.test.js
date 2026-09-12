import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("tenant isolation", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgA: `test-org-a-${stamp}`,
    orgB: `test-org-b-${stamp}`,
    progA: `test-prog-a-${stamp}`,
    progB: `test-prog-b-${stamp}`,
    courseA: `test-course-a-${stamp}`,
    courseB: `test-course-b-${stamp}`,
    userA: `tenant-a-${stamp}@example.com`,
  };
  let tokenA = "";

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
    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: "Tenant A" }, { id: ids.orgB, name: "Tenant B" }] });
    await prisma.programme.createMany({
      data: [
        { id: ids.progA, orgId: ids.orgA, name: "Prog A", type: "Test", owner: "t" },
        { id: ids.progB, orgId: ids.orgB, name: "Prog B", type: "Test", owner: "t" },
      ],
    });
    await prisma.course.createMany({
      data: [
        { id: ids.courseA, programmeId: ids.progA, title: "Course A" },
        { id: ids.courseB, programmeId: ids.progB, title: "Course B" },
      ],
    });
    await prisma.user.create({ data: { orgId: ids.orgA, name: "Tenant A User", email: ids.userA, passwordHash: await hashPassword("pw-a") } });
    const learner = await prisma.user.findUniqueOrThrow({ where: { email: ids.userA } });
    await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ids.userA, password: "pw-a" }),
    });
    tokenA = (await login.json()).accessToken;
  });

  after(async () => {
    if (prisma) {
      const learner = await prisma.user.findUnique({ where: { email: ids.userA } }).catch(() => null);
      if (learner) await prisma.enrolment.deleteMany({ where: { learnerId: learner.id } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progB] } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { email: ids.userA } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const get = (p) => fetch(`${baseUrl}/api${p}`, { headers: { authorization: `Bearer ${tokenA}` } });

  test("programmes leak nothing from org B", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await (await get("/programmes")).json();
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.orgId === ids.orgA), "all programmes must belong to org A");
  });

  test("courses leak nothing from org B", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await (await get("/courses")).json();
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.programmeId === ids.progA), "all courses must belong to org A programmes");
  });

  test("enrolments leak nothing from org B", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await (await get("/enrolments")).json();
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.programmeId === ids.progA), "all enrolments must belong to org A");
  });

  test("creating a module in org B as org-A user is rejected", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/programmes/${ids.progB}/modules`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ title: "Sneaky module" }),
    });
    assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
  });
});
