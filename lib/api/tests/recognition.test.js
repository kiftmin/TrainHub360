import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { consecutiveWeeks } from "../dist/services/recognition.js";
import { buildExternalEvent } from "../dist/services/calendarSync.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("recognition", () => {
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `rec-org-${stamp}`,
    prog: `rec-prog-${stamp}`,
    course: `rec-course-${stamp}`,
    learnerHi: `rec-hi-${stamp}@example.com`,
    learnerLo: `rec-lo-${stamp}@example.com`,
  };

  before(async () => {
    if (!process.env.DATABASE_URL) return;
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    const pw = await hashPassword("pw");
    await prisma.organization.create({ data: { id: ids.org, name: "Rec Org" } });
    await prisma.programme.create({ data: { id: ids.prog, orgId: ids.org, name: "R Prog", type: "Test", owner: "t" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.prog, title: "R Course" } });
    const hi = await prisma.user.create({ data: { orgId: ids.org, name: "Hi", email: ids.learnerHi, passwordHash: pw } });
    const lo = await prisma.user.create({ data: { orgId: ids.org, name: "Lo", email: ids.learnerLo, passwordHash: pw } });
    await prisma.enrolment.create({ data: { learnerId: hi.id, courseId: ids.course, programmeId: ids.prog, status: "completed", appliedAssessmentScore: 95 } });
    await prisma.enrolment.create({ data: { learnerId: lo.id, courseId: ids.course, programmeId: ids.prog, status: "completed", appliedAssessmentScore: 40 } });
  });

  after(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.recognition.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programmeId: ids.prog } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.prog } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
  });

  test("95% applied score triggers recognition, 40% does not", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    const { checkAppliedScoreRecognition } = await import("../dist/services/recognition.js");
    const hiEnr = await prisma.enrolment.findFirst({ where: { programmeId: ids.prog, appliedAssessmentScore: 95 } });
    const loEnr = await prisma.enrolment.findFirst({ where: { programmeId: ids.prog, appliedAssessmentScore: 40 } });
    assert.equal((await checkAppliedScoreRecognition(hiEnr.id)).awarded, true);
    assert.equal((await checkAppliedScoreRecognition(loEnr.id)).awarded, false);
    const count = await prisma.recognition.count({ where: { type: "high_applied_score" } });
    assert.equal(count, 1);
  });

  test("consecutiveWeeks detects 3-week streaks", () => {
    assert.equal(consecutiveWeeks(["2026-08-03", "2026-08-10", "2026-08-17"], 3), true);
    assert.equal(consecutiveWeeks(["2026-08-03", "2026-08-17", "2026-08-31"], 3), false);
  });

  test("calendar event builder prefixes titles", () => {
    assert.deepEqual(buildExternalEvent({ title: "Lab", date: "2026-10-01", time: "10:00" }), { title: "[TrainHub360] Lab", date: "2026-10-01", time: "10:00" });
  });
});
