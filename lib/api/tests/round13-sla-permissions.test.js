import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Round 13 phase 2 — SLA permissions and defaults", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `r13sla-org-${stamp}`,
    programmeA: `r13sla-programme-a-${stamp}`,
    programmeA2: `r13sla-programme-a2-${stamp}`,
  };
  const users = {};
  const tokens = {};
  const threadIds = [];

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
    if (!requireDatabase("round13-sla-permissions.test.js")) return;
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
    await prisma.organization.create({ data: { id: ids.org, name: "R13 SLA Org" } });
    await prisma.programme.createMany({ data: [
      { id: ids.programmeA, orgId: ids.org, name: "R13 SLA Programme A", type: "Compliance", owner: "owner", slaHours: 12 },
      { id: ids.programmeA2, orgId: ids.org, name: "R13 SLA Programme A2", type: "Compliance", owner: "owner" },
    ] });
    for (const [key, name] of [
      ["owner", "R13 SLA Owner"],
      ["admin", "R13 SLA Programme Admin"],
      ["otherAdmin", "R13 SLA Other Programme Admin"],
      ["trainer", "R13 SLA Trainer"],
      ["learner", "R13 SLA Learner"],
      ["learner2", "R13 SLA Learner Two"],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId: ids.org, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    for (const data of [
      { userId: users.owner.id, roleId: "owner", programmeId: null },
      { userId: users.admin.id, roleId: "admin", programmeId: ids.programmeA },
      { userId: users.otherAdmin.id, roleId: "admin", programmeId: ids.programmeA2 },
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programmeA },
      { userId: users.learner.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: users.learner2.id, roleId: "learner", programmeId: ids.programmeA2 },
    ]) {
      await prisma.userRole.create({ data });
    }
    tokens.owner = tokenFor(users.owner, "owner");
    tokens.admin = tokenFor(users.admin, "admin");
    tokens.otherAdmin = tokenFor(users.otherAdmin, "admin");
    tokens.trainer = tokenFor(users.trainer, "trainer");
    tokens.learner = tokenFor(users.learner, "learner");
    tokens.learner2 = tokenFor(users.learner2, "learner");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      const entityIds = [...threadIds, ids.org, ids.programmeA, ids.programmeA2];
      await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.message.deleteMany({ where: { threadId: { in: threadIds } } }).catch(() => null);
      await prisma.threadParticipant.deleteMany({ where: { threadId: { in: threadIds } } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { id: { in: threadIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programmeA, ids.programmeA2] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("participants cannot change SLA, programme admins can, and the change is audited", async (t) => {
    if (!server) return t.skip("database unavailable");
    const created = await authed(tokens.learner, "POST", "/threads", {
      subject: "Permissions check",
      programmeId: ids.programmeA,
      participantIds: [users.trainer.id],
      body: "Who can change this window?",
      slaHours: 720,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.slaHours, 12);
    threadIds.push(created.body.id);

    const trainerDenied = await authed(tokens.trainer, "PATCH", `/threads/${created.body.id}/sla`, { slaHours: 8 });
    assert.equal(trainerDenied.status, 403);
    const learnerDenied = await authed(tokens.learner, "PATCH", `/threads/${created.body.id}/sla`, { slaHours: 8 });
    assert.equal(learnerDenied.status, 403);
    const otherAdminDenied = await authed(tokens.otherAdmin, "PATCH", `/threads/${created.body.id}/sla`, { slaHours: 8 });
    assert.equal(otherAdminDenied.status, 404);

    const changed = await authed(tokens.admin, "PATCH", `/threads/${created.body.id}/sla`, { slaHours: 8 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.slaHours, 8);
    const audit = await prisma.auditLog.findFirst({ where: { action: "THREAD_SLA_UPDATED", entityId: created.body.id } });
    assert.ok(audit);
    assert.deepEqual(JSON.parse(audit.details), { from: 12, slaHours: 8 });
  });

  test("only programme admins and org staff may set a new thread's SLA", async (t) => {
    if (!server) return t.skip("database unavailable");
    const learner = await authed(tokens.learner, "POST", "/threads", {
      subject: "Learner window",
      programmeId: ids.programmeA,
      participantIds: [users.trainer.id],
      body: "Please advise.",
      slaHours: 720,
    });
    assert.equal(learner.status, 201);
    assert.equal(learner.body.slaHours, 12);
    threadIds.push(learner.body.id);

    const admin = await authed(tokens.admin, "POST", "/threads", {
      subject: "Admin window",
      programmeId: ids.programmeA,
      participantIds: [users.trainer.id],
      body: "Response window set by an admin.",
      slaHours: 48,
    });
    assert.equal(admin.status, 201);
    assert.equal(admin.body.slaHours, 48);
    threadIds.push(admin.body.id);

    const invalid = await authed(tokens.admin, "POST", "/threads", {
      subject: "Invalid window",
      programmeId: ids.programmeA,
      participantIds: [users.trainer.id],
      body: "This should fail.",
      slaHours: 721,
    });
    assert.equal(invalid.status, 400);
  });

  test("default resolution uses programme, then organization, then 24", async (t) => {
    if (!server) return t.skip("database unavailable");
    const before = await authed(tokens.learner2, "POST", "/threads", {
      subject: "Fallback before change",
      programmeId: ids.programmeA2,
      participantIds: [users.otherAdmin.id],
      body: "No programme override here.",
    });
    assert.equal(before.status, 201);
    assert.equal(before.body.slaHours, 24);
    threadIds.push(before.body.id);

    const orgPatch = await authed(tokens.owner, "PATCH", `/organizations/${ids.org}`, { defaultSlaHours: 36 });
    assert.equal(orgPatch.status, 200);
    assert.equal(orgPatch.body.defaultSlaHours, 36);
    const orgAudit = await prisma.auditLog.findFirst({ where: { action: "ORGANIZATION_DEFAULT_SLA_UPDATED", entityId: ids.org } });
    assert.ok(orgAudit);
    assert.deepEqual(JSON.parse(orgAudit.details), { from: 24, defaultSlaHours: 36 });

    const orgDefault = await authed(tokens.learner2, "POST", "/threads", {
      subject: "Organization default",
      programmeId: ids.programmeA2,
      participantIds: [users.otherAdmin.id],
      body: "Using the workspace default.",
      slaHours: 2,
    });
    assert.equal(orgDefault.status, 201);
    assert.equal(orgDefault.body.slaHours, 36);
    threadIds.push(orgDefault.body.id);

    const programmePatch = await authed(tokens.admin, "PATCH", `/programmes/${ids.programmeA}`, { slaHours: 18 });
    assert.equal(programmePatch.status, 200);
    assert.equal(programmePatch.body.slaHours, 18);
    const programmeAudit = await prisma.auditLog.findFirst({ where: { action: "PROGRAMME_SLA_UPDATED", entityId: ids.programmeA } });
    assert.ok(programmeAudit);
    assert.deepEqual(JSON.parse(programmeAudit.details), { from: 12, slaHours: 18 });

    const programmeDefault = await authed(tokens.learner, "POST", "/threads", {
      subject: "Programme default",
      programmeId: ids.programmeA,
      participantIds: [users.trainer.id],
      body: "Using the programme override.",
    });
    assert.equal(programmeDefault.status, 201);
    assert.equal(programmeDefault.body.slaHours, 18);
    threadIds.push(programmeDefault.body.id);

    const invalidOrg = await authed(tokens.owner, "PATCH", `/organizations/${ids.org}`, { defaultSlaHours: 721 });
    assert.equal(invalidOrg.status, 400);
    const invalidProgramme = await authed(tokens.admin, "PATCH", `/programmes/${ids.programmeA}`, { slaHours: 0 });
    assert.equal(invalidProgramme.status, 400);
  });
});
