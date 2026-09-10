import { db } from "@workspace/db";

export { db };

export async function checkDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1 AS ok`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

