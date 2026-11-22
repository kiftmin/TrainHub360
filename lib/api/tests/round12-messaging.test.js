import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 12 phase 3 — course threads, SLA and canned responses", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgA: `r12msg-org-a-${stamp}`,
    orgB: `r12msg-org-b-${stamp}`,
    programmeA: `r12msg-programme-a-${stamp}`,
    programmeA2: `r12msg-programme-a2-${stamp}`,
    programmeB: `r12msg-programme-b-${stamp}`,
    courseA: `r12msg-course-a-${stamp}`,
    courseA2: `r12msg-course-a2-${stamp}`,
    courseB: `r12msg-course-b-${stamp}`,
  };
  const users = {};
  const tokens = {};
  const threadIds = [];
  const templateIds = [];

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

  before(async () => {
    if (!requireDatabase("round12-messaging.test.js")) return;
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
    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: "R12MSG Org A" }, { id: ids.orgB, name: "R12MSG Org B" }] });
    await prisma.programme.createMany({ data: [
      { id: ids.programmeA, orgId: ids.orgA, name: "R12MSG Programme A", type: "Compliance", owner: "owner" },
      { id: ids.programmeA2, orgId: ids.orgA, name: "R12MSG Programme A2", type: "Compliance", owner: "owner" },
      { id: ids.programmeB, orgId: ids.orgB, name: "R12MSG Programme B", type: "Compliance", owner: "owner" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.programmeA, title: "R12MSG Course A" },
      { id: ids.courseA2, programmeId: ids.programmeA2, title: "R12MSG Course A2" },
      { id: ids.courseB, programmeId: ids.programmeB, title: "R12MSG Course B" },
    ] });
    for (const [key, name, orgId] of [
      ["owner", "R12MSG Owner", ids.orgA],
      ["trainer", "R12MSG Trainer", ids.orgA],
      ["learner", "R12MSG Learner", ids.orgA],
      ["outsider", "R12MSG Outsider Trainer", ids.orgB],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    for (const data of [
      { userId: users.owner.id, roleId: "owner", programmeId: null },
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programmeA },
      { userId: users.learner.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: users.outsider.id, roleId: "trainer", programmeId: ids.programmeB },
    ]) {
      await prisma.userRole.create({ data });
    }
    tokens.owner = tokenFor(users.owner, "owner");
    tokens.trainer = tokenFor(users.trainer, "trainer");
    tokens.learner = tokenFor(users.learner, "learner");
    tokens.outsider = tokenFor(users.outsider, "trainer");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      const entityIds = [...threadIds, ...templateIds];
      await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.message.deleteMany({ where: { threadId: { in: threadIds } } }).catch(() => null);
      await prisma.threadParticipant.deleteMany({ where: { threadId: { in: threadIds } } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { id: { in: threadIds } } }).catch(() => null);
      await prisma.messageTemplate.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseA2, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programmeA, ids.programmeA2, ids.programmeB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("course threads persist the course, filter by scope and expose SLA state", async (t) => {
    if (!server) return t.skip("database unavailable");
    const created = await authed(tokens.trainer, "POST", "/threads", {
      subject: "Course question",
      programmeId: ids.programmeA,
      courseId: ids.courseA,
      participantIds: [users.learner.id],
      body: "How do I complete the final module?",
      slaHours: 48,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.courseId, ids.courseA);
    assert.equal(created.body.slaHours, 48);
    threadIds.push(created.body.id);

    const inCourse = await authed(tokens.trainer, "GET", `/threads?courseId=${ids.courseA}`);
    assert.equal(inCourse.status, 200);
    assert.ok(inCourse.body.some((row) => row.id === created.body.id && row.course?.title === "R12MSG Course A"));
    assert.equal(inCourse.body.find((row) => row.id === created.body.id).slaState, "ok");
    assert.equal(inCourse.body.find((row) => row.id === created.body.id).averageResponseTimeHours, null);

    const otherCourse = await authed(tokens.trainer, "GET", `/threads?courseId=${ids.courseB}`);
    assert.ok(!otherCourse.body.some((row) => row.id === created.body.id));
    const otherProgramme = await authed(tokens.trainer, "GET", `/threads?programmeId=${ids.programmeB}`);
    assert.ok(!otherProgramme.body.some((row) => row.id === created.body.id));
  });

  test("a course from another programme is refused", async (t) => {
    if (!server) return t.skip("database unavailable");
    const res = await authed(tokens.trainer, "POST", "/threads", {
      subject: "Wrong course",
      programmeId: ids.programmeA,
      courseId: ids.courseA2,
      participantIds: [users.learner.id],
      body: "This should fail.",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /course does not belong/);
  });

  test("canned responses are staff-only, org-scoped and soft-deleted", async (t) => {
    if (!server) return t.skip("database unavailable");
    const learnerDenied = await authed(tokens.learner, "GET", "/message-templates");
    assert.equal(learnerDenied.status, 403);
    const outsiderList = await authed(tokens.outsider, "GET", "/message-templates");
    assert.equal(outsiderList.status, 200);
    assert.ok(!outsiderList.body.some((row) => row.title === "Welcome"));

    const created = await authed(tokens.trainer, "POST", "/message-templates", { title: "Welcome", body: "Welcome to the programme." });
    assert.equal(created.status, 201);
    templateIds.push(created.body.id);
    const listed = await authed(tokens.trainer, "GET", "/message-templates");
    assert.ok(listed.body.some((row) => row.id === created.body.id));

    const updated = await authed(tokens.trainer, "PATCH", `/message-templates/${created.body.id}`, { body: "Welcome aboard." });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.body, "Welcome aboard.");

    const removed = await authed(tokens.trainer, "DELETE", `/message-templates/${created.body.id}`);
    assert.equal(removed.status, 204);
    const after = await authed(tokens.trainer, "GET", "/message-templates");
    assert.ok(!after.body.some((row) => row.id === created.body.id));

    const crossOrg = await authed(tokens.outsider, "PATCH", `/message-templates/${created.body.id}`, { title: "Hijack" });
    assert.equal(crossOrg.status, 404);
  });

  test("overdue threads are surfaced, escalated once and have an editable SLA window", async (t) => {
    if (!server) return t.skip("database unavailable");
    const created = await authed(tokens.learner, "POST", "/threads", {
      subject: "Trainer help",
      programmeId: ids.programmeA,
      courseId: ids.courseA,
      participantIds: [users.trainer.id],
      body: "Can you help?",
      slaHours: 1,
    });
    assert.equal(created.status, 201);
    threadIds.push(created.body.id);
    await prisma.messageThread.update({
      where: { id: created.body.id },
      data: { lastLearnerMessageAt: new Date(Date.now() - (2 * 60 * 60 * 1000)) },
    });

    const pending = await authed(tokens.trainer, "GET", `/threads?courseId=${ids.courseA}&slaStatus=reply_pending`);
    assert.equal(pending.status, 200);
    const pendingRow = pending.body.find((row) => row.id === created.body.id);
    assert.ok(pendingRow);
    assert.equal(pendingRow.slaState, "reply_pending");
    assert.match(pendingRow.slaStatus, /reply pending/);

    const firstRun = await authed(tokens.owner, "POST", "/sla/run");
    assert.equal(firstRun.status, 200);
    assert.ok(firstRun.body.escalated >= 1);
    const escalated = await prisma.messageThread.findUnique({ where: { id: created.body.id } });
    assert.equal(escalated.isEscalated, true);
    assert.ok(escalated.escalatedAt);
    let audits = await prisma.auditLog.findMany({ where: { action: "SLA_ESCALATION", entityId: created.body.id } });
    assert.equal(audits.length, 1);

    const secondRun = await authed(tokens.owner, "POST", "/sla/run");
    assert.equal(secondRun.status, 200);
    audits = await prisma.auditLog.findMany({ where: { action: "SLA_ESCALATION", entityId: created.body.id } });
    assert.equal(audits.length, 1);

    const changed = await authed(tokens.trainer, "PATCH", `/threads/${created.body.id}/sla`, { slaHours: 8 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.slaHours, 8);
    const invalid = await authed(tokens.trainer, "PATCH", `/threads/${created.body.id}/sla`, { slaHours: 0 });
    assert.equal(invalid.status, 400);
  });
});
