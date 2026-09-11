import { db } from "../db.js";
import { getLearnerFreeSlots } from "../services/nudge.js";

export interface NudgePayload {
  learnerId: string;
  courseId: string;
  scheduledFor: string;
  channel: "in-app";
}

export async function runNudgeJob(now: Date = new Date()): Promise<{ queued: number; payloads: NudgePayload[] }> {
  const stale = await db.enrolment.findMany({
    where: { status: { not: "completed" }, completionDate: null, reviewCreditExcluded: false },
    take: 200,
  }).catch(() => []);
  const payloads: NudgePayload[] = [];
  for (const e of stale) {
    const { slots } = await getLearnerFreeSlots(e.learnerId, now).catch(() => ({ slots: [] as { start: Date; end: Date }[] }));
    const slot = slots.find((s) => s.end > now) ?? slots[0];
    if (!slot) continue;
    const at = slot.start < now ? now : slot.start;
    payloads.push({ learnerId: e.learnerId, courseId: e.courseId, scheduledFor: at.toISOString(), channel: "in-app" });
    console.log(`[nudge-job] learner=${e.learnerId} course=${e.courseId} at=${at.toISOString()}`);
  }
  return { queued: payloads.length, payloads };
}
