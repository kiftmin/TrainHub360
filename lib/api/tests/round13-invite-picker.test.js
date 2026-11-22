import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 13 phase 3 — scalable session invite picker", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `r13ip-${stamp}`;
  const ids = {
    orgA: `${prefix}-org-a`,
    orgB: `${prefix}-org-b`,
    programme: `${prefix}-programme`,
    course: `${prefix}-course`,
    session: `${prefix}-session`,
    bulkProgramme: `${prefix}-bulk-programme`,
    bulkCourse: `${prefix}-bulk-course`,
    bulkSession: `${prefix}-bulk-session`,
    orgSession: `${prefix}-org-session`,
  };
  const sessionIds = [ids.session, ids.bulkSession, ids.orgSession];
  const users = {};
  const tokens = {};
  const bulkUsers = [];
  const allEnrolledUsers = [];
  let deepUser;

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

  const tokenFor = (user, role) => signToken({ id: user.id, role, orgId: user.orgId, tokenVersion: 0 });

  const createSession = (data) => prisma.session.create({
    data: {
      title: data.title,
      programme: data.programme ?? "Org-wide",
      programmeId: data.programmeId ?? null,
      orgId: ids.orgA,
      trainer: users.trainer.name,
      trainerId: users.trainer.id,
      courseId: data.courseId ?? null,
      date: "2026-12-15",
      time: "10:00",
      startsAt: new Date("2026-12-15T10:00:00.000Z"),
      endsAt: new Date("2026-12-15T11:00:00.000Z"),
      timezone: "UTC",
      mode: "online",
      joinUrl: "https://example.com/meet",
      capacity: 2000,
      status: "scheduled",
      ...data,
    },
  });

  before(async () => {
    if (!requireDatabase("round13-invite-picker.test.js")) return;
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
        { id: ids.orgA, name: "R13IP Org A" },
        { id: ids.orgB, name: "R13IP Org B" },
      ],
    });
    await prisma.programme.createMany({
      data: [
        { id: ids.programme, orgId: ids.orgA, name: "R13IP Programme", type: "Compliance", owner: "owner" },
        { id: ids.bulkProgramme, orgId: ids.orgA, name: "R13IP Bulk Programme", type: "Compliance", owner: "owner" },
      ],
    });
    await prisma.course.createMany({
      data: [
        { id: ids.course, programmeId: ids.programme, title: "R13IP Course", appliedThreshold: 70 },
        { id: ids.bulkCourse, programmeId: ids.bulkProgramme, title: "R13IP Bulk Course", appliedThreshold: 70 },
      ],
    });
    for (const [key, name, orgId] of [
      ["trainer", "R13IP Trainer", ids.orgA],
      ["withdrawn", "Withdrawn Learner", ids.orgA],
      ["otherProgramme", "Other Programme Learner", ids.orgA],
      ["outsideOrg", "Outside Org Learner", ids.orgB],
      ["alreadyInvited", "Already Invited Learner", ids.orgA],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.create({ data: { userId: users.trainer.id, roleId: "owner", programmeId: null } });

    const bulkRows = Array.from({ length: 1200 }, (_, index) => {
      const id = `${prefix}-bulk-${String(index).padStart(4, "0")}`;
      return { id, orgId: ids.orgA, name: index === 1199 ? "ZZ Ultimate Learner" : `Bulk Learner ${String(index).padStart(4, "0")}`, email: `${id}@example.com`, passwordHash: "" };
    });
    deepUser = bulkRows[bulkRows.length - 1];
    await prisma.user.createMany({ data: bulkRows });
    await prisma.enrolment.createMany({
      data: bulkRows.map((row) => ({ learnerId: row.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" })),
    });
    await prisma.enrolment.createMany({
      data: [
        { learnerId: users.withdrawn.id, courseId: ids.course, programmeId: ids.programme, status: "withdrawn", withdrawnAt: new Date() },
        { learnerId: users.otherProgramme.id, courseId: ids.bulkCourse, programmeId: ids.bulkProgramme, status: "enrolled" },
        { learnerId: users.outsideOrg.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" },
        { learnerId: users.alreadyInvited.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" },
      ],
    });

    const allEnrolledRows = Array.from({ length: 520 }, (_, index) => {
      const id = `${prefix}-all-${String(index).padStart(4, "0")}`;
      return { id, orgId: ids.orgA, name: `All Learner ${String(index).padStart(4, "0")}`, email: `${id}@example.com`, passwordHash: "" };
    });
    allEnrolledUsers.push(...allEnrolledRows);
    await prisma.user.createMany({ data: allEnrolledRows });
    await prisma.enrolment.createMany({
      data: allEnrolledRows.map((row) => ({ learnerId: row.id, courseId: ids.bulkCourse, programmeId: ids.bulkProgramme, status: "enrolled" })),
    });

    await createSession({ id: ids.session, title: "R13IP Session", programme: "R13IP Programme", programmeId: ids.programme, courseId: ids.course });
    await createSession({ id: ids.bulkSession, title: "R13IP Bulk Session", programme: "R13IP Bulk Programme", programmeId: ids.bulkProgramme, courseId: ids.bulkCourse });
    await createSession({ id: ids.orgSession, title: "R13IP Org Session" });
    await prisma.sessionRSVP.create({ data: { sessionId: ids.session, learnerId: users.alreadyInvited.id, status: "invited" } });

    tokens.trainer = tokenFor(users.trainer, "owner");
    tokens.learner = tokenFor(bulkRows[0], "learner");
    tokens.outsider = tokenFor(users.outsideOrg, "owner");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = [...bulkUsers.map((row) => row.id), ...allEnrolledUsers.map((row) => row.id), ...Object.values(users).map((row) => row.id)];
      await prisma.auditLog.deleteMany({ where: { entity: "session", entityId: { in: sessionIds } } }).catch(() => null);
      await prisma.sessionRSVP.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programmeId: { in: [ids.programme, ids.bulkProgramme] } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.course, ids.bulkCourse] } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programme, ids.bulkProgramme] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("filters in the database, finds a deep learner by search and pages stably", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const learner = await authed(tokens.learner, "GET", `/sessions/${ids.session}/invitable`);
    assert.equal(learner.status, 403);
    const outsider = await authed(tokens.outsider, "GET", `/sessions/${ids.session}/invitable`);
    assert.equal(outsider.status, 404);

    const first = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/invitable?limit=200`);
    assert.equal(first.status, 200);
    assert.equal(first.body.total, 1200);
    assert.equal(first.body.limit, 200);
    assert.equal(first.body.learners.length, 200);
    assert.ok(first.body.nextCursor);
    assert.equal(first.body.skipped.find((row) => row.learnerId === users.alreadyInvited.id)?.reason, "already_invited");

    const shortQuery = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/invitable?q=U`);
    assert.equal(shortQuery.status, 400);
    const badCursor = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/invitable?cursor=not-a-cursor`);
    assert.equal(badCursor.status, 400);

    const searched = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/invitable?q=ULTIMATE`);
    assert.equal(searched.status, 200);
    assert.equal(searched.body.total, 1);
    assert.equal(searched.body.learners[0].learnerId, deepUser.id);

    const seen = first.body.learners.map((row) => row.learnerId);
    let cursor = first.body.nextCursor;
    while (cursor) {
      const page = await authed(tokens.trainer, "GET", `/sessions/${ids.session}/invitable?limit=200&cursor=${encodeURIComponent(cursor)}`);
      assert.equal(page.status, 200);
      seen.push(...page.body.learners.map((row) => row.learnerId));
      cursor = page.body.nextCursor;
    }
    assert.equal(seen.length, 1200);
    assert.equal(new Set(seen).size, 1200);
    for (const excluded of [users.withdrawn.id, users.otherProgramme.id, users.outsideOrg.id, users.alreadyInvited.id]) {
      assert.ok(!seen.includes(excluded));
    }
  });

  test("org-level sessions offer active users from the organization only", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const result = await authed(tokens.trainer, "GET", `/sessions/${ids.orgSession}/invitable?q=ULTIMATE`);
    assert.equal(result.status, 200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.learners[0].learnerId, deepUser.id);
    assert.ok(!result.body.learners.some((row) => row.learnerId === users.outsideOrg.id));
  });

  test("allEnrolled invites every eligible learner beyond the 500-id batch cap", async (t) => {
    if (!prisma || !server) return t.skip("database unavailable");
    const result = await authed(tokens.trainer, "POST", `/sessions/${ids.bulkSession}/invite`, { allEnrolled: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.allEnrolled, true);
    assert.equal(result.body.selectedCount, 521);
    assert.equal(result.body.newlyInvited, 521);
    assert.equal(result.body.skippedCount, 0);
    const count = await prisma.sessionRSVP.count({ where: { sessionId: ids.bulkSession } });
    assert.equal(count, 521);
  });
});
