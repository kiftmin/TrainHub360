import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("kpi org scoping", () => {
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgK: `kpi-org-k-${stamp}`,
    orgO: `kpi-org-o-${stamp}`,
    threadK: `kpi-thread-k-${stamp}`,
    threadO: `kpi-thread-o-${stamp}`,
  };

  before(async () => {
    if (!process.env.DATABASE_URL) return;
    process.env.NODE_ENV = "test";
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
    await prisma.organization.createMany({ data: [{ id: ids.orgK, name: "KPI K" }, { id: ids.orgO, name: "KPI O" }] });
    for (const r of ["trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    const t1 = await prisma.user.create({ data: { orgId: ids.orgK, name: "KT1", email: `kpi-t1-${stamp}@example.com`, passwordHash: pw } });
    const t2 = await prisma.user.create({ data: { orgId: ids.orgK, name: "KT2", email: `kpi-t2-${stamp}@example.com`, passwordHash: pw } });
    const t3 = await prisma.user.create({ data: { orgId: ids.orgO, name: "OT3", email: `kpi-t3-${stamp}@example.com`, passwordHash: pw } });
    const trainerRole = await prisma.role.findUniqueOrThrow({ where: { name: "trainer" } });
    for (const u of [t1, t2, t3]) {
      await prisma.userRole.create({ data: { userId: u.id, roleId: trainerRole.id, programmeId: null } });
    }
    await prisma.booking.create({ data: { trainer: "KT1", date: "2026-10-01", time: "10:00", orgId: ids.orgK } });
    for (let i = 0; i < 5; i += 1) {
      await prisma.booking.create({ data: { trainer: "OT3", date: "2026-10-01", time: "10:00", orgId: ids.orgO } });
    }
    await prisma.messageThread.create({ data: { id: ids.threadK, orgId: ids.orgK, subject: "K" } });
    await prisma.messageThread.create({ data: { id: ids.threadO, orgId: ids.orgO, subject: "O" } });
    await prisma.message.createMany({
      data: [
        { threadId: ids.threadK, author: "learner", body: "k1" },
        { threadId: ids.threadK, author: "learner", body: "k2" },
        ...Array.from({ length: 10 }, (_, i) => ({ threadId: ids.threadO, author: "learner", body: `o${i}` })),
      ],
    });
  });

  after(async () => {
    if (prisma) {
      await prisma.message.deleteMany({ where: { threadId: { in: [ids.threadK, ids.threadO] } } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { id: { in: [ids.threadK, ids.threadO] } } }).catch(() => null);
      await prisma.booking.deleteMany({ where: { orgId: { in: [ids.orgK, ids.orgO] } } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: { in: [ids.orgK, ids.orgO] } }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: { in: [ids.orgK, ids.orgO] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgK, ids.orgO] } } }).catch(() => null);
      await prisma.$disconnect();
    }
  });

  test("dashboard summary reflects only the requesting org", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    const { buildDashboardSummary } = await import("../dist/services/kpi.js");
    const summary = await buildDashboardSummary(ids.orgK);
    assert.equal(summary.trainerUtilization, 50);
    const todayActive = summary.weeklyActivity.reduce((a, p) => a + p.active, 0);
    assert.equal(todayActive, 2);
  });
});
