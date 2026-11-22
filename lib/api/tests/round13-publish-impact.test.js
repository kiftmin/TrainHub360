import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 13 phase 5 — publish impact", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `r13pi-${stamp}`;
  const ids = {
    orgA: `${prefix}-org-a`,
    orgB: `${prefix}-org-b`,
    programme: `${prefix}-programme`,
    course: `${prefix}-course`,
    module: `${prefix}-module`,
    live: `${prefix}-live`,
    draft: `${prefix}-draft`,
  };
  const users = {};
  const tokens = {};

  const authed = async (token, method, p) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };

  before(async () => {
    if (!requireDatabase("round13-publish-impact.test.js")) return;
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
    await seedRoles(prisma, ["admin", "trainer", "learner"]);
    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: "R13PI Org A" }, { id: ids.orgB, name: "R13PI Org B" }] });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.orgA, name: "R13PI Programme", type: "Test", owner: "owner" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R13PI Course", appliedThreshold: 70 } });
    await prisma.module.create({ data: { id: ids.module, courseId: ids.course, title: "Module" } });
    await prisma.assessment.create({ data: { id: ids.live, moduleId: ids.module, type: "applied", title: "Live", passMark: 70, isPublished: true, publishedAt: new Date() } });
    await prisma.assessment.create({ data: { id: ids.draft, moduleId: ids.module, type: "applied", title: "Draft", passMark: 70, isPublished: false, supersedesId: ids.live, version: 2 } });

    for (const [key, name, orgId] of [
      ["trainer", "R13PI Trainer", ids.orgA],
      ["learner", "R13PI Learner", ids.orgA],
      ["outsider", "R13PI Outsider", ids.orgB],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programme },
      { userId: users.learner.id, roleId: "learner", programmeId: ids.programme },
      { userId: users.outsider.id, roleId: "admin", programmeId: null },
    ] });

    const enrolled = await prisma.user.create({ data: { orgId: ids.orgA, name: "R13PI Enrolled", email: `enrolled-${stamp}@example.com`, passwordHash: "" } });
    const completed = await prisma.user.create({ data: { orgId: ids.orgA, name: "R13PI Completed", email: `completed-${stamp}@example.com`, passwordHash: "" } });
    const withdrawn = await prisma.user.create({ data: { orgId: ids.orgA, name: "R13PI Withdrawn", email: `withdrawn-${stamp}@example.com`, passwordHash: "" } });
    Object.assign(users, { enrolled, completed, withdrawn });
    await prisma.enrolment.createMany({ data: [
      { learnerId: enrolled.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" },
      { learnerId: completed.id, courseId: ids.course, programmeId: ids.programme, status: "completed" },
      { learnerId: withdrawn.id, courseId: ids.course, programmeId: ids.programme, status: "withdrawn", withdrawnAt: new Date() },
    ] });
    const enrolmentRows = await prisma.enrolment.findMany({ where: { courseId: ids.course }, select: { id: true, learnerId: true } });
    const enrolmentIdOf = (learnerId) => enrolmentRows.find((row) => row.learnerId === learnerId).id;
    await prisma.assessmentAttempt.createMany({ data: [enrolled, completed].map((u) => ({
      assessmentId: ids.live,
      enrolmentId: enrolmentIdOf(u.id),
      learnerId: u.id,
      status: "graded",
      score: 1,
      maxScore: 1,
      percent: 100,
      passed: true,
      gradedAt: new Date(),
    })) });

    for (const key of Object.keys(users)) {
      tokens[key] = signToken({ id: users[key].id, role: "member", orgId: users[key].orgId, tokenVersion: 0 });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.assessmentAttempt.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { id: { in: [ids.live, ids.draft] } } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: ids.module } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("programme staff see real counts with withdrawn enrolments excluded", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "GET", `/assessments/${ids.draft}/publish-impact`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enrolled: 2, completed: 1, notCompleted: 1, withAttempts: 2 });
  });

  test("learners cannot read publish impact", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.learner, "GET", `/assessments/${ids.draft}/publish-impact`);
    assert.equal(res.status, 403);
  });

  test("staff in another organization cannot read publish impact", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.outsider, "GET", `/assessments/${ids.draft}/publish-impact`);
    assert.equal(res.status, 404);
  });
});
