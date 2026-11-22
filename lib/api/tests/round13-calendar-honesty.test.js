import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 13 phase 5 — calendar honesty", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r13cal-${stamp}`,
    programme: `r13cal-prog-${stamp}`,
    session: `r13cal-session-${stamp}`,
  };
  const users = {};
  let token;

  before(async () => {
    if (!requireDatabase("round13-calendar-honesty.test.js")) return;
    process.env.NODE_ENV = "test";
    const { default: app } = await import("../dist/index.js");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma, ["trainer"]);
    await prisma.organization.create({ data: { id: ids.org, name: "R13Cal Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "R13Cal Programme", type: "Test", owner: "owner" } });
    users.trainer = await prisma.user.create({ data: { orgId: ids.org, name: "R13Cal Trainer", email: `trainer-${stamp}@example.com`, passwordHash: "" } });
    await prisma.userRole.create({ data: { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programme } });
    await prisma.session.create({ data: {
      id: ids.session,
      title: "R13Cal Session",
      programme: "R13Cal Programme",
      programmeId: ids.programme,
      orgId: ids.org,
      trainer: users.trainer.name,
      trainerId: users.trainer.id,
      date: "2026-12-15",
      time: "10:00",
      startsAt: new Date("2026-12-15T10:00:00.000Z"),
      endsAt: new Date("2026-12-15T11:00:00.000Z"),
      timezone: "UTC",
      mode: "online",
      status: "scheduled",
    } });
    token = signToken({ id: users.trainer.id, role: "member", orgId: ids.org, tokenVersion: 0 });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.session.deleteMany({ where: { id: ids.session } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: users.trainer?.id } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: users.trainer?.id } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("calendar API sync is refused with the supported .ics alternatives", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/sessions/${ids.session}/sync-calendar`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.match(body.error, /Outlook\/Google API sync is not built/);
    assert.match(body.error, /\/ics/);
    assert.match(body.error, /feed\.ics/);
  });
});
