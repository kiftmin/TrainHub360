import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("edit/delete CRUD", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `crud-org-${stamp}`,
    prog: `crud-prog-${stamp}`,
    course: `crud-course-${stamp}`,
    owner: `crud-owner-${stamp}@example.com`,
  };
  let token = "";

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
    await prisma.organization.create({ data: { id: ids.org, name: "CRUD Org" } });
    await prisma.role.upsert({ where: { name: "owner" }, create: { id: "owner", name: "owner" }, update: {} });
    const owner = await prisma.user.create({ data: { orgId: ids.org, name: "Owner", email: ids.owner, passwordHash: pw } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "owner" } });
    await prisma.userRole.create({ data: { userId: owner.id, roleId: role.id, programmeId: null } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ids.owner, password: "pw" }),
    });
    token = (await login.json()).accessToken;
  });

  after(async () => {
    if (prisma) {
      await prisma.enrolment.deleteMany({ where: { programmeId: ids.prog } }).catch(() => null);
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

  const authed = (method, p, body) =>
    fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });

  test("programme create, patch, and delete when empty", async (t) => {
    if (!server) return t.skip("database unreachable");
    const created = await (await authed("POST", "/programmes", { name: "Temp Prog", type: "Test" })).json();
    assert.ok(created.id);
    const patched = await (await authed("PATCH", `/programmes/${created.id}`, { name: "Temp Prog 2" })).json();
    assert.equal(patched.name, "Temp Prog 2");
    const del = await authed("DELETE", `/programmes/${created.id}`);
    assert.equal(del.status, 204);
  });

  test("programme delete blocked while courses exist; course patch works", async (t) => {
    if (!server) return t.skip("database unreachable");
    await prisma.programme.create({ data: { id: ids.prog, orgId: ids.org, name: "P", type: "Test", owner: "t" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.prog, title: "Old Title" } });
    const blocked = await authed("DELETE", `/programmes/${ids.prog}`);
    assert.equal(blocked.status, 409);
    const patched = await (await authed("PATCH", `/courses/${ids.course}`, { title: "New Title" })).json();
    assert.equal(patched.title, "New Title");
    const list = await (await authed("GET", `/programmes`)).json();
    const row = list.find((p) => p.id === ids.prog);
    assert.equal(row.courseCount, 1);
  });

  test("organization patch updates name", async (t) => {
    if (!server) return t.skip("database unreachable");
    const patched = await (await authed("PATCH", `/organizations/${ids.org}`, { name: "CRUD Org 2" })).json();
    assert.equal(patched.name, "CRUD Org 2");
  });
});
