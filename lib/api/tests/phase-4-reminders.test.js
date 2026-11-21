// Phase D — reminder cadence and calendar files.
//
// What this suite exists to catch: a cadence that is accepted but ignored, a job that sends the
// same reminder twice, reminders to people who declined, were withdrawn or deactivated, an .ics
// that changes its UID (so clients duplicate events) or fails to bump SEQUENCE (so clients ignore
// an update or a cancellation), and a feed token stored in plaintext.
import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { setEmailSender } from "../dist/services/email.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";
import { resetTestState } from "./support/resetTestState.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("Phase D reminders and calendar files", () => {
  const stamp = Date.now();
  const HOUR = 3600_000;
  const ids = {
    org: `pd-org-${stamp}`,
    otherOrg: `pd-org-b-${stamp}`,
    programme: `pd-prog-${stamp}`,
    otherProgramme: `pd-prog-b-${stamp}`,
    course: `pd-course-${stamp}`,
    otherCourse: `pd-course-b-${stamp}`,
    admin: `pd-admin-${stamp}@example.com`,
    otherAdmin: `pd-other-admin-${stamp}@example.com`,
    confirmed: `pd-confirmed-${stamp}@example.com`,
    unanswered: `pd-unanswered-${stamp}@example.com`,
    declined: `pd-declined-${stamp}@example.com`,
    withdrawn: `pd-withdrawn-${stamp}@example.com`,
    inactive: `pd-inactive-${stamp}@example.com`,
    outsider: `pd-outsider-${stamp}@example.com`,
    otherLearner: `pd-other-learner-${stamp}@example.com`,
    session: `pd-session-${stamp}`,
    otherSession: `pd-other-session-${stamp}`,
  };
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  let runReminders;
  const users = {};
  const tokens = {};
  const now = new Date("2026-06-01T09:00:00.000Z");
  const startsAt = new Date(now.getTime() + 20 * HOUR);

  const authed = async (token, method, p, body) => {
    const res = await fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text };
  };
  const unauthed = async (p) => {
    const res = await fetch(`${baseUrl}/api${p}`);
    return { status: res.status, text: await res.text() };
  };

  before(async () => {
    await resetTestState();
    if (!requireDatabase("phase-4-reminders.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    ({ runReminders } = await import("../dist/services/reminderCadence.js"));
    setEmailSender({ send: async () => true });
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.createMany({
      data: [
        { id: ids.org, name: "PD Org", reminderCadenceJson: JSON.stringify({ unansweredHours: [48], confirmedBeforeStartHours: [24, 1], maxUnanswered: 2 }) },
        { id: ids.otherOrg, name: "PD Other Org", reminderCadenceJson: JSON.stringify({ unansweredHours: [10], confirmedBeforeStartHours: [1], maxUnanswered: 1 }) },
      ],
    });
    await prisma.programme.createMany({
      data: [
        { id: ids.programme, orgId: ids.org, name: "PD Prog", type: "Test", owner: "t" },
        { id: ids.otherProgramme, orgId: ids.otherOrg, name: "PD Other Prog", type: "Test", owner: "t" },
      ],
    });
    await prisma.course.createMany({
      data: [
        { id: ids.course, programmeId: ids.programme, title: "PD Course" },
        { id: ids.otherCourse, programmeId: ids.otherProgramme, title: "PD Other Course" },
      ],
    });

    const pw = await hashPassword("pw-pd");
    const mkUser = async (orgId, email, extra = {}) => prisma.user.create({ data: { orgId, name: email, email, passwordHash: pw, ...extra } });
    users.admin = await mkUser(ids.org, ids.admin);
    users.otherAdmin = await mkUser(ids.otherOrg, ids.otherAdmin);
    users.confirmed = await mkUser(ids.org, ids.confirmed);
    users.unanswered = await mkUser(ids.org, ids.unanswered);
    users.declined = await mkUser(ids.org, ids.declined);
    users.withdrawn = await mkUser(ids.org, ids.withdrawn);
    users.inactive = await mkUser(ids.org, ids.inactive, { isActive: false });
    users.outsider = await mkUser(ids.org, ids.outsider);
    users.otherLearner = await mkUser(ids.otherOrg, ids.otherLearner);
    await prisma.userRole.createMany({
      data: [
        { userId: users.admin.id, roleId: "admin", programmeId: null },
        { userId: users.otherAdmin.id, roleId: "admin", programmeId: null },
      ],
    });
    const learnerIds = ["confirmed", "unanswered", "declined", "withdrawn", "inactive", "outsider"];
    await prisma.enrolment.createMany({
      data: learnerIds.map((key) => ({ learnerId: users[key].id, courseId: ids.course, programmeId: ids.programme, status: key === "withdrawn" ? "withdrawn" : "enrolled" })),
    });
    await prisma.enrolment.create({ data: { learnerId: users.otherLearner.id, courseId: ids.otherCourse, programmeId: ids.otherProgramme, status: "enrolled" } });

    for (const key of ["admin", "otherAdmin", "confirmed", "unanswered", "declined", "outsider", "otherLearner"]) {
      const role = key === "admin" || key === "otherAdmin" ? "admin" : "learner";
      const orgId = key === "otherAdmin" || key === "otherLearner" ? ids.otherOrg : ids.org;
      tokens[key] = signToken({ id: users[key].id, role, orgId, tokenVersion: 0 });
    }

    const date = startsAt.toISOString().slice(0, 10);
    const time = startsAt.toISOString().slice(11, 16);
    await prisma.session.createMany({
      data: [
        {
          id: ids.session, orgId: ids.org, title: "PD Session", programmeId: ids.programme, courseId: ids.course,
          date, time, startsAt, endsAt: new Date(startsAt.getTime() + 2 * HOUR), sequence: 0,
          mode: "online", joinUrl: "https://meet.example.com/pd", location: "Room 4",
        },
        {
          id: ids.otherSession, orgId: ids.otherOrg, title: "PD Other Session", programmeId: ids.otherProgramme, courseId: ids.otherCourse,
          date, time, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), sequence: 0,
          mode: "offline", location: "Other Room",
        },
      ],
    });
    const invitedAt = new Date(now.getTime() - 60 * HOUR);
    await prisma.sessionRSVP.createMany({
      data: [
        { sessionId: ids.session, learnerId: users.confirmed.id, status: "confirmed", respondedAt: new Date(), createdAt: invitedAt },
        { sessionId: ids.session, learnerId: users.unanswered.id, status: "invited", createdAt: invitedAt },
        { sessionId: ids.session, learnerId: users.declined.id, status: "declined", respondedAt: new Date(), createdAt: invitedAt },
        { sessionId: ids.session, learnerId: users.withdrawn.id, status: "confirmed", respondedAt: new Date(), createdAt: invitedAt },
        { sessionId: ids.session, learnerId: users.inactive.id, status: "invited", createdAt: invitedAt },
        { sessionId: ids.otherSession, learnerId: users.otherLearner.id, status: "invited", createdAt: new Date(now.getTime() - 11 * HOUR) },
      ],
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    setEmailSender(null);
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.reminderLog.deleteMany({ where: { sessionId: { in: [ids.session, ids.otherSession] } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { id: { in: [ids.session, ids.otherSession] } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("org settings validate and store the cadence", async (t) => {
    if (!server) return t.skip("database unreachable");
    const valid = await authed(tokens.admin, "PATCH", `/organizations/${ids.org}`, {
      reminderCadence: { unansweredHours: [72, 24, 24], confirmedBeforeStartHours: [48, 2], maxUnanswered: 3 },
    });
    assert.equal(valid.status, 200);
    const org = await prisma.organization.findUnique({ where: { id: ids.org } });
    const stored = JSON.parse(org.reminderCadenceJson);
    assert.deepEqual(stored.unansweredHours, [24, 72], "duplicates are collapsed and the order is stable");
    assert.deepEqual(stored.confirmedBeforeStartHours, [2, 48]);
    assert.equal(stored.maxUnanswered, 3);

    for (const bad of [
      { unansweredHours: [0] },
      { unansweredHours: [-1] },
      { unansweredHours: [1.5] },
      { confirmedBeforeStartHours: "24" },
      { maxUnanswered: -1 },
      { unansweredHours: Array.from({ length: 11 }, (_, i) => i + 1) },
    ]) {
      const res = await authed(tokens.admin, "PATCH", `/organizations/${ids.org}`, { reminderCadence: bad });
      assert.equal(res.status, 400, `rejected ${JSON.stringify(bad)}`);
    }

    const outsider = await authed(tokens.outsider, "PATCH", `/organizations/${ids.org}`, { reminderCadence: { unansweredHours: [1] } });
    assert.equal(outsider.status, 403);

    // Restore the cadence these cases rely on.
    await authed(tokens.admin, "PATCH", `/organizations/${ids.org}`, {
      reminderCadence: { unansweredHours: [48], confirmedBeforeStartHours: [24, 1], maxUnanswered: 2 },
    });
  });

  test("a cadence sends each reminder once, to the right people", async (t) => {
    if (!server) return t.skip("database unreachable");
    const first = await runReminders(now, { orgId: ids.org });
    assert.equal(first.reminded, 2, "the confirmed attendee's 24h reminder and the unanswered learner's 48h reminder");

    const logs = await prisma.reminderLog.findMany({ where: { sessionId: ids.session } });
    const kindsFor = (id) => logs.filter((l) => l.learnerId === id).map((l) => l.kind).sort();
    assert.deepEqual(kindsFor(users.confirmed.id), ["session_24"]);
    assert.deepEqual(kindsFor(users.unanswered.id), ["rsvp_48"]);
    assert.deepEqual(kindsFor(users.declined.id), []);
    assert.deepEqual(kindsFor(users.withdrawn.id), [], "a withdrawn learner gets no reminder");
    assert.deepEqual(kindsFor(users.inactive.id), [], "an inactive user gets no reminder");

    // A re-run at the same moment must not duplicate anything.
    const second = await runReminders(now, { orgId: ids.org });
    assert.equal(second.reminded, 0);
    assert.equal((await prisma.reminderLog.count({ where: { sessionId: ids.session } })), logs.length);

    // An hour before the start, only the 1-hour offset is new.
    const nearStart = new Date(startsAt.getTime() - HOUR);
    const third = await runReminders(nearStart, { orgId: ids.org });
    assert.ok(third.reminded >= 1);
    const after = await prisma.reminderLog.findMany({ where: { sessionId: ids.session, learnerId: users.confirmed.id } });
    assert.deepEqual(after.map((l) => l.kind).sort(), ["session_1", "session_24"]);

    const notifications = await prisma.notification.findMany({ where: { userId: { in: [users.confirmed.id, users.unanswered.id] }, type: { in: ["session_reminder", "rsvp_reminder"] } } });
    assert.equal(notifications.filter((n) => n.userId === users.unanswered.id).length, 1);
    assert.equal(notifications.filter((n) => n.userId === users.confirmed.id).length, 2);
  });

  test("each org's own cadence is respected", async (t) => {
    if (!server) return t.skip("database unreachable");
    const result = await runReminders(now, { orgId: ids.otherOrg });
    assert.ok(result.reminded >= 1);
    const logs = await prisma.reminderLog.findMany({ where: { sessionId: ids.otherSession, learnerId: users.otherLearner.id } });
    assert.deepEqual(logs.map((l) => l.kind), ["rsvp_10"]);
    // The other org's 48-hour answer is not applied here.
    assert.ok(!logs.some((l) => l.kind === "rsvp_48"));
  });

  test("the session .ics carries the event, UID and sequence; only the right people may read it", async (t) => {
    if (!server) return t.skip("database unreachable");
    const invited = await authed(tokens.confirmed, "GET", `/sessions/${ids.session}/ics`);
    assert.equal(invited.status, 200);
    assert.match(invited.text, /METHOD:REQUEST/);
    assert.match(invited.text, new RegExp(`UID:${ids.session}@trainhub360`));
    assert.match(invited.text, new RegExp(`DTSTART:${startsAt.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`));
    assert.match(invited.text, new RegExp(`DTEND:${new Date(startsAt.getTime() + 2 * HOUR).toISOString().replace(/[-:]/g, "").split(".")[0]}Z`));
    assert.match(invited.text, /URL:https:\/\/meet\.example\.com\/pd/);
    assert.match(invited.text, /LOCATION:Room 4/);
    assert.match(invited.text, /SEQUENCE:0/);

    const staff = await authed(tokens.admin, "GET", `/sessions/${ids.session}/ics`);
    assert.equal(staff.status, 200);

    const notInvited = await authed(tokens.outsider, "GET", `/sessions/${ids.session}/ics`);
    assert.equal(notInvited.status, 403);

    const otherOrg = await authed(tokens.otherAdmin, "GET", `/sessions/${ids.session}/ics`);
    assert.equal(otherOrg.status, 404, "a session from another org is not found, not forbidden");
  });

  test("editing bumps SEQUENCE and cancelling sends METHOD:CANCEL", async (t) => {
    if (!server) return t.skip("database unreachable");
    const patched = await authed(tokens.admin, "PATCH", `/sessions/${ids.session}`, { title: "PD Session (moved)", startsAt: new Date(startsAt.getTime() + HOUR).toISOString() });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.sequence, 1);
    assert.equal(patched.body.title, "PD Session (moved)");

    const afterEdit = await authed(tokens.confirmed, "GET", `/sessions/${ids.session}/ics`);
    assert.match(afterEdit.text, /SEQUENCE:1/);
    assert.match(afterEdit.text, /SUMMARY:PD Session \(moved\)/);

    const learnerEdit = await authed(tokens.outsider, "PATCH", `/sessions/${ids.session}`, { title: "nope" });
    assert.equal(learnerEdit.status, 403);

    const cancelled = await authed(tokens.admin, "POST", `/sessions/${ids.session}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(cancelled.body.sequence, 2);

    const cancelIcs = await authed(tokens.admin, "GET", `/sessions/${ids.session}/ics`);
    assert.match(cancelIcs.text, /METHOD:CANCEL/);
    assert.match(cancelIcs.text, /STATUS:CANCELLED/);
    assert.match(cancelIcs.text, /SEQUENCE:2/);

    const again = await authed(tokens.admin, "POST", `/sessions/${ids.session}/cancel`);
    assert.equal(again.status, 200, "cancelling twice is not an error");
    assert.equal(again.body.sequence, 2, "and does not bump the sequence again");

    const updatedEmails = await prisma.notification.findMany({ where: { userId: users.confirmed.id, type: { in: ["session_updated", "session_cancelled"] } } });
    assert.deepEqual(updatedEmails.map((n) => n.type).sort(), ["session_cancelled", "session_updated"]);
  });

  test("the feed token is stored hashed and shown once", async (t) => {
    if (!server) return t.skip("database unreachable");
    const before = await authed(tokens.confirmed, "GET", "/me/ical-token");
    assert.equal(before.status, 200);
    assert.equal(before.body.configured, false);
    assert.equal(before.body.token, undefined);

    const created = await authed(tokens.confirmed, "POST", `/users/${users.confirmed.id}/ical-token`);
    assert.equal(created.status, 201);
    const token = created.body.token;
    assert.equal(typeof token, "string");
    assert.ok(created.body.url.includes(token));

    const stored = await prisma.user.findUnique({ where: { id: users.confirmed.id }, select: { icalFeedToken: true } });
    assert.notEqual(stored.icalFeedToken, token, "the plaintext token is never stored");
    assert.equal(stored.icalFeedToken, crypto.createHash("sha256").update(token).digest("hex"));

    const configured = await authed(tokens.confirmed, "GET", "/me/ical-token");
    assert.equal(configured.body.configured, true);
    assert.equal(configured.body.token, undefined);

    const feed = await fetch(`${baseUrl}${created.body.url}`);
    assert.equal(feed.status, 200);
    assert.match(await feed.text(), new RegExp(`UID:${ids.session}@trainhub360`));

    // Rotation replaces the hash: the previous subscription stops working, the new one works.
    const rotated = await authed(tokens.confirmed, "POST", `/users/${users.confirmed.id}/ical-token`);
    assert.equal(rotated.status, 201);
    assert.notEqual(rotated.body.token, token);
    assert.equal((await unauthed(created.body.url)).status, 401);
    assert.equal((await fetch(`${baseUrl}${rotated.body.url}`)).status, 200);

    const stranger = await authed(tokens.outsider, "POST", `/users/${users.confirmed.id}/ical-token`);
    assert.equal(stranger.status, 403);
  });
});
