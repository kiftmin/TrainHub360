import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

describe("Feature 5.3 phase 3 — availability-based booking", () => {
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const prefix = `f53book-${stamp}`;
  const ids = {
    org: `${prefix}-org`,
    programme: `${prefix}-programme`,
    otherProgramme: `${prefix}-other`,
    course: `${prefix}-course`,
  };
  const users = {};
  const tokens = {};
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

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
    if (!requireDatabase("feature53-phase3.test.js")) return;
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
    await seedRoles(prisma, ["learner", "trainer"]);
    await prisma.organization.create({ data: { id: ids.org, name: "F53 Booking Org" } });
    await prisma.programme.createMany({ data: [
      { id: ids.programme, orgId: ids.org, name: "F53 Booking Programme", type: "Test", owner: "owner" },
      { id: ids.otherProgramme, orgId: ids.org, name: "F53 Other Programme", type: "Test", owner: "owner" },
    ] });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "F53 Booking Course", appliedThreshold: 70 } });
    for (const [key, name] of [
      ["learner", "F53 Booking Learner"],
      ["learner2", "F53 Booking Learner 2"],
      ["trainer", "F53 Booking Trainer"],
      ["otherTrainer", "F53 Other Trainer"],
    ]) {
      users[key] = await prisma.user.create({ data: { orgId: ids.org, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
    }
    await prisma.userRole.createMany({ data: [
      { userId: users.learner.id, roleId: "learner", programmeId: ids.programme },
      { userId: users.learner2.id, roleId: "learner", programmeId: ids.programme },
      { userId: users.trainer.id, roleId: "trainer", programmeId: ids.programme },
      { userId: users.otherTrainer.id, roleId: "trainer", programmeId: ids.otherProgramme },
    ] });
    await prisma.enrolment.createMany({ data: [
      { learnerId: users.learner.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" },
      { learnerId: users.learner2.id, courseId: ids.course, programmeId: ids.programme, status: "enrolled" },
    ] });
    for (const key of Object.keys(users)) {
      tokens[key] = signToken({ id: users[key].id, role: "member", orgId: ids.org, tokenVersion: 0 });
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const userIds = Object.values(users).map((u) => u.id);
      await prisma.booking.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.trainerAvailability.deleteMany({ where: { trainerId: { in: userIds } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programme, ids.otherProgramme] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const createRule = async (trainerId, dayOfWeek) => authed(tokens.trainer, "POST", "/bookings/availability", {
    trainerId, dayOfWeek, startTime: "09:00", endTime: "11:00", slotMinutes: 30, programmeId: ids.programme, courseId: ids.course,
  });

  test("only eligible trainers expose generated slots", async (t) => {
    if (!server) return t.skip("database unreachable");
    const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const created = await createRule(users.trainer.id, dayOfWeek);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const slots = await authed(tokens.learner, "GET", `/bookings/slots?trainerId=${users.trainer.id}&from=${date}&to=${date}`);
    assert.equal(slots.status, 200);
    assert.equal(slots.body.slots.length, 4);
    assert.ok(slots.body.slots.every((slot) => slot.available));
    const unrelated = await authed(tokens.learner, "GET", `/bookings/slots?trainerId=${users.otherTrainer.id}&from=${date}&to=${date}`);
    assert.equal(unrelated.status, 404);
  });

  test("booking uses a real slot and protects it with conflict detection", async (t) => {
    if (!server) return t.skip("database unreachable");
    const slots = await authed(tokens.learner, "GET", `/bookings/slots?trainerId=${users.trainer.id}&from=${date}&to=${date}`);
    const slot = slots.body.slots.find((item) => item.available);
    assert.ok(slot);
    const booked = await authed(tokens.learner, "POST", "/bookings", {
      trainerId: users.trainer.id, courseId: ids.course, availabilityId: slot.availabilityId, startsAt: slot.startsAt,
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(booked.body.startsAt, slot.startsAt);
    assert.equal(booked.body.learnerId, users.learner.id);

    const duplicate = await authed(tokens.learner2, "POST", "/bookings", {
      trainerId: users.trainer.id, courseId: ids.course, availabilityId: slot.availabilityId, startsAt: slot.startsAt,
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    const afterBooking = await authed(tokens.learner2, "GET", `/bookings/slots?trainerId=${users.trainer.id}&from=${date}&to=${date}`);
    const bookedSlot = afterBooking.body.slots.find((item) => item.startsAt === slot.startsAt);
    assert.equal(bookedSlot.available, false);

    const cancelled = await authed(tokens.learner, "POST", `/bookings/${booked.body.id}/cancel`, { reason: "No longer needed" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(cancelled.body.cancellationReason, "No longer needed");
  });

  test("scheduled trainer sessions remove overlapping slots", async (t) => {
    if (!server) return t.skip("database unreachable");
    const slots = await authed(tokens.learner, "GET", `/bookings/slots?trainerId=${users.trainer.id}&from=${date}&to=${date}`);
    const slot = slots.body.slots.find((item) => item.available);
    assert.ok(slot);
    await prisma.session.create({ data: {
      id: `${prefix}-session`,
      title: "F53 Busy Session",
      programme: "F53 Booking Programme",
      programmeId: ids.programme,
      orgId: ids.org,
      trainer: users.trainer.name,
      trainerId: users.trainer.id,
      courseId: ids.course,
      date,
      time: slot.startsAt.slice(11, 16),
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
      timezone: "UTC",
      status: "scheduled",
    } });
    try {
      const refreshed = await authed(tokens.learner, "GET", `/bookings/slots?trainerId=${users.trainer.id}&from=${date}&to=${date}`);
      assert.equal(refreshed.body.slots.find((item) => item.startsAt === slot.startsAt).available, false);
      const attempted = await authed(tokens.learner, "POST", "/bookings", {
        trainerId: users.trainer.id, courseId: ids.course, availabilityId: slot.availabilityId, startsAt: slot.startsAt,
      });
      assert.equal(attempted.status, 409);
    } finally {
      await prisma.session.deleteMany({ where: { id: `${prefix}-session` } });
    }
  });
});
