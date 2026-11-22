import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 13 phase 5 — learner session cards", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `r13card-${stamp}`;
  const ids = {
    org: `${prefix}-org`,
    programme: `${prefix}-programme`,
    course: `${prefix}-course`,
    session: `${prefix}-session`,
    cancelled: `${prefix}-cancelled`,
    unrelated: `${prefix}-unrelated`,
  };
  const users = {};
  const tokens = {};

  const authed = async (token, method, p, body) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    if (!requireDatabase("round13-learner-session-cards.test.js")) return;
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
    await seedRoles(prisma, ["trainer", "learner"]);
    await prisma.organization.create({ data: { id: ids.org, name: "R13Card Org" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "R13Card Programme", type: "Test", owner: "owner" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R13Card Course", appliedThreshold: 70 } });
    for (const [key, name] of [
      ["trainer", "R13Card Trainer"],
      ["learnerA", "R13Card Learner A"],
      ["learnerB", "R13Card Learner B"],
      ["learnerC", "R13Card Learner C"],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId: ids.org, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programme },
      ...["learnerA", "learnerB", "learnerC"].map((key) => ({ userId: users[key].id, roleId: "learner", programmeId: ids.programme })),
    ] });
    await prisma.enrolment.create({ data: { learnerId: users.learnerC.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" } });

    const sessionData = (id, title) => ({
      id,
      title,
      programme: "R13Card Programme",
      programmeId: ids.programme,
      orgId: ids.org,
      trainer: users.trainer.name,
      trainerId: users.trainer.id,
      courseId: ids.course,
      date: "2026-12-15",
      time: "10:00",
      startsAt: new Date("2026-12-15T10:00:00.000Z"),
      endsAt: new Date("2026-12-15T11:00:00.000Z"),
      timezone: "UTC",
      mode: "online",
      joinUrl: "https://example.com/meet",
      location: "Room 1",
      status: "scheduled",
    });
    await prisma.session.createMany({ data: [
      sessionData(ids.session, "Waitlist session"),
      sessionData(ids.cancelled, "Cancelled session"),
      sessionData(ids.unrelated, "Unrelated session"),
    ] });
    await prisma.sessionRSVP.createMany({ data: [
      { sessionId: ids.session, learnerId: users.learnerB.id, status: "waitlisted", waitlistedAt: new Date("2026-12-01T10:00:00.000Z") },
      { sessionId: ids.session, learnerId: users.learnerA.id, status: "waitlisted", waitlistedAt: new Date("2026-12-02T10:00:00.000Z") },
      { sessionId: ids.cancelled, learnerId: users.learnerA.id, status: "invited" },
    ] });

    for (const key of Object.keys(users)) {
      tokens[key] = signToken({ id: users[key].id, role: "member", orgId: ids.org, tokenVersion: 0 });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cancelled = await authed(tokens.trainer, "POST", `/sessions/${ids.cancelled}/cancel`, { reason: "Venue closed" });
    assert.equal(cancelled.status, 200);
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [ids.cancelled] } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.sessionRSVP.deleteMany({ where: { sessionId: { in: [ids.session, ids.cancelled, ids.unrelated] } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: { in: [ids.session, ids.cancelled, ids.unrelated] } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("learner sessions carry RSVP status, waitlist position, .ics URL and join visibility", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learnerA, "GET", "/sessions");
    assert.equal(res.status, 200);
    const byId = Object.fromEntries(res.body.map((s) => [s.id, s]));
    assert.equal(byId[ids.session].myRsvpStatus, "waitlisted");
    assert.equal(byId[ids.session].myWaitlistPosition, 2);
    assert.equal(byId[ids.session].icsUrl, `/api/sessions/${ids.session}/ics`);
    assert.equal(byId[ids.session].canJoin, true);
    assert.equal(byId[ids.session].joinUrl, "https://example.com/meet");
    assert.equal(byId[ids.cancelled].status, "cancelled");
    assert.equal(byId[ids.cancelled].cancellationReason, "Venue closed");
    assert.equal(byId[ids.unrelated].myRsvpStatus, null);
    assert.equal(byId[ids.unrelated].canJoin, false);
    assert.equal(byId[ids.unrelated].joinUrl, null);
    assert.equal(byId[ids.unrelated].location, null);
  });
});
