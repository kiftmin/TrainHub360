import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("content lifecycle job", () => {
  let prisma;
  let runContentLifecycleJob;
  const stamp = Date.now();
  const ids = { org: `lc-org-${stamp}`, prog: `lc-prog-${stamp}`, old: `lc-old-${stamp}`, fresh: `lc-fresh-${stamp}` };

  before(async () => {
    if (!process.env.DATABASE_URL) return;
    process.env.NODE_ENV = "test";
    ({ runContentLifecycleJob } = await import("../dist/jobs/contentLifecycleJob.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
    }
  });

  after(async () => {
    if (prisma) {
      await prisma.course.deleteMany({ where: { id: { in: [ids.old, ids.fresh] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.prog } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
  });

  test("stale versioned course is archived with an audit entry", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    await prisma.organization.create({ data: { id: ids.org, name: "LC Org" } });
    await prisma.programme.create({ data: { id: ids.prog, orgId: ids.org, name: "LC Prog", type: "Test", owner: "t" } });
    await prisma.course.createMany({
      data: [
        { id: ids.old, programmeId: ids.prog, title: "Stale Course", version: 1 },
        { id: ids.fresh, programmeId: ids.prog, title: "Stale Course", version: 2 },
      ],
    });
    const result = await runContentLifecycleJob();
    assert.ok(result.ids.includes(ids.old), "stale course should be flagged");
    const archived = await prisma.course.findUnique({ where: { id: ids.old } });
    assert.equal(archived.isArchived, true);
    assert.ok(archived.archivedAt);
    const audit = await prisma.auditLog.findFirst({ where: { action: "CONTENT_LIFECYCLE_ARCHIVE", entityId: ids.old } });
    assert.ok(audit, "audit entry should exist");
    const fresh = await prisma.course.findUnique({ where: { id: ids.fresh } });
    assert.equal(fresh.isArchived, false);
  });
});
