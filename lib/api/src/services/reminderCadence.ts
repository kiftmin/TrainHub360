// Round 8 / D.1: session reminders follow each organization's cadence.
//
// The old job sent one reminder 24 hours before a session (and was off unless an interval env
// var was set), while invitations were only nudged by a separate 48-hour job that nothing
// scheduled. Both are folded in here:
//
//   - an unanswered invitation gets a reminder at each `unansweredHours` offset after the
//     invite, up to `maxUnanswered`;
//   - a confirmed attendee gets one at each `confirmedBeforeStartHours` offset before the start.
//
// `ReminderLog.kind` carries the offset (`rsvp_48`, `session_24`), and the existing unique
// (sessionId, learnerId, kind) is what stops a re-run from sending the same reminder twice.
import { db, Prisma } from "../db.js";
import { notify } from "./notify.js";

export interface ReminderCadence {
  unansweredHours: number[];
  confirmedBeforeStartHours: number[];
  maxUnanswered: number;
}

export const DEFAULT_REMINDER_CADENCE: ReminderCadence = {
  unansweredHours: [48, 120],
  confirmedBeforeStartHours: [24, 1],
  maxUnanswered: 2,
};

/** A month is the longest offset worth honouring; more than ten offsets is not a cadence. */
export const REMINDER_CADENCE_LIMITS = { maxOffsets: 10, maxHours: 24 * 30, maxUnanswered: 10 };

type ParseResult = { ok: true; value: ReminderCadence } | { ok: false; error: string };

function validateOffsets(name: string, input: unknown): { ok: true; value: number[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: `${name} must be an array of hours` };
  if (input.length > REMINDER_CADENCE_LIMITS.maxOffsets) {
    return { ok: false, error: `${name} may hold at most ${REMINDER_CADENCE_LIMITS.maxOffsets} offsets` };
  }
  const value: number[] = [];
  for (const entry of input) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry <= 0 || entry > REMINDER_CADENCE_LIMITS.maxHours) {
      return { ok: false, error: `${name} offsets must be whole hours between 1 and ${REMINDER_CADENCE_LIMITS.maxHours}` };
    }
    value.push(entry);
  }
  return { ok: true, value: [...new Set(value)].sort((a, b) => a - b) };
}

/**
 * Validates the shape an org admin sends. Missing fields fall back to the defaults, so a client
 * that only edits one list does not have to resend the rest.
 */
export function validateReminderCadence(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "reminderCadence must be an object" };
  }
  const raw = input as Record<string, unknown>;
  const unanswered = raw.unansweredHours === undefined
    ? { ok: true as const, value: [...DEFAULT_REMINDER_CADENCE.unansweredHours] }
    : validateOffsets("unansweredHours", raw.unansweredHours);
  if (!unanswered.ok) return unanswered;
  const confirmed = raw.confirmedBeforeStartHours === undefined
    ? { ok: true as const, value: [...DEFAULT_REMINDER_CADENCE.confirmedBeforeStartHours] }
    : validateOffsets("confirmedBeforeStartHours", raw.confirmedBeforeStartHours);
  if (!confirmed.ok) return confirmed;
  let maxUnanswered = DEFAULT_REMINDER_CADENCE.maxUnanswered;
  if (raw.maxUnanswered !== undefined) {
    const value = raw.maxUnanswered;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > REMINDER_CADENCE_LIMITS.maxUnanswered) {
      return { ok: false, error: `maxUnanswered must be a whole number between 0 and ${REMINDER_CADENCE_LIMITS.maxUnanswered}` };
    }
    maxUnanswered = value;
  }
  return { ok: true, value: { unansweredHours: unanswered.value, confirmedBeforeStartHours: confirmed.value, maxUnanswered } };
}

/** Reads a stored cadence. A corrupt row falls back to the defaults rather than breaking the job. */
export function parseReminderCadence(raw: string | null | undefined): ReminderCadence {
  if (!raw) return { ...DEFAULT_REMINDER_CADENCE };
  try {
    const parsed = validateReminderCadence(JSON.parse(raw));
    return parsed.ok ? parsed.value : { ...DEFAULT_REMINDER_CADENCE };
  } catch {
    return { ...DEFAULT_REMINDER_CADENCE };
  }
}

function hoursBefore(date: Date, hours: number): number {
  return date.getTime() - hours * 3600_000;
}

function describeWhen(session: { date: string; time: string; startsAt: Date | null }): string {
  return session.startsAt ? session.startsAt.toLocaleString("en-GB") : `${session.date} ${session.time}`;
}

async function claimReminder(sessionId: string, learnerId: string, kind: string): Promise<boolean> {
  try {
    await db.reminderLog.create({ data: { sessionId, learnerId, kind } });
    return true;
  } catch (e) {
    // The unique (sessionId, learnerId, kind) is the dedupe: someone else already sent it.
    // Anything else is logged and skipped; the next run can try again because no row exists.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      console.error("[reminders] could not record a reminder:", e instanceof Error ? e.message : e);
    }
    return false;
  }
}

/**
 * Sends every reminder that is due at `now`. Org-scoped when `orgId` is passed (the manual
 * endpoint), otherwise every organization (the scheduled job).
 */
export async function runReminders(now = new Date(), options: { orgId?: string } = {}): Promise<{ reminded: number; sessions: number }> {
  const sessions = await db.session.findMany({
    where: {
      ...(options.orgId ? { orgId: options.orgId } : {}),
      status: "scheduled",
      startsAt: { gt: now },
    },
    select: {
      id: true, title: true, orgId: true, courseId: true, programmeId: true,
      date: true, time: true, startsAt: true, endsAt: true, joinUrl: true, location: true,
    },
    orderBy: { startsAt: "asc" },
    take: 500,
  }).catch(() => []);
  if (!sessions.length) return { reminded: 0, sessions: 0 };

  const orgIds = [...new Set(sessions.map((s) => s.orgId).filter((v): v is string => !!v))];
  const orgs = orgIds.length
    ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, reminderCadenceJson: true } }).catch(() => [])
    : [];
  const cadenceByOrg = new Map(orgs.map((o) => [o.id, parseReminderCadence(o.reminderCadenceJson)]));

  let reminded = 0;
  let touched = 0;
  for (const session of sessions) {
    const cadence = (session.orgId ? cadenceByOrg.get(session.orgId) : undefined) ?? DEFAULT_REMINDER_CADENCE;
    const startsAt = session.startsAt!;
    const rsvps = await db.sessionRSVP.findMany({
      where: { sessionId: session.id, status: { in: ["invited", "confirmed"] } },
      select: { learnerId: true, status: true, createdAt: true, learner: { select: { isActive: true } } },
    }).catch(() => []);
    if (!rsvps.length) continue;

    // A withdrawn learner keeps an RSVP row; the enrolment is what says they are no longer on
    // the programme, so it decides eligibility here too.
    const learnerIds = rsvps.map((r) => r.learnerId);
    const liveEnrolments = session.courseId || session.programmeId
      ? await db.enrolment.findMany({
          where: {
            learnerId: { in: learnerIds },
            status: { not: "withdrawn" },
            ...(session.courseId ? { courseId: session.courseId } : { programmeId: session.programmeId! }),
          },
          select: { learnerId: true },
        }).catch(() => [])
      : learnerIds.map((learnerId) => ({ learnerId }));
    const eligible = new Set(liveEnrolments.map((e) => e.learnerId));

    for (const rsvp of rsvps) {
      if (rsvp.learner.isActive === false) continue;
      if (!eligible.has(rsvp.learnerId)) continue;
      let sent = false;

      if (rsvp.status === "invited" && cadence.maxUnanswered > 0) {
        const already = await db.reminderLog.count({
          where: { sessionId: session.id, learnerId: rsvp.learnerId, kind: { startsWith: "rsvp_" } },
        }).catch(() => 0);
        let sentThisRun = 0;
        for (const offset of cadence.unansweredHours) {
          if (already + sentThisRun >= cadence.maxUnanswered) break;
          if (now.getTime() < rsvp.createdAt.getTime() + offset * 3600_000) continue;
          const kind = `rsvp_${offset}`;
          if (!(await claimReminder(session.id, rsvp.learnerId, kind))) continue;
          await notify(rsvp.learnerId, "rsvp_reminder", {
            title: `Please respond to your invitation: ${session.title}`,
            body: `"${session.title}" starts ${describeWhen(session)}. Please confirm or decline your place.`,
            link: "/calendar",
          });
          reminded += 1;
          sentThisRun += 1;
          sent = true;
        }
      }

      if (rsvp.status === "confirmed") {
        for (const offset of cadence.confirmedBeforeStartHours) {
          if (now.getTime() < hoursBefore(startsAt, offset)) continue;
          const kind = `session_${offset}`;
          if (!(await claimReminder(session.id, rsvp.learnerId, kind))) continue;
          const where = session.joinUrl ? ` Join: ${session.joinUrl}` : session.location ? ` Location: ${session.location}` : "";
          await notify(rsvp.learnerId, "session_reminder", {
            title: `Session reminder: ${session.title}`,
            body: `Starts ${describeWhen(session)}.${where}`,
            link: "/calendar",
          });
          reminded += 1;
          sent = true;
        }
      }

      if (sent) touched += 1;
    }
  }
  return { reminded, sessions: touched };
}

/**
 * Round 8 / D.1: on by default. 15 minutes is short enough that the hour offsets are honoured
 * and long enough that the job is cheap; `REMINDER_INTERVAL_MS=0` turns it off explicitly.
 */
export function scheduleReminderJob(): void {
  const raw = process.env.REMINDER_INTERVAL_MS;
  let interval = 15 * 60 * 1000;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.warn(`[reminders] REMINDER_INTERVAL_MS=${raw} is not a number; using 15 minutes`);
    } else {
      interval = parsed;
    }
  }
  if (interval <= 0) return;
  const timer = setInterval(() => {
    runReminders().catch((e) => console.error("[reminders] job failed", e));
  }, interval);
  timer.unref?.();
}
