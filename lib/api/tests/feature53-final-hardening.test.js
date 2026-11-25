import "./support/loadEnv.js";
import test, { describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { competenceFromEvidence } from "../dist/services/enrolmentOutcome.js";
import { localDateKey, weekdayForDateKey, zonedTimeToUtc } from "../dist/services/timeZone.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Feature 5.3 final hardening", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `f53final-${stamp}`;
  const ids = {
    org: `${prefix}-org`,
    programmeA: `${prefix}-prog-a`,
    programmeB: `${prefix}-prog-b`,
    courseA: `${prefix}-course-a`,
    courseB: `${prefix}-course-b`,
  };
  const tz = "Africa/Johannesburg";
  const date = localDateKey(new Date(Date.now() + 3 * 86_400_000), tz);
  const startsAt = zonedTimeToUtc(date, "09:00", tz);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const users = {};
  const tokens = {};
  const threadIds = [];
  const exceptionIds = [];

  const api = async (token, method, path, body) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };

  before(async () => {
    if (!requireDatabase("feature53-final-hardening.test.js")) return;
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
    await seedRoles(prisma, ["learner", "trainer", "admin", "owner"]);
    await prisma.organization.create({ data: { id: ids.org, name: "Final Hardening Org" } });
    await prisma.programme.createMany({ data: [
      { id: ids.programmeA, orgId: ids.org, name: "Programme A", type: "Test", owner: "Owner" },
      { id: ids.programmeB, orgId: ids.org, name: "Programme B", type: "Test", owner: "Owner" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.programmeA, title: "Course A" },
      { id: ids.courseB, programmeId: ids.programmeB, title: "Course B" },
    ] });
    for (const [key, name] of [
      ["trainerA", "Trainer A"],
      ["trainerB", "Trainer B"],
      ["learnerA", "Learner A"],
      ["learnerB", "Learner B"],
      ["staffB", "Programme Staff B"],
      ["orgStaff", "Org Staff"],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId: ids.org, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.trainerA.id, roleId: "trainer", programmeId: ids.programmeA },
      { userId: users.trainerB.id, roleId: "trainer", programmeId: ids.programmeB },
      { userId: users.learnerA.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: users.learnerB.id, roleId: "learner", programmeId: ids.programmeA },
      { userId: users.staffB.id, roleId: "admin", programmeId: ids.programmeB },
      { userId: users.orgStaff.id, roleId: "owner", programmeId: null },
    ] });
    await prisma.enrolment.createMany({ data: [
      { learnerId: users.learnerA.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
      { learnerId: users.learnerB.id, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
    ] });
    await prisma.trainerAvailability.createMany({ data: [
      {
        trainerId: users.trainerA.id,
        orgId: ids.org,
        programmeId: ids.programmeA,
        dayOfWeek: weekdayForDateKey(date),
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 30,
        timeZone: tz,
        isActive: true,
      },
      {
        trainerId: users.trainerB.id,
        orgId: ids.org,
        programmeId: ids.programmeB,
        dayOfWeek: weekdayForDateKey(date),
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 30,
        timeZone: "UTC",
        isActive: true,
      },
    ] });
    for (const [key, user] of Object.entries(users)) {
      tokens[key] = signToken({ id: user.id, role: "member", orgId: ids.org, tokenVersion: 0 });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((user) => user.id);
      await prisma.message.deleteMany({ where: { thread: { orgId: ids.org } } }).catch(() => null);
      await prisma.threadParticipant.deleteMany({ where: { thread: { orgId: ids.org } } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.booking.deleteMany({ where: { OR: [{ learnerId: { in: userIds } }, { trainerId: { in: userIds } }] } }).catch(() => null);
      await prisma.trainerAvailabilityException.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.trainerAvailability.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programmeA, ids.programmeB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  afterEach(async () => {
    if (!prisma) return;
    const userIds = Object.values(users).map((user) => user.id);
    await prisma.booking.deleteMany({ where: { OR: [{ learnerId: { in: userIds } }, { trainerId: { in: userIds } }] } }).catch(() => null);
    await prisma.trainerAvailabilityException.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
    await prisma.message.deleteMany({ where: { thread: { orgId: ids.org } } }).catch(() => null);
    await prisma.threadParticipant.deleteMany({ where: { thread: { orgId: ids.org } } }).catch(() => null);
    await prisma.messageThread.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
    threadIds.length = 0;
    exceptionIds.length = 0;
  });

  test("IANA timezone helpers use a deterministic DST matrix", () => {
    const ny = "America/New_York";
    assert.equal(zonedTimeToUtc("2026-11-01", "12:00", ny).toISOString(), "2026-11-01T17:00:00.000Z");
    assert.equal(zonedTimeToUtc("2026-03-08", "02:30", ny), null);
    assert.equal(zonedTimeToUtc("2026-11-01", "01:30", ny).toISOString(), "2026-11-01T05:30:00.000Z");
    const autumn = zonedTimeToUtc("2026-11-01", "01:30", ny);
    assert.equal(localDateKey(autumn, ny), "2026-11-01");
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: ny, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(autumn);
    assert.equal(`${parts.find((p) => p.type === "hour").value}:${parts.find((p) => p.type === "minute").value}`, "01:30");
    assert.equal(zonedTimeToUtc("2026-11-01", "09:00", tz).toISOString(), "2026-11-01T07:00:00.000Z");
    assert.equal(zonedTimeToUtc("2026-03-08", "09:00", tz).toISOString(), "2026-03-08T07:00:00.000Z");
    assert.equal(zonedTimeToUtc("2026-11-01", "00:00", ny).toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(localDateKey(new Date("2026-11-01T04:00:00.000Z"), ny), "2026-11-01");
    assert.equal(zonedTimeToUtc("2026-11-01", "00:00", tz).toISOString(), "2026-10-31T22:00:00.000Z");
    assert.equal(localDateKey(new Date("2026-10-31T22:00:00.000Z"), tz), "2026-11-01");
    assert.equal(zonedTimeToUtc("2026-03-08", "01:30", ny).toISOString(), "2026-03-08T06:30:00.000Z");
    assert.equal(localDateKey(new Date("2026-03-08T06:30:00.000Z"), ny), "2026-03-08");
  });

  test("competence requires complete required content and at least one live applied pass", () => {
    assert.equal(competenceFromEvidence({ requiredContentIds: ["c1"], completedContentIds: ["c1"], liveAppliedPassed: [true] }), true);
    assert.equal(competenceFromEvidence({ requiredContentIds: ["c1"], completedContentIds: [], liveAppliedPassed: [true] }), false);
    assert.equal(competenceFromEvidence({ requiredContentIds: [], completedContentIds: [], liveAppliedPassed: [] }), false);
    assert.equal(competenceFromEvidence({ requiredContentIds: ["c1"], completedContentIds: ["c1"], liveAppliedPassed: [true, false] }), false);
  });

  test("slots use the trainer's IANA timezone and reflect exception CRUD", async (t) => {
    if (!server) return t.skip("database unavailable");
    const first = await api(tokens.learnerA, "GET", `/bookings/slots?trainerId=${users.trainerA.id}&from=${date}&to=${date}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.timeZone, tz);
    const slot = first.body.slots.find((row) => row.startsAt === startsAt.toISOString() && row.available);
    assert.ok(slot);
    assert.equal(slot.timeZone, tz);

    const denied = await api(tokens.learnerA, "POST", "/trainer-availability-exceptions", {
      trainerId: users.trainerA.id,
      date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isAvailable: false,
    });
    assert.equal(denied.status, 403);

    const created = await api(tokens.trainerA, "POST", "/trainer-availability-exceptions", {
      trainerId: users.trainerA.id,
      programmeId: ids.programmeA,
      date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isAvailable: false,
      reason: "Trainer leave",
    });
    assert.equal(created.status, 201);
    exceptionIds.push(created.body.id);
    const afterCreate = await api(tokens.learnerA, "GET", `/bookings/slots?trainerId=${users.trainerA.id}&from=${date}&to=${date}`);
    assert.equal(afterCreate.body.slots.find((row) => row.startsAt === startsAt.toISOString()).available, false);

    const patched = await api(tokens.trainerA, "PATCH", `/trainer-availability-exceptions/${created.body.id}`, { reason: "Updated leave" });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.reason, "Updated leave");
    const listed = await api(tokens.trainerA, "GET", `/trainer-availability-exceptions?trainerId=${users.trainerA.id}&date=${date}`);
    assert.ok(listed.body.some((row) => row.id === created.body.id));

    const removed = await api(tokens.trainerA, "DELETE", `/trainer-availability-exceptions/${created.body.id}`);
    assert.equal(removed.status, 204);
    const afterDelete = await api(tokens.learnerA, "GET", `/bookings/slots?trainerId=${users.trainerA.id}&from=${date}&to=${date}`);
    assert.equal(afterDelete.body.slots.find((row) => row.startsAt === startsAt.toISOString()).available, true);
  });

  test("two learners racing for one slot produce one booking and one conflict", async (t) => {
    if (!server) return t.skip("database unavailable");
    const slots = await api(tokens.learnerA, "GET", `/bookings/slots?trainerId=${users.trainerA.id}&from=${date}&to=${date}`);
    const slot = slots.body.slots.find((row) => row.startsAt === startsAt.toISOString() && row.available);
    assert.ok(slot);
    const payload = { trainerId: users.trainerA.id, courseId: ids.courseA, availabilityId: slot.availabilityId, startsAt: slot.startsAt };
    const [a, b] = await Promise.all([
      api(tokens.learnerA, "POST", "/bookings", payload),
      api(tokens.learnerB, "POST", "/bookings", payload),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const count = await prisma.booking.count({ where: { trainerId: users.trainerA.id, startsAt } });
    assert.equal(count, 1);
  });

  test("bookings normalize client timezone to the trainer timezone", async (t) => {
    if (!server) return t.skip("database unavailable");
    const invalid = await api(tokens.orgStaff, "POST", "/bookings", {
      trainerId: users.trainerA.id,
      courseId: ids.courseA,
      date,
      time: "09:00",
      timeZone: "Not/AZone",
    });
    assert.equal(invalid.status, 201);
    assert.equal(invalid.body.timeZone, tz);
    assert.equal(invalid.body.date, date);
    assert.equal(invalid.body.time, "09:00");

    const mismatched = await api(tokens.orgStaff, "POST", "/bookings", {
      trainerId: users.trainerA.id,
      courseId: ids.courseA,
      date,
      time: "09:30",
      timeZone: "UTC",
    });
    assert.equal(mismatched.status, 201);
    assert.equal(mismatched.body.timeZone, tz);
    assert.equal(mismatched.body.date, date);
    assert.equal(mismatched.body.time, "09:30");
  });

  test("cancellation authorization is scoped to the booking's programme", async (t) => {
    if (!server) return t.skip("database unavailable");
    const slots = await api(tokens.learnerA, "GET", `/bookings/slots?trainerId=${users.trainerA.id}&from=${date}&to=${date}`);
    const slot = slots.body.slots.find((row) => row.startsAt === startsAt.toISOString() && row.available);
    const payload = { trainerId: users.trainerA.id, courseId: ids.courseA, availabilityId: slot.availabilityId, startsAt: slot.startsAt };

    const learnerBooking = await api(tokens.learnerA, "POST", "/bookings", payload);
    assert.equal(learnerBooking.status, 201);
    const crossProgramme = await api(tokens.staffB, "POST", `/bookings/${learnerBooking.body.id}/cancel`, { reason: "cross-programme" });
    assert.equal(crossProgramme.status, 403);
    const ownerCancel = await api(tokens.learnerA, "POST", `/bookings/${learnerBooking.body.id}/cancel`, { reason: "learner" });
    assert.equal(ownerCancel.status, 200);

    const staffBooking = await api(tokens.orgStaff, "POST", "/bookings", payload);
    assert.equal(staffBooking.status, 201);
    const orgCancel = await api(tokens.orgStaff, "POST", `/bookings/${staffBooking.body.id}/cancel`, { reason: "org staff" });
    assert.equal(orgCancel.status, 200);
  });

  test("learner dashboard reports honest message and notification metrics", async (t) => {
    if (!server) return t.skip("database unavailable");
    const thread = await api(tokens.trainerA, "POST", "/threads", {
      subject: "Learner dashboard thread",
      programmeId: ids.programmeA,
      courseId: ids.courseA,
      participantIds: [users.learnerA.id],
      body: "Opening message",
      slaHours: 24,
    });
    assert.equal(thread.status, 201);
    threadIds.push(thread.body.id);
    assert.equal((await api(tokens.learnerA, "POST", `/threads/${thread.body.id}/messages`, { body: "Question" })).status, 201);
    assert.equal((await api(tokens.trainerA, "POST", `/threads/${thread.body.id}/messages`, { body: "Answer" })).status, 201);
    assert.equal((await api(tokens.learnerA, "POST", `/threads/${thread.body.id}/messages`, { body: "Follow-up" })).status, 201);

    const trainerThread = await api(tokens.trainerA, "POST", "/threads", {
      subject: "Trainer waiting thread",
      programmeId: ids.programmeA,
      participantIds: [users.learnerA.id],
      body: "Any update?",
      slaHours: 24,
    });
    assert.equal(trainerThread.status, 201);
    threadIds.push(trainerThread.body.id);
    assert.equal((await api(tokens.trainerA, "POST", `/threads/${trainerThread.body.id}/messages`, { body: "Please confirm" })).status, 201);

    await prisma.notification.createMany({ data: [
      { userId: users.learnerA.id, orgId: ids.org, type: "test", title: "Unread one", body: "One" },
      { userId: users.learnerA.id, orgId: ids.org, type: "test", title: "Unread two", body: "Two" },
      { userId: users.learnerA.id, orgId: ids.org, type: "test", title: "Read one", body: "Three", readAt: new Date() },
    ] });

    const unreadCount = await prisma.notification.count({ where: { userId: users.learnerA.id, orgId: ids.org, readAt: null } });
    const dashboard = await api(tokens.learnerA, "GET", "/me/learner-dashboard");
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.summary.unreadNotifications, unreadCount);
    assert.ok(unreadCount >= 2);
    assert.equal(dashboard.body.summary.unreadMessages, 0);
    assert.equal(dashboard.body.summary.unreadMessageTracking, false);
    assert.ok(dashboard.body.summary.awaitingTrainerReplies >= 1);
    assert.ok(dashboard.body.summary.awaitingLearnerReplies >= 1);
    const row = dashboard.body.messages.find((message) => message.id === thread.body.id);
    assert.ok(row);
    assert.equal(row.lastMessagePreview, "Follow-up");
    assert.ok(row.averageResponseTimeHours !== null);
    assert.equal(row.slaState === "escalated", false);
    assert.equal(Object.hasOwn(row, "isEscalated"), false);
    assert.equal(Object.hasOwn(row, "slaHours"), false);
  });

  test("learner can list only programme trainers for a new message", async (t) => {
    if (!server) return t.skip("database unavailable");
    const members = await api(tokens.learnerA, "GET", `/programmes/${ids.programmeA}/members`);
    assert.equal(members.status, 200);
    assert.ok(members.body.some((member) => member.userId === users.trainerA.id), "eligible trainer is listed");
    assert.ok(!members.body.some((member) => member.userId === users.learnerA.id), "learner is not offered as a participant");
    assert.ok(!members.body.some((member) => member.userId === users.learnerB.id), "other learners are not disclosed");
    assert.ok(!members.body.some((member) => member.userId === users.trainerB.id), "trainers from other programmes are not listed");
  });
});
