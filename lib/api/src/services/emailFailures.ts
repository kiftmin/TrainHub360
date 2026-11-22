// Round 7 gap 3: a send that fails must leave a trace.
//
// Before this, activation, reset and notification mail all ended in `.catch(() => false)`
// and notify()'s catch was empty, so a broken SMTP server looked exactly like a quiet one.
// Every failure is now logged and written to `email_failures`, which an operator can read
// without turning on debug logging. Recording never throws: a failure to record a failure
// must not break the caller's request.
import { db } from "../db.js";

export interface EmailFailureInput {
  to: string;
  subject: string;
  kind?: string;
  error: unknown;
  context?: Record<string, unknown>;
}

/** How long a failure row is kept. Anything older is pruned opportunistically. */
export const EMAIL_FAILURE_RETENTION_DAYS = 30;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "unknown error");
}

export async function recordEmailFailure(input: EmailFailureInput): Promise<void> {
  const message = describe(input.error);
  console.error(`[email] send failed to=${input.to} subject="${input.subject}" kind=${input.kind ?? "unknown"}: ${message}`);
  try {
    const user = await db.user.findUnique({ where: { email: input.to }, select: { id: true, orgId: true } }).catch(() => null);
    await db.emailFailure.create({
      data: {
        to: input.to,
        subject: input.subject,
        kind: input.kind ?? "unknown",
        error: message.slice(0, 1000),
        userId: user?.id ?? null,
        orgId: user?.orgId ?? null,
        contextJson: input.context ? JSON.stringify(input.context).slice(0, 2000) : null,
      },
    });
    // Opportunistic prune; cheap, indexed on createdAt.
    const cutoff = new Date(Date.now() - EMAIL_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.emailFailure.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => null);
  } catch (e) {
    console.error("[email] could not record the failure:", describe(e));
  }
}

/** The most recent failures, newest first — what an operator looks at when mail is "quiet". */
export async function listEmailFailures(orgId: string | null, take = 50, skip = 0): Promise<Array<{
  id: string; to: string; subject: string; kind: string; error: string; createdAt: Date; userId: string | null;
}>> {
  return db.emailFailure.findMany({
    where: orgId ? { orgId } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 200),
    skip: Math.max(skip, 0),
    select: { id: true, to: true, subject: true, kind: true, error: true, createdAt: true, userId: true },
  }).catch(() => []);
}
