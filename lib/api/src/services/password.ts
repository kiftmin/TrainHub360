import bcrypt from "bcryptjs";

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
