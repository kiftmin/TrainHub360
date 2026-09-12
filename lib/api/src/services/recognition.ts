import { db } from "../db.js";

export const HIGH_APPLIED_SCORE = 90;

export async function awardRecognition(userId: string, type: string, context?: string) {
  const existing = await db.recognition.findFirst({ where: { userId, type, context: context ?? null } }).catch(() => null);
  if (existing) return { awarded: false, id: existing.id };
  const r = await db.recognition.create({ data: { userId, type, context: context ?? null } });
  return { awarded: true, id: r.id };
}

export async function checkAppliedScoreRecognition(enrolmentId: string): Promise<{ awarded: boolean }> {
  const e = await db.enrolment.findUnique({ where: { id: enrolmentId } }).catch(() => null);
  if (!e || (e.appliedAssessmentScore ?? 0) < HIGH_APPLIED_SCORE) return { awarded: false };
  const r = await awardRecognition(e.learnerId, "high_applied_score", `enrolment:${e.id}:${e.appliedAssessmentScore}`);
  return { awarded: r.awarded };
}

function weekKey(d: Date): string {
  const t = new Date(d);
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day);
  return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
}

export function consecutiveWeeks(completionDates: (Date | string)[], needed = 3): boolean {
  const weeks = [...new Set(completionDates.map((d) => +new Date(weekKey(new Date(d)))) )].sort((a, b) => a - b).map((t) => new Date(t));
  if (weeks.length < needed) return false;
  let run = 1;
  for (let i = 1; i < weeks.length; i += 1) {
    const prev = weeks[i - 1];
    const cur = weeks[i];
    const diffDays = Math.round((+cur - +prev) / 86400000);
    if (diffDays === 7) {
      run += 1;
      if (run >= needed) return true;
    } else if (diffDays > 7) {
      run = 1;
    }
  }
  return run >= needed;
}

export async function checkStreakRecognition(learnerId: string, weeks = 3): Promise<{ awarded: boolean }> {
  const enrolments = await db.enrolment.findMany({ where: { learnerId, status: "completed", completionDate: { not: null } }, select: { completionDate: true } }).catch(() => []);
  if (!consecutiveWeeks(enrolments.map((e) => e.completionDate as Date), weeks)) return { awarded: false };
  const r = await awardRecognition(learnerId, "streak", `weeks:${weeks}`);
  return { awarded: r.awarded };
}
