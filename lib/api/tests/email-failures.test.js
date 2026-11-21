// Round 8 / 3.3 — a failed send must be visible to the organization it belongs to, and to
// nobody else. These cases cover the list (org scoping, newest first, pagination), who may
// read it, and that dismissing a row removes it for the owning org only.
import { resetTestState } from "./support/resetTestState.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("GET /email-failures", () => {
  const stamp = Date.now();
  const ids = {
    org: `ef-org-${stamp}`,
    otherOrg: `ef-org-b-${stamp}`,
    admin: `ef-admin-${stamp}@example.com`,
    otherAdmin: `ef-other-admin-${stamp}@example.com`,
    learner: `ef-learner-${stamp}@example.com`,
  };
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const tokens = {};
  const users = {};
  const rows = {};

  const authed = async (token, method, p) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, body: json };
  };

  before(async () => {
    await resetTestState();
    if (!requireDatabase("email-failures.test.js")) return;
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
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.createMany({
      data: [
        { id: ids.org, name: "EF Org" },
        { id: ids.otherOrg, name: "EF Other Org" },
      ],
    });
    const pw = await hashPassword("pw-ef");
    const mkUser = (orgId, email) => prisma.user.create({ data: { orgId, name: email, email, passwordHash: pw } });
    users.admin = await mkUser(ids.org, ids.admin);
    users.otherAdmin = await mkUser(ids.otherOrg, ids.otherAdmin);
    users.learner = await mkUser(ids.org, ids.learner);
    await prisma.userRole.create({ data: { userId: users.admin.id, roleId: "admin", programmeId: null } });
    await prisma.userRole.create({ data: { userId: users.otherAdmin.id, roleId: "admin", programmeId: null } });
    tokens.admin = signToken({ id: users.admin.id, role: "admin", orgId: ids.org, tokenVersion: 0 });
    tokens.otherAdmin = signToken({ id: users.otherAdmin.id, role: "admin", orgId: ids.otherOrg, tokenVersion: 0 });
    tokens.learner = signToken({ id: users.learner.id, role: "learner", orgId: ids.org, tokenVersion: 0 });

    // Explicit times so ordering is a property of the route, not of how fast the inserts ran.
    const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000);
    rows.oldest = await prisma.emailFailure.create({
      data: { to: "old@example.com", subject: "Old", kind: "activation", error: "mailbox full", orgId: ids.org, userId: users.learner.id, createdAt: at(3) },
    });
    rows.middle = await prisma.emailFailure.create({
      data: { to: "mid@example.com", subject: "Middle", kind: "password_reset", error: "relay refused", orgId: ids.org, createdAt: at(2) },
    });
    rows.newest = await prisma.emailFailure.create({
      data: { to: "new@example.com", subject: "New", kind: "notification:booking", error: "timeout", orgId: ids.org, createdAt: at(1) },
    });
    rows.foreign = await prisma.emailFailure.create({
      data: { to: "foreign@example.com", subject: "Foreign", kind: "activation", error: "nope", orgId: ids.otherOrg, createdAt: at(0) },
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.emailFailure.deleteMany({ where: { orgId: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("org staff see only their org's failures, newest first", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.admin, "GET", "/email-failures");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((i) => i.to), ["new@example.com", "mid@example.com", "old@example.com"]);
    assert.ok(res.body.items.every((i) => i.id !== rows.foreign.id));
    // The resend shortcut needs to know who to resend to.
    assert.equal(res.body.items[2].userId, users.learner.id);
  });

  test("limit and offset page through the same ordering", async (t) => {
    if (!server) return t.skip("database unreachable");
    const first = await authed(tokens.admin, "GET", "/email-failures?limit=2&offset=0");
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items.map((i) => i.to), ["new@example.com", "mid@example.com"]);
    const second = await authed(tokens.admin, "GET", "/email-failures?limit=2&offset=2");
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.items.map((i) => i.to), ["old@example.com"]);
  });

  test("another org's staff cannot read them", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.otherAdmin, "GET", "/email-failures");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((i) => i.to), ["foreign@example.com"]);
  });

  test("a learner is refused, and an anonymous caller is unauthorized", async (t) => {
    if (!server) return t.skip("database unreachable");
    const learner = await authed(tokens.learner, "GET", "/email-failures");
    assert.equal(learner.status, 403);
    const anonymous = await authed(null, "GET", "/email-failures");
    assert.equal(anonymous.status, 401);
  });

  test("dismiss removes the row for its org, and is a 404 elsewhere", async (t) => {
    if (!server) return t.skip("database unreachable");
    const foreignAttempt = await authed(tokens.otherAdmin, "POST", `/email-failures/${rows.middle.id}/dismiss`);
    assert.equal(foreignAttempt.status, 404, "another org's admin must not be able to dismiss");
    assert.ok(await prisma.emailFailure.findUnique({ where: { id: rows.middle.id } }), "the row survives the foreign attempt");

    const dismissed = await authed(tokens.admin, "POST", `/email-failures/${rows.middle.id}/dismiss`);
    assert.equal(dismissed.status, 204);
    assert.equal(await prisma.emailFailure.findUnique({ where: { id: rows.middle.id } }), null);

    const afterwards = await authed(tokens.admin, "GET", "/email-failures");
    assert.deepEqual(afterwards.body.items.map((i) => i.to), ["new@example.com", "old@example.com"]);

    const again = await authed(tokens.admin, "POST", `/email-failures/${rows.middle.id}/dismiss`);
    assert.equal(again.status, 404);
  });
});
