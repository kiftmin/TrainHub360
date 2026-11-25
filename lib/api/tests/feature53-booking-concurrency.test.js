import "./support/loadEnv.js";
import test, { describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { signToken } from "../dist/middleware/auth.js";
import { weekdayForDateKey, zonedTimeToUtc } from "../dist/services/timeZone.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(here, "support", "concurrencyServer.mjs");
const stamp = Date.now();
const prefix = `f53conc-${stamp}`;
const tz = "UTC";
const date = "2026-12-02";
const dayOfWeek = weekdayForDateKey(date);
const instant = (time) => zonedTimeToUtc(date, time, tz).toISOString();
const ids = {
  org: `${prefix}-org`,
  programmeA: `${prefix}-pa`,
  programmeB: `${prefix}-pb`,
  courseA: `${prefix}-ca`,
  courseB: `${prefix}-cb`,
  trainerA: `${prefix}-trainer-a`,
  trainerB: `${prefix}-trainer-b`,
  learnerA: `${prefix}-learner-a`,
  learnerB: `${prefix}-learner-b`,
  learnerC: `${prefix}-learner-c`,
  learnerD: `${prefix}-learner-d`,
  doomedLearner: `${prefix}-doomed`,
  staff: `${prefix}-staff`,
};
const userIds = Object.values(ids).filter((value) => value.includes("learner") || value.includes("trainer") || value.endsWith("-staff"));
const triggers = ["trg_f53_concurrency_fail"];

describe("Feature 5.3 booking concurrency matrix C01-C12", () => {
  let prisma;
  let children = [];
  const bases = [];
  const tokens = {};
  const availabilityIds = {};

  const api = async (server, token, method, urlPath, body) => {
    const response = await fetch(`${bases[server]}/api${urlPath}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };

  const slot = async (server, token, trainerId, time, endsAt) => {
    const result = await api(server, token, "GET", `/bookings/slots?trainerId=${trainerId}&from=${date}&to=${date}`);
    assert.equal(result.status, 200);
    const row = result.body.slots.find((item) => item.startsAt === instant(time) && (!endsAt || item.endsAt === instant(endsAt)));
    assert.ok(row, `expected slot ${time} for ${trainerId}`);
    return { availabilityId: row.availabilityId, startsAt: row.startsAt, endsAt: row.endsAt };
  };

  const bookSlot = (server, token, trainerId, time, endsAt) =>
    slot(server, token, trainerId, time, endsAt).then((row) => api(server, token, "POST", "/bookings", {
      trainerId,
      courseId: trainerId === ids.trainerB ? ids.courseB : ids.courseA,
      availabilityId: row.availabilityId,
      startsAt: row.startsAt,
    }));

  const bookLegacy = (server, token, trainerId, time, durationMinutes) =>
    api(server, token, "POST", "/bookings", { trainerId, courseId: ids.courseA, date, time, durationMinutes });

  const activeBookings = (where = {}) => prisma.booking.findMany({
    where: { status: "confirmed", OR: [{ trainerId: { in: [ids.trainerA, ids.trainerB] } }, { learnerId: { in: userIds } }], ...where },
  });

  before(async () => {
    if (!requireDatabase("feature53-booking-concurrency.test.js")) return;
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    await seedRoles(prisma, ["learner", "trainer", "admin", "owner"]);
    await prisma.organization.create({ data: { id: ids.org, name: "Concurrency Org" } });
    await prisma.programme.createMany({ data: [
      { id: ids.programmeA, orgId: ids.org, name: "Programme A", type: "Test", owner: "Owner" },
      { id: ids.programmeB, orgId: ids.org, name: "Programme B", type: "Test", owner: "Owner" },
    ] });
    await prisma.course.createMany({ data: [
      { id: ids.courseA, programmeId: ids.programmeA, title: "Course A" },
      { id: ids.courseB, programmeId: ids.programmeB, title: "Course B" },
    ] });
    for (const [key, id, name] of [
      ["trainerA", ids.trainerA, "Trainer A"],
      ["trainerB", ids.trainerB, "Trainer B"],
      ["learnerA", ids.learnerA, "Learner A"],
      ["learnerB", ids.learnerB, "Learner B"],
      ["learnerC", ids.learnerC, "Learner C"],
      ["learnerD", ids.learnerD, "Learner D"],
      ["doomedLearner", ids.doomedLearner, "Doomed Learner"],
      ["staff", ids.staff, "Org Staff"],
    ]) {
      await prisma.user.create({ data: { id, orgId: ids.org, name, email: `${key}-${stamp}@example.com`, passwordHash: "" } });
      tokens[key] = signToken({ id, role: "member", orgId: ids.org, tokenVersion: 0 });
    }
    await prisma.userRole.createMany({ data: [
      { userId: ids.trainerA, roleId: "trainer", programmeId: ids.programmeA },
      { userId: ids.trainerB, roleId: "trainer", programmeId: ids.programmeB },
      { userId: ids.learnerA, roleId: "learner", programmeId: ids.programmeA },
      { userId: ids.learnerB, roleId: "learner", programmeId: ids.programmeA },
      { userId: ids.learnerC, roleId: "learner", programmeId: ids.programmeA },
      { userId: ids.learnerD, roleId: "learner", programmeId: ids.programmeA },
      { userId: ids.doomedLearner, roleId: "learner", programmeId: ids.programmeA },
      { userId: ids.staff, roleId: "owner", programmeId: null },
    ] });
    await prisma.enrolment.createMany({ data: [
      { learnerId: ids.learnerA, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
      { learnerId: ids.learnerA, courseId: ids.courseB, programmeId: ids.programmeB, status: "enrolled" },
      { learnerId: ids.learnerB, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
      { learnerId: ids.learnerC, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
      { learnerId: ids.learnerD, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
      { learnerId: ids.learnerD, courseId: ids.courseB, programmeId: ids.programmeB, status: "enrolled" },
      { learnerId: ids.doomedLearner, courseId: ids.courseA, programmeId: ids.programmeA, status: "enrolled" },
    ] });
    for (const [key, trainerId, programmeId, startTime, endTime, slotMinutes] of [
      ["trainerA", ids.trainerA, ids.programmeA, "09:00", "12:00", 30],
      ["trainerALong", ids.trainerA, ids.programmeA, "09:00", "10:00", 60],
      ["trainerB", ids.trainerB, ids.programmeB, "09:00", "12:00", 30],
      ["trainerBLong", ids.trainerB, ids.programmeB, "09:30", "10:30", 60],
    ]) {
      const row = await prisma.trainerAvailability.create({ data: { trainerId, orgId: ids.org, programmeId, dayOfWeek, startTime, endTime, slotMinutes, timeZone: tz } });
      availabilityIds[key] = row.id;
    }

    children = [4011, 4012].map((port) => spawn(process.execPath, [serverScript], {
      cwd: here,
      env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    }));
    for (const child of children) child.stderr.on("data", () => null);
    for (const port of [4011, 4012]) {
      let ready = false;
      for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
          ready = response.ok;
        } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      }
      assert.ok(ready, `concurrency server on ${port} did not start`);
      bases.push(`http://127.0.0.1:${port}`);
    }
  });

  after(async () => {
    for (const name of triggers) {
      await prisma?.$executeRawUnsafe(`IF OBJECT_ID(N'dbo.${name}', N'TR') IS NOT NULL DROP TRIGGER [dbo].[${name}]`).catch(() => null);
    }
    if (prisma) {
      await prisma.session.deleteMany({ where: { trainerId: { in: [ids.trainerA, ids.trainerB] } } }).catch(() => null);
      await prisma.booking.deleteMany({ where: { OR: [{ trainerId: { in: [ids.trainerA, ids.trainerB] } }, { learnerId: { in: userIds } }] } }).catch(() => null);
      await prisma.trainerAvailability.deleteMany({ where: { trainerId: { in: [ids.trainerA, ids.trainerB] } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { learnerId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.programmeA, ids.programmeB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    for (const child of children) child.kill("SIGTERM");
  });

  afterEach(async () => {
    if (!prisma) return;
    await prisma.session.deleteMany({ where: { trainerId: { in: [ids.trainerA, ids.trainerB] } } }).catch(() => null);
    await prisma.booking.deleteMany({ where: { OR: [{ trainerId: { in: [ids.trainerA, ids.trainerB] } }, { learnerId: { in: userIds } }] } }).catch(() => null);
  });

  test("C01 two learners submit the same trainer slot simultaneously", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const results = await Promise.all([
      bookSlot(0, tokens.learnerA, ids.trainerA, "09:00"),
      bookSlot(1, tokens.learnerB, ids.trainerA, "09:00"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await activeBookings({ startsAt: new Date(instant("09:00")) })).length, 1);
  });

  test("C02 one learner submits two trainers for the same time simultaneously", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const results = await Promise.all([
      bookSlot(0, tokens.learnerA, ids.trainerA, "09:00"),
      bookSlot(1, tokens.learnerA, ids.trainerB, "09:00"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await activeBookings({ startsAt: new Date(instant("09:00")) })).length, 1);
  });

  test("C03 overlapping trainer intervals with different learners are rejected", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const first = await bookLegacy(0, tokens.staff, ids.trainerA, "10:00", 60);
    assert.equal(first.status, 201);
    const second = await bookSlot(1, tokens.learnerA, ids.trainerA, "10:30");
    assert.equal(second.status, 409);
    assert.equal((await activeBookings()).length, 1);
  });

  test("C04 overlapping learner intervals with different trainers are rejected", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const first = await bookSlot(0, tokens.learnerA, ids.trainerA, "09:00", "10:00");
    assert.equal(first.status, 201);
    const second = await bookSlot(1, tokens.learnerA, ids.trainerB, "09:30", "10:30");
    assert.equal(second.status, 409);
    assert.equal((await activeBookings({ learnerId: ids.learnerA })).length, 1);
  });

  test("C05 different trainer start times that overlap are rejected", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    assert.equal((await bookLegacy(0, tokens.staff, ids.trainerA, "10:00", 60)).status, 201);
    assert.equal((await bookLegacy(1, tokens.staff, ids.trainerA, "10:30", 30)).status, 409);
    assert.equal((await activeBookings()).length, 1);
  });

  test("C06 different learner start times that overlap are rejected", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    assert.equal((await bookSlot(0, tokens.learnerA, ids.trainerA, "09:00", "10:00")).status, 201);
    assert.equal((await bookSlot(1, tokens.learnerA, ids.trainerB, "09:30", "10:30")).status, 409);
    assert.equal((await activeBookings({ learnerId: ids.learnerA })).length, 1);
  });

  test("C07 adjacent bookings are both accepted", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const results = await Promise.all([
      bookSlot(0, tokens.learnerB, ids.trainerA, "09:00"),
      bookSlot(1, tokens.learnerC, ids.trainerA, "09:30"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 201]);
    assert.equal((await activeBookings()).length, 2);
  });

  test("C08 an existing trainer session blocks the requested booking", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    await prisma.session.create({ data: {
      id: `${prefix}-session`,
      title: "Trainer session",
      programmeId: ids.programmeA,
      orgId: ids.org,
      trainer: "Trainer A",
      trainerId: ids.trainerA,
      courseId: ids.courseA,
      date,
      time: "11:00",
      startsAt: new Date(instant("11:00")),
      endsAt: new Date(instant("12:00")),
      timezone: tz,
      status: "scheduled",
    } });
    assert.equal((await bookSlot(0, tokens.learnerA, ids.trainerA, "11:30")).status, 409);
    assert.equal((await activeBookings()).length, 0);
  });

  test("C09 cancellation permits a valid replacement booking", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const first = await bookSlot(0, tokens.learnerA, ids.trainerA, "09:00");
    assert.equal(first.status, 201);
    const cancelled = await api(1, tokens.learnerA, "POST", `/bookings/${first.body.id}/cancel`, { reason: "rebook" });
    assert.equal(cancelled.status, 200);
    const stored = await prisma.booking.findUnique({ where: { id: first.body.id } });
    assert.equal(stored.status, "cancelled");
    assert.ok(stored.cancelledAt);
    assert.equal(stored.cancelledBy, ids.learnerA);
    const replacement = await bookSlot(1, tokens.learnerB, ids.trainerA, "09:00");
    assert.equal(replacement.status, 201);
    assert.equal((await activeBookings()).length, 1);
    assert.equal(await prisma.booking.count({ where: { orgId: ids.org } }), 2);
  });

  test("C10 simultaneous adjacent bookings both succeed", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const results = await Promise.all([
      bookSlot(0, tokens.learnerB, ids.trainerA, "09:00"),
      bookSlot(1, tokens.learnerC, ids.trainerA, "09:30"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 201]);
    assert.equal((await activeBookings()).length, 2);
  });

  test("C11 concurrent attempts with different durations detect interval overlap", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const results = await Promise.all([
      bookLegacy(0, tokens.staff, ids.trainerA, "09:00", 60),
      bookLegacy(1, tokens.staff, ids.trainerA, "09:30", 30),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await activeBookings()).length, 1);
  });

  test("C12 a failed transaction leaves no partial booking while the competitor succeeds", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    await prisma.$executeRawUnsafe("IF OBJECT_ID(N'dbo.trg_f53_concurrency_fail', N'TR') IS NOT NULL DROP TRIGGER [dbo].[trg_f53_concurrency_fail]");
    await prisma.$executeRawUnsafe(`EXEC(N'CREATE TRIGGER dbo.trg_f53_concurrency_fail ON dbo.bookings AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted WHERE learner_id = N''${ids.doomedLearner}'') THROW 50001, ''forced booking insert failure'', 1; END')`);
    try {
      const results = await Promise.all([
        bookSlot(0, tokens.doomedLearner, ids.trainerA, "09:00"),
        bookSlot(1, tokens.learnerB, ids.trainerA, "09:00"),
      ]);
      assert.equal(results.filter((r) => r.status === 201).length, 1);
      assert.ok(results.some((r) => r.status >= 400));
      assert.equal((await activeBookings()).length, 1);
      assert.equal(await prisma.booking.count({ where: { learnerId: ids.doomedLearner } }), 0);
    } finally {
      await prisma.$executeRawUnsafe("IF OBJECT_ID(N'dbo.trg_f53_concurrency_fail', N'TR') IS NOT NULL DROP TRIGGER [dbo].[trg_f53_concurrency_fail]");
    }
  });
});
