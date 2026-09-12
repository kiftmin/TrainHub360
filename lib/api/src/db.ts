import { db } from "@workspace/db";
import type { AuthedRequest } from "./middleware/auth.js";

export { db };

export function orgIdOf(req: AuthedRequest): string {
  const orgId = req.user?.orgId;
  if (!orgId) {
    const err = new Error("organization scope missing") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return orgId;
}

export function orgScope(req: AuthedRequest): { orgId: string } {
  return { orgId: orgIdOf(req) };
}

export async function checkDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1 AS ok`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

