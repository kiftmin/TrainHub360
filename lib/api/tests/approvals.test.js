import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("two-person delete approval", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `appr-org-${stamp}`,
    prog: `appr-prog-${stamp}`,
    course: `appr-course-${stamp}`,
    adminA: `appr-admin-a-${stamp}@example.com`,
    adminB: `appr-admin-b-${stamp}@example.com`,
  };
  const tokens = {};

  const loginAs = async (email) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "pw" }),
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
    await prisma.organization.create({ data: { id: ids.org, name: "Appr Org" } });
    for (const r of ["owner", "admin", "trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    await prisma.programme.create({ data: { id: ids.prog, orgId: ids.org, name: "Doomed Prog", type: "Test", owner: "t" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.prog, title: "Doomed Course" } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "admin" } });
    for (const email of [ids.adminA, ids.adminB]) {
      const u = await prisma.user.create({ data: { orgId: ids.org, name: email, email, passwordHash: pw } });
      await prisma.userRole.create({ data: { userId: u.id, roleId: adminRole.id, programmeId: ids.prog } });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    tokens.a = await loginAs(ids.adminA);
    tokens.b = await loginAs(ids.adminB);
  });

  after(async () => {
    if (prisma) {
      await prisma.deleteRequest.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.course.deleteMany({ where: { programmeId: ids.prog } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.prog } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
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

  test("requester cannot approve their own request", async (t) => {
    if (!server) return t.skip("database unreachable");
    const created = await (await authed(tokens.a, "POST", `/programmes/${ids.prog}/delete-requests`, { reason: "cleanup" })).json();
    assert.equal(created.status, "pending");
    const selfApprove = await authed(tokens.a, "POST", `/delete-requests/${created.id}/approve`);
    assert.equal(selfApprove.status, 403);
  });

  test("second admin approval archives programme and courses", async (t) => {
    if (!server) return t.skip("database unreachable");
    const pending = await prisma.deleteRequest.findFirst({ where: { targetId: ids.prog, status: "pending" } });
    assert.ok(pending);
    const res = await authed(tokens.b, "POST", `/delete-requests/${pending.id}/approve`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "approved");
    const prog = await prisma.programme.findUnique({ where: { id: ids.prog } });
    assert.equal(prog.status, "archived");
    const course = await prisma.course.findUnique({ where: { id: ids.course } });
    assert.equal(course.isArchived, true);
  });
});
