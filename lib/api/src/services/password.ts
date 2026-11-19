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

export function assertPasswordPolicy(newPassword: string): string | null {
  if (!newPassword || newPassword.length < 8) return "password must be at least 8 characters";
  return null;
}

// Increments the user's token version so every already-issued JWT is rejected.
// Called on role change, deactivation, password change/reset and activation.
export async function bumpTokenVersion(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }).catch(() => null);
}

// A placeholder hash nobody can guess. Account creation never uses a
// human-guessable password; access is granted only through an activation token.
export async function unguessablePasswordHash(): Promise<string> {
  return hashPassword(crypto.randomBytes(32).toString("hex"));
}

export async function issueActivationToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(token), purpose: "activation", expiresAt },
  });
  return { token, expiresAt };
}

export async function sendActivationEmail(email: string, name: string, token: string): Promise<void> {
  const { getEmailSender } = await import("./email.js");
  await getEmailSender().send({
    to: email,
    subject: "Activate your TrainHub360 account",
    text: `Hello ${name}, activate your TrainHub360 account (valid 7 days): /activate?token=${token}`,
  }).catch(() => false);
}

export async function requestPasswordReset(email: string): Promise<{ sent: boolean }> {
  const user = await db.user.findUnique({ where: { email } }).catch(() => null);
  if (!user) return { sent: true };
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), purpose: "password_reset", expiresAt } });
  const { getEmailSender } = await import("./email.js");
  await getEmailSender().send({ to: email, subject: "Reset your TrainHub360 password", text: `Reset link: /reset-password?token=${token}` }).catch(() => false);
  return { sent: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const policy = assertPasswordPolicy(newPassword);
  if (policy) return { ok: false, error: policy };
  const row = await db.passwordResetToken.findFirst({ where: { tokenHash: hashToken(token), usedAt: null, purpose: "password_reset" } }).catch(() => null);
  if (!row || row.expiresAt < new Date()) return { ok: false, error: "invalid or expired token" };
  await db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } } });
  await db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }).catch(() => null);
  return { ok: true };
}

export async function activateAccount(token: string, newPassword: string): Promise<{ ok: boolean; error?: string; userId?: string }> {
  const policy = assertPasswordPolicy(newPassword);
  if (policy) return { ok: false, error: policy };
  const row = await db.passwordResetToken.findFirst({ where: { tokenHash: hashToken(token), usedAt: null, purpose: "activation" } }).catch(() => null);
  if (!row || row.expiresAt < new Date()) return { ok: false, error: "invalid or expired activation token" };
  const now = new Date();
  await db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword), activatedAt: now, tokenVersion: { increment: 1 } } });
  await db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: now } }).catch(() => null);
  return { ok: true, userId: row.userId };
}
