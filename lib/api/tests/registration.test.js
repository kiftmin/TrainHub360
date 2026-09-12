import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("organization self-registration", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const email = `reg-${stamp}@example.com`;
  let orgId = "";
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
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma && orgId) {
      const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("register creates org + owner with domainVerified false", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/organizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Reg Org", adminEmail: email, adminName: "Reg Admin", domain: "example.com", adminPassword: "Reg-pass-1" }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.orgId);
    assert.equal(data.domainVerified, false);
    assert.ok(data.verificationToken);
    orgId = data.orgId;
    token = data.verificationToken;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Reg-pass-1" }),
    });
    assert.equal(login.status, 200);
  });

  test("invalid token is rejected, valid token verifies", async (t) => {
    if (!server) return t.skip("database unreachable");
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Reg-pass-1" }),
    });
    const jwt = (await login.json()).accessToken;
    const bad = await fetch(`${baseUrl}/api/organizations/${orgId}/verify-domain`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ token: "wrong" }),
    });
    assert.equal(bad.status, 400);
    const good = await fetch(`${baseUrl}/api/organizations/${orgId}/verify-domain`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ token }),
    });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).domainVerified, true);
  });
});
