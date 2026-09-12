import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("session RSVP capacity", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `rsvp-org-${stamp}`,
    session: `rsvp-session-${stamp}`,
    trainer: `rsvp-trainer-${stamp}@example.com`,
  };
  const learnerEmails = [0, 1, 2].map((i) => `rsvp-learner-${i}-${stamp}@example.com`);
  let trainerToken = "";
  const learnerTokens = [];
  const learnerIds = [];

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
    await prisma.organization.create({ data: { id: ids.org, name: "RSVP Org" } });
    for (const r of ["owner", "admin", "trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    const trainer = await prisma.user.create({ data: { orgId: ids.org, name: "T", email: ids.trainer, passwordHash: pw } });
    const trainerRole = await prisma.role.findUniqueOrThrow({ where: { name: "trainer" } });
    await prisma.userRole.create({ data: { userId: trainer.id, roleId: trainerRole.id, programmeId: null } });
    await prisma.session.create({ data: { id: ids.session, title: "Cap Session", date: "2026-10-01", time: "10:00", capacity: 2 } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = async (email) =>
      (await (await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "pw" }),
      })).json()).accessToken;
    for (const email of learnerEmails) {
      const u = await prisma.user.create({ data: { orgId: ids.org, name: "L", email, passwordHash: pw } });
      learnerIds.push(u.id);
      learnerTokens.push(await login(email));
    }
    trainerToken = await login(ids.trainer);
  });

  after(async () => {
    if (prisma) {
      await prisma.sessionRSVP.deleteMany({ where: { sessionId: ids.session } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: ids.session } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("third confirmation waitlists at capacity 2, cancel promotes", async (t) => {
    if (!server) return t.skip("database unreachable");
    const invite = await fetch(`${baseUrl}/api/sessions/${ids.session}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${trainerToken}` },
      body: JSON.stringify({ learnerIds }),
    });
    assert.equal(invite.status, 200);
    assert.equal((await invite.json()).invited, 3);
    const statuses = [];
    for (const tok of learnerTokens) {
      const r = await fetch(`${baseUrl}/api/sessions/${ids.session}/rsvp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
        body: JSON.stringify({ status: "confirmed" }),
      });
      assert.equal(r.status, 200);
      statuses.push((await r.json()).status);
    }
    assert.deepEqual(statuses, ["confirmed", "confirmed", "waitlisted"]);
    const cancel = await fetch(`${baseUrl}/api/sessions/${ids.session}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${learnerTokens[0]}` },
      body: JSON.stringify({ status: "declined" }),
    });
    assert.equal(cancel.status, 200);
    const rows = await prisma.sessionRSVP.findMany({ where: { sessionId: ids.session } });
    const confirmed = rows.filter((r) => r.status === "confirmed").length;
    const waitlisted = rows.filter((r) => r.status === "waitlisted").length;
    assert.equal(confirmed, 2);
    assert.equal(waitlisted, 0);
  });
});
