// Round 6 / A.1 — async errors thrown in route handlers must produce a response.
// Every request here is wrapped in a short timeout: on the unfixed code (Express 4.21,
// no express-async-errors) a rejected handler promise never reaches the error middleware,
// so the request hangs. A hang must fail the test, not stall the suite.
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

const REQUEST_TIMEOUT_MS = 3000;

describe("A.1 async route errors produce responses", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgA: `ae-org-a-${stamp}`,
    orgB: `ae-org-b-${stamp}`,
    progA: `ae-prog-a-${stamp}`,
    progB: `ae-prog-b-${stamp}`,
    courseB: `ae-course-b-${stamp}`,
    adminA: `ae-admin-a-${stamp}@example.com`,
    adminB: `ae-admin-b-${stamp}@example.com`,
    outsider: `ae-outsider-${stamp}@example.com`,
  };
  const tokens = {};

  const authed = async (token, method, p, body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl}/api${p}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  before(async () => {
    if (!requireDatabase("async-errors.test.js")) return;
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
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "AE Org A" },
        { id: ids.orgB, name: "AE Org B" },
      ],
    });
    await prisma.programme.createMany({
      data: [
        { id: ids.progA, orgId: ids.orgA, name: "AE Prog A", type: "Test", owner: "t" },
        { id: ids.progB, orgId: ids.orgB, name: "AE Prog B", type: "Test", owner: "t" },
      ],
    });
    await prisma.course.create({ data: { id: ids.courseB, programmeId: ids.progB, title: "Course B" } });
    const mkUser = (orgId, email, name) =>
      prisma.user.create({ data: { orgId, name, email, passwordHash: pw } });
    const adminA = await mkUser(ids.orgA, ids.adminA, "Admin A");
    const adminB = await mkUser(ids.orgB, ids.adminB, "Admin B");
    const outsider = await mkUser(ids.orgA, ids.outsider, "Outsider");
    // Org A: a single programme admin, so removing that grant hits the last-admin guard.
    // adminA also holds org-wide staff rights (programmeId: null) because isOrgStaff() reads that
    // grant, not the token's role. The enforced limit is the (userId, roleId) pair, not the
    // triple — SQL Server treats a NULL programme_id as unknown — so the two grants use different
    // roles: "owner" org-wide, "admin" in the programme.
    await prisma.userRole.create({ data: { userId: adminA.id, roleId: "owner", programmeId: null } }); // org staff in org A
    await prisma.userRole.create({ data: { userId: adminA.id, roleId: "admin", programmeId: ids.progA } });
    await prisma.userRole.create({ data: { userId: adminB.id, roleId: "admin", programmeId: null } }); // org staff in org B
    await prisma.userRole.create({ data: { userId: outsider.id, roleId: "learner", programmeId: ids.progA } });

    // Tokens are minted directly so the assertions are about authorization, not login.
    tokens.adminA = signToken({ id: adminA.id, role: "admin", orgId: ids.orgA, tokenVersion: 0 });
    tokens.adminAOrgStaff = tokens.adminA;
    tokens.adminB = signToken({ id: adminB.id, role: "admin", orgId: ids.orgB, tokenVersion: 0 });
    tokens.outsider = signToken({ id: outsider.id, role: "learner", orgId: ids.orgA, tokenVersion: 0 });
    tokens.nobody = signToken({ id: `ae-ghost-${stamp}`, role: "admin", orgId: ids.orgA, tokenVersion: 0 });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const orgs = [ids.orgA, ids.orgB];
      const userIds = (await prisma.user.findMany({ where: { orgId: { in: orgs } }, select: { id: true } }).catch(() => [])).map((u) => u.id);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.courseB } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progB] } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // An org-B staff admin passing the *org A* programme id: requireProgrammeRole passes
  // (they are org staff), then assertProgrammeInOrg throws 404. On Express 4 without
  // express-async-errors that rejection never reaches the error middleware: the request
  // hangs and the test times out.
  test("cross-org programme member add returns 404 promptly", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.adminB, "POST", `/programmes/${ids.progA}/members`, {
      email: ids.outsider,
      role: "learner",
    });
    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
    const body = await res.json();
    assert.match(String(body.error), /not found/i);
  });

  // Regression guard for the 404 path: the same route must still succeed for someone who
  // does have the programme. Two outcomes are correct depending on what the previous test
  // left behind, so accept either rather than writing a test that depends on run order:
  //   201 - the grant was created, or 409 - the person is already a member of the org.
  test("org admin adding to their own programme still works", async (t) => {
    if (!server) return t.skip("database unreachable");
    const someoneElse = await prisma.user.create({
      data: {
        orgId: ids.orgA,
        name: "AE Extra",
        email: `ae-extra-${stamp}@example.com`,
        passwordHash: "x",
      },
      select: { id: true },
    });
    const res = await authed(tokens.adminA, "POST", `/programmes/${ids.progA}/members`, {
      userId: someoneElse.id,
      role: "learner",
    });
    assert.ok([201, 409].includes(res.status), `expected 201 or 409, got ${res.status}`);
    assert.notEqual(res.status, 404, "the org's own programme must not 404");
  });

  // Removing the only admin via the roles array must be refused, not hang.
  test("roles array removing the last programme admin returns 409", async (t) => {
    if (!server) return t.skip("database unreachable");
    const target = await prisma.user.findUnique({ where: { email: ids.adminA }, select: { id: true } });
    const res = await authed(tokens.adminA, "PATCH", `/programmes/${ids.progA}/members/${target.id}`, {
      roles: ["trainer"],
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status}`);
    const body = await res.json();
    assert.match(String(body.error), /last programme admin/i);
  });

  test("last-admin grant still present after the refused change", async (t) => {
    if (!server) return t.skip("database unreachable");
    const target = await prisma.user.findUnique({ where: { email: ids.adminA }, select: { id: true } });
    const grant = await prisma.userRole.findFirst({
      where: { userId: target.id, programmeId: ids.progA, role: { name: "admin" } },
    });
    assert.ok(grant, "admin grant must not have been removed");
  });

  // A course that lives in another organization must 404 through the throwing helper.
  test("course from another organization returns 404 promptly", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.adminA, "POST", "/enrolments", {
      courseId: ids.courseB,
      learnerId: (await prisma.user.findUnique({ where: { email: ids.outsider }, select: { id: true } })).id,
    });
    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
    const body = await res.json();
    assert.match(String(body.error), /course not found/i);
  });

  test("learner cannot add programme members (403, not a hang)", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.outsider, "POST", `/programmes/${ids.progA}/members`, {
      email: ids.outsider,
      role: "admin",
    });
    assert.equal(res.status, 403);
  });

  // An unexpected (non-status) exception must be a generic 500, never the MSSQL hint.
  // The throwing route is mounted on a throwaway app wired exactly like dist/index.js,
  // because that app starts listening as soon as it is imported.
  test("unexpected exception returns 500 without leaking internals", async (t) => {
    if (!server) return t.skip("database unreachable");
    const { errorMiddleware } = await import("../dist/index.js");
    const express = (await import("express")).default;
    const boom = express();
    boom.get("/api/__test_boom", async () => {
      throw new TypeError("kaboom: secret internal detail");
    });
    boom.use(errorMiddleware);
    const boomServer = await new Promise((resolve) => {
      const s = boom.listen(0, "127.0.0.1", () => resolve(s));
    });
    const boomUrl = `http://127.0.0.1:${boomServer.address().port}`;
    let res;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(`${boomUrl}/api/__test_boom`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await new Promise((resolve) => boomServer.close(resolve));
    }
    assert.equal(res.status, 500, `expected 500, got ${res.status}`);
    const text = await res.text();
    assert.ok(!/kaboom/i.test(text), `internals leaked: ${text}`);
    assert.ok(!/MSSQL unreachable/i.test(text), `misleading 503 hint leaked: ${text}`);
    const body = JSON.parse(text);
    assert.equal(body.error, "internal server error");
  });
});
