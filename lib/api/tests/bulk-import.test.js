import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("bulk learner import", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const orgId = `import-org-${stamp}`;
  const adminEmail = `import-admin-${stamp}@example.com`;
  let token = "";
  const learnerEmail = `import-learner-${stamp}@example.com`;

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
    const { hashPassword } = await import("../dist/services/password.js");
    await prisma.organization.create({ data: { id: orgId, name: "Import Org" } });
    for (const r of ["owner", "admin", "trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    const admin = await prisma.user.create({ data: { orgId, name: "Importer", email: adminEmail, passwordHash: await hashPassword("pw") } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "owner" } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id, programmeId: null } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "pw" }),
    });
    token = (await login.json()).accessToken;
  });

  after(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("valid + bad-email + unknown-manager rows report created/failed/warning", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/organizations/${orgId}/learners/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        rows: [
          { name: "Good Learner", email: learnerEmail, department: "Ops", jobFunction: "Driver" },
          { name: "Bad Row", email: "not-an-email", department: "Ops" },
          { name: "Orphan", email: `import-orphan-${stamp}@example.com`, managerEmail: "ghost@example.com" },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.created, 2);
    assert.equal(data.failed, 1);
    assert.equal(data.errors.length, 1);
    assert.equal(data.warnings.length, 1);
    const orphan = await prisma.user.findUnique({ where: { email: `import-orphan-${stamp}@example.com` } });
    assert.ok(orphan);
    assert.equal(orphan.managerId, null);
  });
});
