import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("thread isolation", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgA: `thread-org-a-${stamp}`,
    orgB: `thread-org-b-${stamp}`,
    threadA: `thread-a-${stamp}`,
    userA: `thread-user-a-${stamp}@example.com`,
    userB: `thread-user-b-${stamp}@example.com`,
  };
  let tokenB = "";

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
    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: "Thread Org A" }, { id: ids.orgB, name: "Thread Org B" }] });
    await prisma.messageThread.create({ data: { id: ids.threadA, orgId: ids.orgA, subject: "General DM", participant: "trainer" } });
    await prisma.message.create({ data: { threadId: ids.threadA, author: "learner", body: "secret content" } });
    await prisma.user.create({ data: { orgId: ids.orgA, name: "UA", email: ids.userA, passwordHash: pw } });
    await prisma.user.create({ data: { orgId: ids.orgB, name: "UB", email: ids.userB, passwordHash: pw } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ids.userB, password: "pw" }),
    });
    tokenB = (await login.json()).accessToken;
  });

  after(async () => {
    if (prisma) {
      await prisma.message.deleteMany({ where: { threadId: ids.threadA } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { id: ids.threadA } }).catch(() => null);
      await prisma.user.deleteMany({ where: { email: { in: [ids.userA, ids.userB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("org-B user sees zero threads from org A", async (t) => {
    if (!server) return t.skip("database unreachable");
    const rows = await (await fetch(`${baseUrl}/api/threads`, { headers: { authorization: `Bearer ${tokenB}` } })).json();
    assert.ok(!rows.some((r) => r.id === ids.threadA), "programme-less org-A thread must be invisible");
  });

  test("org-B user gets 404 requesting org-A thread messages", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/threads/${ids.threadA}/messages`, { headers: { authorization: `Bearer ${tokenB}` } });
    assert.equal(res.status, 404);
  });
});
