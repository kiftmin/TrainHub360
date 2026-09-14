import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("calendar scoping", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgA: `cal-org-a-${stamp}`,
    orgB: `cal-org-b-${stamp}`,
    learnerA: `cal-learner-a-${stamp}@example.com`,
    learnerA2: `cal-learner-a2-${stamp}@example.com`,
    adminA: `cal-admin-a-${stamp}@example.com`,
    userB: `cal-user-b-${stamp}@example.com`,
  };
  let learnerAId = "";
  let learnerA2Id = "";
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
    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: "Cal A" }, { id: ids.orgB, name: "Cal B" }] });
    for (const r of ["owner", "admin", "trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    const mk = async (email, orgId, role) => {
      const u = await prisma.user.create({ data: { orgId, name: email, email, passwordHash: pw } });
      const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      await prisma.userRole.create({ data: { userId: u.id, roleId: roleRow.id, programmeId: null } });
      return u;
    };
    const la = await mk(ids.learnerA, ids.orgA, "learner");
    const la2 = await mk(ids.learnerA2, ids.orgA, "learner");
    learnerAId = la.id;
    learnerA2Id = la2.id;
    await mk(ids.adminA, ids.orgA, "admin");
    const ub = await mk(ids.userB, ids.orgB, "learner");
    await prisma.calendarEvent.createMany({
      data: [
        { title: "A1", date: "2026-10-01", time: "10:00", userId: learnerAId, orgId: ids.orgA },
        { title: "A2", date: "2026-10-02", time: "10:00", userId: learnerA2Id, orgId: ids.orgA },
        { title: "B1", date: "2026-10-01", time: "10:00", userId: ub.id, orgId: ids.orgB },
      ],
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    tokens.learnerA = await loginAs(ids.learnerA);
    tokens.adminA = await loginAs(ids.adminA);
    tokens.userB = await loginAs(ids.userB);
  });

  after(async () => {
    if (prisma) {
      await prisma.calendarEvent.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const get = (token) => fetch(`${baseUrl}/api/calendar`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());

  test("learner sees only their own events", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await get(tokens.learnerA);
    assert.deepEqual(rows.map((r) => r.title), ["A1"]);
  });

  test("admin sees org-wide events but nothing from org B", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await get(tokens.adminA);
    assert.deepEqual(rows.map((r) => r.title).sort(), ["A1", "A2"]);
  });

  test("org-B user sees zero org-A events", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await get(tokens.userB);
    assert.deepEqual(rows.map((r) => r.title), ["B1"]);
  });
});
