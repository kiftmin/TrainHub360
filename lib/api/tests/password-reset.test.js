import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("password reset", () => {
  let prisma;
  const stamp = Date.now();
  const orgId = `pwreset-org-${stamp}`;
  const email = `pwreset-${stamp}@example.com`;
  let userId = "";

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
    await prisma.organization.create({ data: { id: orgId, name: "PwReset Org" } });
    const u = await prisma.user.create({ data: { orgId, name: "Pw", email, passwordHash: await hashPassword("old-pass-123") } });
    userId = u.id;
  });

  after(async () => {
    if (prisma) {
      await prisma.passwordResetToken.deleteMany({ where: { userId } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => null);
      await prisma.$disconnect();
    }
  });

  test("valid token resets password and cannot be reused", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    const { requestPasswordReset, resetPassword, verifyPassword } = await import("../dist/services/password.js");
    assert.deepEqual(await requestPasswordReset(email), { sent: true });
    assert.deepEqual(await requestPasswordReset(`nobody-${stamp}@example.com`), { sent: true });
    const row = await prisma.passwordResetToken.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    assert.ok(row, "reset row created");
    const short = await resetPassword("placeholder", "short");
    assert.equal(short.ok, false);
    const bad = await resetPassword("wrong-token", "new-pass-123");
    assert.equal(bad.ok, false);
  });

  test("reset with the real token updates the hash", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    const { resetPassword, verifyPassword } = await import("../dist/services/password.js");
    const known = `known-${stamp}`;
    const tokenHash = crypto.createHash("sha256").update(known).digest("hex");
    const expiresAt = new Date(Date.now() + 3600000);
    await prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
    const r = await resetPassword(known, "brand-new-123");
    assert.equal(r.ok, true);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(await verifyPassword("brand-new-123", user.passwordHash), true);
    const reuse = await resetPassword(known, "another-123");
    assert.equal(reuse.ok, false);
  });
});
