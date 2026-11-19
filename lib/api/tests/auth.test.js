import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword, verifyPassword } from "../dist/services/password.js";
import { requireDatabase } from "./support/requireDatabase.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

test("hashPassword/verifyPassword roundtrip", async () => {
  const hash = await hashPassword("CorrectHorse123!");
  assert.equal(await verifyPassword("CorrectHorse123!", hash), true);
});

test("verifyPassword rejects wrong password and empty hash", async () => {
  const hash = await hashPassword("CorrectHorse123!");
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(await verifyPassword("anything", ""), false);
});

describe("POST /auth/login", () => {
  const hasDb = requireDatabase("auth.test.js");
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  let tmpEmail = "";
  let tmpOrgId = null;
  let resetLoginThrottleForTests = () => {};

  before(async () => {
    if (!hasDb) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    // The login throttle is in-memory and keyed partly by IP. Every test file's app runs
    // in its own process on 127.0.0.1, so on CI all the files' failed logins land in the
    // same per-IP bucket; without this reset a later "correct password" test can be
    // answered with the generic lockout 401.
    ({ resetLoginThrottleForTests } = await import("../dist/middleware/rateLimit.js"));
    resetLoginThrottleForTests();
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
    if (tmpEmail && prisma) await prisma.user.deleteMany({ where: { email: tmpEmail } }).catch(() => null);
    if (tmpOrgId && prisma) await prisma.organization.deleteMany({ where: { id: tmpOrgId } }).catch(() => null);
    if (prisma) await prisma.$disconnect();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const login = (body) =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("correct password succeeds", async (t) => {
    if (!prisma || !server) return t.skip("database unreachable");
    // One isolation concern per test: this case proves a good password logs in, so the
    // lockout state is cleared here rather than inherited from earlier cases.
    resetLoginThrottleForTests();
    // CI applies a fresh schema with `prisma db push` and no seed, so the test must create
    // its own organization instead of relying on one being present.
    const existing = await prisma.organization.findFirst();
    const org = existing ?? (await prisma.organization.create({ data: { name: "Auth Test Org" } }));
    const orgCreated = !existing;
    tmpEmail = `auth-test-${Date.now()}@example.com`;
    await prisma.user.create({ data: { orgId: org.id, name: "Auth Test", email: tmpEmail, passwordHash: await hashPassword("S3cret-pass") } });
    // The org's id is derived from the seeded user, so clean up the org only when we made it.
    tmpOrgId = orgCreated ? org.id : null;
    const res = await login({ email: tmpEmail, password: "S3cret-pass" });
    // Lockout and a wrong password share one 401, so say which one answered when it fails.
    if (res.status !== 200) t.diagnostic(`login -> ${res.status} ${JSON.stringify(await res.clone().json().catch(() => null))}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.equal(data.user.email, tmpEmail);
  });

  test("wrong password and unknown email both return identical 401s", async (t) => {
    if (!prisma || !server) return t.skip("database unreachable");
    const bad = await login({ email: tmpEmail || "nobody-here@example.com", password: "wrong-pass" });
    const unknown = await login({ email: `never-${Date.now()}@example.com`, password: "wrong-pass" });
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    const badBody = await bad.json();
    const unknownBody = await unknown.json();
    assert.deepEqual(badBody, unknownBody);
  });

  test("missing password returns 400", async (t) => {
    if (!prisma || !server) return t.skip("database unreachable");
    const res = await login({ email: "x@example.com" });
    assert.equal(res.status, 400);
  });

  test("SSO stub returns 501 when disabled", async (t) => {
    if (!server) return t.skip("server unavailable");
    const res = await fetch(`${baseUrl}/api/auth/sso`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samlAssertion: "anything" }),
    });
    assert.equal(res.status, process.env.SSO_ENABLED === "true" ? 400 : 501);
  });
});
