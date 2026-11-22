import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 12 phase 1 — session roster for trainers", () => {
  let server;
  let baseUrl = "";
  let prisma;
  let session;
  const stamp = Date.now();
  const ids = {
    orgA: `r12sr-org-a-${stamp}`,
    orgB: `r12sr-org-b-${stamp}`,
    programme: `r12sr-programme-${stamp}`,
    course: `r12sr-course-${stamp}`,
    session: `r12sr-session-${stamp}`,
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

  const authedText = async (token, method, p, body) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };

  const tokenFor = (user, role) => signToken({ id: user.id, role, orgId: user.orgId, tokenVersion: 0 });

  before(async () => {
    if (!requireDatabase("round12-session-roster.test.js")) return;
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
    await seedRoles(prisma, ["owner", "trainer", "learner"]);
    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "R12SR Org A" },
        { id: ids.orgB, name: "R12SR Org B" },
      ],
    });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.orgA, name: "R12SR Programme", type: "Compliance", owner: "owner" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R12SR Course", appliedThreshold: 70 } });
    for (const [key, name, orgId] of [
      ["owner", "R12SR Owner", ids.orgA],
      ["trainer", "R12SR Trainer", ids.orgA],
      ["learnerA", "R12SR Learner A", ids.orgA],
      ["learnerB", "R12SR Learner B", ids.orgA],
      ["learnerC", "R12SR Learner C", ids.orgA],
      ["learnerD", "R12SR Learner D", ids.orgA],
      ["learnerNoEnrolment", "R12SR Learner Outside", ids.orgA],
      ["outsider", "R12SR Outsider", ids.orgB],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    for (const data of [
      { userId: users.owner.id, roleId: "owner", programmeId: null },
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programme },
      { userId: users.outsider.id, roleId: "owner", programmeId: null },
      ...["learnerA", "learnerB", "learnerC", "learnerD", "learnerNoEnrolment"].map((key) => ({ userId: users[key].id, roleId: "learner", programmeId: ids.programme })),
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
    session = await prisma.session.create({
      data: {
        id: ids.session,
        title: "R12SR Session",
        programme: "R12SR Programme",
        programmeId: ids.programme,
        orgId: ids.orgA,
        trainer: users.trainer.name,
        trainerId: users.trainer.id,
        courseId: ids.course,
        date: "2026-12-01",
        time: "10:00",
        startsAt: new Date("2026-12-01T10:00:00.000Z"),
        endsAt: new Date("2026-12-01T11:00:00.000Z"),
        timezone: "UTC",
        mode: "online",
        joinUrl: "https://example.com/meet",
        capacity: 1,
        status: "scheduled",
      },
    });
    tokens.owner = tokenFor(users.owner, "owner");
    tokens.trainer = tokenFor(users.trainer, "trainer");
    tokens.learnerA = tokenFor(users.learnerA, "learner");
    tokens.outsider = tokenFor(users.outsider, "owner");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((user) => user.id);
      await prisma.auditLog.deleteMany({ where: { entity: "session", entityId: ids.session } }).catch(() => null);
      await prisma.sessionRSVP.deleteMany({ where: { sessionId: ids.session } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: ids.session } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programmeId: ids.programme } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("attendees is programme-staff scoped and reports capacity", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const learner = await authed(tokens.learnerA, "GET", `/sessions/${ids.session}/attendees`);
    assert.equal(learner.status, 403);
    const outsider = await authed(tokens.outsider, "GET", `/sessions/${ids.session}/attendees`);
    assert.equal(outsider.status, 404);
    const staff = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/attendees`);
    assert.equal(staff.status, 200);
    assert.equal(staff.body.capacity, 1);
    assert.equal(staff.body.attendeeCount, 0);
    assert.equal(staff.body.seatsRemaining, 1);
    assert.deepEqual(staff.body.attendees, []);
  });

  test("invite records skip reasons and invitable excludes people already on the list", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const invited = await authed(tokens.trainer, "POST", `/sessions/${ids.session}/invite`, {
      learnerIds: [users.learnerA.id, users.learnerB.id, users.outsider.id],
    });
    assert.equal(invited.status, 200);
    assert.equal(invited.body.newlyInvited, 2);
    assert.deepEqual(invited.body.skipped, [users.outsider.id]);
    assert.equal(invited.body.skippedReasons[users.outsider.id], "user_not_found_or_inactive");

    const invitable = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/invitable`);
    assert.equal(invitable.status, 200);
    const eligibleIds = invitable.body.learners.map((row) => row.learnerId);
    assert.ok(eligibleIds.includes(users.learnerC.id));
    assert.ok(eligibleIds.includes(users.learnerD.id));
    assert.ok(!eligibleIds.includes(users.learnerA.id));
    assert.ok(!eligibleIds.includes(users.learnerB.id));
    assert.equal(invitable.body.skipped.find((row) => row.learnerId === users.learnerA.id)?.reason, "already_invited");

    const roster = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/attendees`);
    assert.equal(roster.body.invited, 2);
    assert.equal(roster.body.attendees.length, 2);
  });

  test("removing a confirmed attendee audits the action and promotes the waitlist", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const first = await authed(tokens.trainer, "POST", `/sessions/${ids.session}/rsvp`, {
      learnerId: users.learnerA.id,
      status: "confirmed",
    });
    assert.equal(first.status, 200);
    const second = await authed(tokens.trainer, "POST", `/sessions/${ids.session}/rsvp`, {
      learnerId: users.learnerB.id,
      status: "confirmed",
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.status, "waitlisted");

    const before = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/attendees`);
    assert.equal(before.body.confirmed, 1);
    assert.equal(before.body.waitlisted, 1);
    assert.equal(before.body.seatsRemaining, 0);

    const removed = await authed(tokens.trainer, "POST", `/sessions/${ids.session}/remove`, {
      learnerId: users.learnerA.id,
      reason: "Schedule conflict",
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.previousStatus, "confirmed");
    assert.equal(removed.body.reason, "Schedule conflict");
    assert.equal(removed.body.summary.confirmed, 1);
    assert.equal(removed.body.summary.waitlisted, 0);
    assert.equal(removed.body.attendees.find((row) => row.learnerId === users.learnerA.id)?.status, "declined");
    assert.equal(removed.body.attendees.find((row) => row.learnerId === users.learnerB.id)?.status, "confirmed");

    const audits = await prisma.auditLog.findMany({
      where: { entity: "session", entityId: ids.session, action: "SESSION_ATTENDEE_REMOVED" },
    });
    assert.equal(audits.length, 1);
    assert.match(String(audits[0].details ?? ""), /Schedule conflict/);
    const promotion = await prisma.notification.findFirst({
      where: { userId: users.learnerB.id, type: "session_waitlist_promoted" },
    });
    assert.ok(promotion);
  });

  test("invite reports duplicate and enrolment skip reasons", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const result = await authed(tokens.trainer, "POST", `/sessions/${ids.session}/invite`, {
      learnerIds: [users.learnerNoEnrolment.id, users.learnerD.id, users.learnerD.id],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.skippedReasons[users.learnerNoEnrolment.id], "not_enrolled_in_course");
    assert.equal(result.body.skippedReasons[users.learnerD.id], "duplicate_request");
    assert.equal(result.body.results.filter((row) => row.learnerId === users.learnerD.id).length, 1);
  });

  test("patch and cancel carry reasons to attendees and bump the calendar sequence", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const updated = await authed(tokens.trainer, "PATCH", `/sessions/${ids.session}`, {
      title: "R12SR Updated Session",
      reason: "Room changed",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.sequence, session.sequence + 1);
    const updateNotice = await prisma.notification.findFirst({
      where: { userId: users.learnerB.id, type: "session_updated" },
    });
    assert.match(updateNotice?.body ?? "", /Room changed/);

    const cancelled = await authed(tokens.trainer, "POST", `/sessions/${ids.session}/cancel`, {
      reason: "Fire drill",
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(cancelled.body.sequence, session.sequence + 2);
    const cancelNotice = await prisma.notification.findFirst({
      where: { userId: users.learnerB.id, type: "session_cancelled" },
    });
    assert.match(cancelNotice?.body ?? "", /Fire drill/);

    const ics = await authedText(tokens.trainer, "GET", `/sessions/${ids.session}/ics`);
    assert.equal(ics.status, 200);
    assert.match(ics.text, /METHOD:CANCEL/);
    assert.match(ics.text, /SEQUENCE:2/);
  });
});
