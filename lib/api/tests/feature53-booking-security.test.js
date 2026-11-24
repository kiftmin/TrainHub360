import "./support/loadEnv.js";
import test, { describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Feature 5.3 security — booking reservations", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `f53book-${stamp}`;
  const ids = {
    org: `${prefix}-org`,
    progA: `${prefix}-prog-a`,
    progB: `${prefix}-prog-b`,
    courseA: `${prefix}-course-a`,
    courseB: `${prefix}-course-b`,
  };
  const users = {};
  const tokens = {};
  const future = new Date(Date.now() + 3 * 86_400_000);
  const slotStart = new Date(`${future.toISOString().slice(0, 10)}T09:00:00.000Z`);
  const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
  const pastStart = new Date(Date.now() - 86_400_000);
  const post = (token, path, body) => fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const bodyOf = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  before(async () => {
    if (!requireDatabase("feature53-booking-security.test.js")) return;
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
    await prisma.organization.create({ data: { id: ids.org, name: "Booking Security Org" } });
    await prisma.programme.createMany({ data: [
      { id: ids.progA, orgId: ids.org, name: "Booking Programme A", type: "Test", owner: "Owner" },
      { id: ids.progB, orgId: ids.org, name: "Booking Programme B", type: "Test", owner: "Owner" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.progA, title: "Course A" },
      { id: ids.courseB, programmeId: ids.progB, title: "Course B" },
    ] });
    for (const [key, name] of [
      ["trainerA", "Trainer A"],
      ["trainerB", "Trainer B"],
      ["learnerA", "Learner A"],
      ["outsider", "Outsider Learner"],
      ["programmeStaffB", "Programme Staff B"],
      ["orgStaff", "Org Staff"],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId: ids.org, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.trainerA.id, roleId: "trainer", programmeId: ids.progA },
      { userId: users.trainerB.id, roleId: "trainer", programmeId: ids.progB },
      { userId: users.learnerA.id, roleId: "learner", programmeId: ids.progA },
      { userId: users.outsider.id, roleId: "learner", programmeId: ids.progB },
      { userId: users.programmeStaffB.id, roleId: "admin", programmeId: ids.progB },
      { userId: users.orgStaff.id, roleId: "owner", programmeId: null },
    ] });
    await prisma.enrolment.createMany({ data: [
      { learnerId: users.learnerA.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" },
      { learnerId: users.outsider.id, courseId: ids.courseB, programmeId: ids.progB, status: "enrolled" },
    ] });
    await prisma.trainerAvailability.createMany({ data: [
      {
        trainerId: users.trainerA.id,
        orgId: ids.org,
        programmeId: ids.progA,
        dayOfWeek: future.getUTCDay(),
        startTime: "09:00",
        endTime: "10:00",
        slotMinutes: 30,
        timeZone: "UTC",
        isActive: true,
      },
      {
        trainerId: users.trainerB.id,
        orgId: ids.org,
        programmeId: ids.progB,
        dayOfWeek: future.getUTCDay(),
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
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.booking.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.trainerAvailability.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  afterEach(async () => {
    if (!prisma) return;
    await prisma.booking.deleteMany({ where: { learnerId: { in: Object.values(users).map((u) => u.id) } } }).catch(() => null);
  });

  test("learner cannot create a legacy booking outside published availability", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await post(tokens.learnerA, "/bookings", {
      trainerId: users.trainerA.id,
      courseId: ids.courseA,
      date: slotStart.toISOString().slice(0, 10),
      time: "15:00",
    });
    assert.ok([400, 403].includes(res.status), await res.text());
  });

  test("learner cannot reserve a past slot", async (t) => {
    if (!server) return t.skip("database unreachable");
    const availability = await prisma.trainerAvailability.findFirst({ where: { trainerId: users.trainerA.id } });
    const res = await post(tokens.learnerA, "/bookings", {
      trainerId: users.trainerA.id,
      courseId: ids.courseA,
      startsAt: pastStart.toISOString(),
      availabilityId: availability.id,
    });
    assert.equal(res.status, 400);
    assert.match((await bodyOf(res)).error, /future/i);
  });

  test("learner cannot reserve a slot using another trainer's availability", async (t) => {
    if (!server) return t.skip("database unreachable");
    const availability = await prisma.trainerAvailability.findFirst({ where: { trainerId: users.trainerB.id } });
    const res = await post(tokens.learnerA, "/bookings", {
      trainerId: users.trainerA.id,
      startsAt: slotStart.toISOString(),
      availabilityId: availability.id,
    });
    assert.equal(res.status, 409);
  });

  test("learner cannot book a course from another programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const availability = await prisma.trainerAvailability.findFirst({ where: { trainerId: users.trainerA.id } });
    const res = await post(tokens.learnerA, "/bookings", {
      trainerId: users.trainerA.id,
      courseId: ids.courseB,
      startsAt: slotStart.toISOString(),
      availabilityId: availability.id,
    });
    assert.equal(res.status, 403);
  });

  test("learner not enrolled with the trainer cannot book", async (t) => {
    if (!server) return t.skip("database unreachable");
    const availability = await prisma.trainerAvailability.findFirst({ where: { trainerId: users.trainerB.id } });
    const res = await post(tokens.learnerA, "/bookings", {
      trainerId: users.trainerB.id,
      startsAt: slotStart.toISOString(),
      availabilityId: availability.id,
    });
    assert.equal(res.status, 403);
  });

  test("concurrent reservations cannot double-book one slot", async (t) => {
    if (!server) return t.skip("database unreachable");
    const availability = await prisma.trainerAvailability.findFirst({ where: { trainerId: users.trainerA.id } });
    const requests = Array.from({ length: 2 }, () => post(tokens.learnerA, "/bookings", {
      trainerId: users.trainerA.id,
      startsAt: slotStart.toISOString(),
      availabilityId: availability.id,
    }));
    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status).sort();
    for (const res of responses) await res.arrayBuffer();
    assert.deepEqual(statuses, [201, 409]);
  });

  test("programme staff cannot book a trainer outside their programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const availability = await prisma.trainerAvailability.findFirst({ where: { trainerId: users.trainerA.id } });
    const res = await post(tokens.programmeStaffB, "/bookings", {
      trainerId: users.trainerA.id,
      startsAt: slotStart.toISOString(),
      availabilityId: availability.id,
    });
    assert.equal(res.status, 403);
  });

  test("org staff can still create a legacy booking", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await post(tokens.orgStaff, "/bookings", {
      trainerId: users.trainerA.id,
      date: slotStart.toISOString().slice(0, 10),
      time: "15:00",
    });
    assert.equal(res.status, 201);
    const booking = await bodyOf(res);
    assert.equal(booking.trainerId, users.trainerA.id);
    await prisma.booking.delete({ where: { id: booking.id } });
  });
});
