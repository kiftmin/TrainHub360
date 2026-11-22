import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 13 phase 4 — removed RSVPs and template permissions", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `r13h-${stamp}`;
  const ids = {
    orgA: `${prefix}-org-a`,
    orgB: `${prefix}-org-b`,
    programme: `${prefix}-programme`,
    otherProgramme: `${prefix}-other-programme`,
    course: `${prefix}-course`,
    session: `${prefix}-session`,
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

  const tokenFor = (user) => signToken({ id: user.id, role: "member", orgId: user.orgId, tokenVersion: 0 });

  before(async () => {
    if (!requireDatabase("round13-hardening.test.js")) return;
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
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner"]);
    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "R13H Org A" },
        { id: ids.orgB, name: "R13H Org B" },
      ],
    });
    await prisma.programme.createMany({
      data: [
        { id: ids.programme, orgId: ids.orgA, name: "R13H Programme", type: "Compliance", owner: "owner" },
        { id: ids.otherProgramme, orgId: ids.orgA, name: "R13H Other Programme", type: "Compliance", owner: "owner" },
      ],
    });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R13H Course", appliedThreshold: 70 } });
    for (const [key, name, orgId] of [
      ["owner", "R13H Owner", ids.orgA],
      ["admin", "R13H Other Programme Admin", ids.orgA],
      ["trainer1", "R13H Trainer One", ids.orgA],
      ["trainer2", "R13H Trainer Two", ids.orgA],
      ["learnerA", "R13H Learner A", ids.orgA],
      ["learnerB", "R13H Learner B", ids.orgA],
      ["learnerC", "R13H Learner C", ids.orgA],
      ["learnerD", "R13H Learner D", ids.orgA],
      ["outsider", "R13H Outsider", ids.orgB],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    for (const data of [
      { userId: users.owner.id, roleId: "owner", programmeId: null },
      { userId: users.admin.id, roleId: "admin", programmeId: ids.otherProgramme },
      { userId: users.trainer1.id, roleId: "trainer", programmeId: ids.programme },
      { userId: users.trainer2.id, roleId: "trainer", programmeId: ids.programme },
      ...["learnerA", "learnerB", "learnerC", "learnerD"].map((key) => ({ userId: users[key].id, roleId: "learner", programmeId: ids.programme })),
    ]) {
      await prisma.userRole.create({ data });
    }
    await prisma.enrolment.createMany({
      data: ["learnerA", "learnerB", "learnerC", "learnerD"].map((key) => ({
        learnerId: users[key].id,
        courseId: ids.course,
        programmeId: ids.programme,
        status: "enrolled",
      })),
    });
    await prisma.session.create({
      data: {
        id: ids.session,
        title: "R13H Session",
        programme: "R13H Programme",
        programmeId: ids.programme,
        orgId: ids.orgA,
        trainer: users.trainer1.name,
        trainerId: users.trainer1.id,
        courseId: ids.course,
        date: "2026-12-15",
        time: "10:00",
        startsAt: new Date("2026-12-15T10:00:00.000Z"),
        endsAt: new Date("2026-12-15T11:00:00.000Z"),
        timezone: "UTC",
        mode: "online",
        joinUrl: "https://example.com/meet",
        capacity: 1,
        status: "scheduled",
      },
    });
    await prisma.sessionRSVP.createMany({
      data: [
        { sessionId: ids.session, learnerId: users.learnerA.id, status: "confirmed" },
        { sessionId: ids.session, learnerId: users.learnerB.id, status: "waitlisted", waitlistedAt: new Date("2026-12-01T10:00:00.000Z") },
        { sessionId: ids.session, learnerId: users.learnerC.id, status: "waitlisted", waitlistedAt: new Date("2026-12-02T10:00:00.000Z") },
        { sessionId: ids.session, learnerId: users.learnerD.id, status: "invited" },
      ],
    });
    for (const key of ["owner", "admin", "trainer1", "trainer2", "learnerA", "learnerB", "learnerC", "learnerD", "outsider"]) {
      tokens[key] = tokenFor(users[key]);
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((row) => row.id);
      const templateIds = (await prisma.messageTemplate.findMany({ where: { orgId: ids.orgA }, select: { id: true } })).map((row) => row.id);
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [ids.session, ...templateIds] } } }).catch(() => null);
      await prisma.sessionRSVP.deleteMany({ where: { sessionId: ids.session } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.messageTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: ids.session } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programmeId: { in: [ids.programme, ids.otherProgramme] } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programme, ids.otherProgramme] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("removal is distinct from decline, blocks confirmation and promotes exactly one waiter", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const removed = await authed(tokens.trainer1, "POST", `/sessions/${ids.session}/remove`, {
      learnerId: users.learnerA.id,
      reason: "Safety escalation",
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.rsvp.status, "removed");
    assert.equal(removed.body.rsvp.removalReason, "Safety escalation");
    assert.equal(removed.body.summary.removed, 1);
    assert.equal(removed.body.summary.confirmed, 1);
    assert.equal(removed.body.summary.declined, 0);
    assert.equal(removed.body.attendees.find((row) => row.learnerId === users.learnerB.id)?.status, "confirmed");
    assert.equal(removed.body.attendees.find((row) => row.learnerId === users.learnerC.id)?.status, "waitlisted");

    const blocked = await authed(tokens.learnerA, "POST", `/sessions/${ids.session}/rsvp`, { status: "confirmed" });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "removed from this session by staff");

    const invitable = await authed(tokens.trainer1, "GET", `/sessions/${ids.session}/invitable`);
    assert.ok(invitable.body.learners.some((row) => row.learnerId === users.learnerA.id));
    assert.ok(!invitable.body.skipped.some((row) => row.learnerId === users.learnerA.id));

    const reinvited = await authed(tokens.trainer1, "POST", `/sessions/${ids.session}/invite`, { learnerIds: [users.learnerA.id] });
    assert.equal(reinvited.status, 200);
    assert.equal(reinvited.body.newlyInvited, 1);
    const restored = await prisma.sessionRSVP.findFirst({ where: { sessionId: ids.session, learnerId: users.learnerA.id } });
    assert.equal(restored?.status, "invited");
    assert.equal(restored?.removedBy, null);
    assert.equal(restored?.removalReason, null);

    const confirmedAgain = await authed(tokens.learnerA, "POST", `/sessions/${ids.session}/rsvp`, { status: "confirmed" });
    assert.equal(confirmedAgain.status, 200);
    assert.equal(confirmedAgain.body.status, "waitlisted");

    const roster = await authed(tokens.trainer1, "GET", `/sessions/${ids.session}/attendees`);
    assert.equal(roster.body.summary.removed, 0);
    assert.equal(roster.body.summary.confirmed, 1);
    assert.equal(roster.body.summary.waitlisted, 2);
  });

  test("template edits and deletes are author/admin/org-staff only and body is capped", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const tooLong = "x".repeat(5001);
    const oversized = await authed(tokens.trainer1, "POST", "/message-templates", { title: "Too long", body: tooLong });
    assert.equal(oversized.status, 400);

    const created = await authed(tokens.trainer1, "POST", "/message-templates", { title: "Booking reply", body: "Thanks for getting in touch." });
    assert.equal(created.status, 201);
    const template = created.body.id;

    const otherTrainerPatch = await authed(tokens.trainer2, "PATCH", `/message-templates/${template}`, { body: "Changed" });
    assert.equal(otherTrainerPatch.status, 403);
    const otherTrainerDelete = await authed(tokens.trainer2, "DELETE", `/message-templates/${template}`);
    assert.equal(otherTrainerDelete.status, 403);

    const authorPatch = await authed(tokens.trainer1, "PATCH", `/message-templates/${template}`, { body: "Author changed" });
    assert.equal(authorPatch.status, 200);
    const longPatch = await authed(tokens.trainer1, "PATCH", `/message-templates/${template}`, { body: tooLong });
    assert.equal(longPatch.status, 400);

    const adminPatch = await authed(tokens.admin, "PATCH", `/message-templates/${template}`, { body: "Admin changed" });
    assert.equal(adminPatch.status, 200);
    const outsiderPatch = await authed(tokens.outsider, "PATCH", `/message-templates/${template}`, { body: "Nope" });
    assert.equal(outsiderPatch.status, 403);

    const adminDelete = await authed(tokens.admin, "DELETE", `/message-templates/${template}`);
    assert.equal(adminDelete.status, 204);
    const list = await authed(tokens.trainer2, "GET", "/message-templates");
    assert.equal(list.status, 200);
    assert.ok(!list.body.some((row) => row.id === template));
  });
});
