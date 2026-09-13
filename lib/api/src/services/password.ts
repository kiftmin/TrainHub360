import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "../db.js";

const ROUNDS = 10;

let dummyHash: string | null = null;

async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await bcrypt.hash(`dummy:${Math.random().toString(36)}`, ROUNDS);
  return dummyHash;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export async function verifyLoginPassword(plain: string, storedHash: string | null): Promise<boolean> {
  if (storedHash) return verifyPassword(plain, storedHash);
  await bcrypt.compare(plain, await getDummyHash());
  return false;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(email: string): Promise<{ sent: boolean }> {
  const user = await db.user.findUnique({ where: { email } }).catch(() => null);
  if (!user) return { sent: true };
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
  console.log(`[auth] password reset for ${email}: token=${token} (email send stubbed — no provider configured)`);
  return { sent: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "password must be at least 8 characters" };
  const row = await db.passwordResetToken.findFirst({ where: { tokenHash: hashToken(token), usedAt: null } }).catch(() => null);
  if (!row || row.expiresAt < new Date()) return { ok: false, error: "invalid or expired token" };
  await db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }).catch(() => null);
  return { ok: true };
}
