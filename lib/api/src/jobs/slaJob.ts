import { db } from "../db.js";

export interface SlaThread {
  id: string;
  slaHours: number;
  lastLearnerMessageAt: Date | string | null;
  lastTrainerResponseAt: Date | string | null;
  isEscalated: boolean;
}

export interface ThreadMessageLike {
  author: string;
  authorRole?: string | null;
  createdAt: Date | string;
  learner?: boolean;
}

function isLearnerMessage(m: ThreadMessageLike): boolean {
  if (m.learner !== undefined) return m.learner;
  if (m.authorRole) return m.authorRole === "learner";
  return m.author === "learner";
}

export function avgResponseHours(messages: ThreadMessageLike[]): number | null {
  const sorted = [...messages].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const gaps: number[] = [];
  let pendingLearnerAt: number | null = null;
  for (const m of sorted) {
    if (isLearnerMessage(m)) {
      if (pendingLearnerAt == null) pendingLearnerAt = +new Date(m.createdAt);
    } else if (pendingLearnerAt != null) {
      gaps.push((+new Date(m.createdAt) - pendingLearnerAt) / 3600000);
      pendingLearnerAt = null;
    }
  }
  if (!gaps.length) return null;
  return Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length) * 10) / 10;
}

export function slaStatusFor(thread: SlaThread, avgHours?: number | null): string {
  if (thread.isEscalated) return "Escalated — awaiting trainer response";
  const awaiting = thread.lastLearnerMessageAt && (!thread.lastTrainerResponseAt || +new Date(thread.lastLearnerMessageAt) > +new Date(thread.lastTrainerResponseAt));
  const typical = avgHours ?? thread.slaHours;
  if (awaiting) return `Usually responds within ${typical} hours — reply pending`;
  return `Usually responds within ${typical} hours`;
}

export function findOverdueThreads(threads: SlaThread[], now: Date = new Date()): SlaThread[] {
  return threads.filter((t) => {
    if (t.isEscalated || !t.lastLearnerMessageAt) return false;
    if (t.lastTrainerResponseAt && +new Date(t.lastTrainerResponseAt) >= +new Date(t.lastLearnerMessageAt)) return false;
    return (now.getTime() - +new Date(t.lastLearnerMessageAt)) / 3600000 > t.slaHours;
  });
}

export async function runSlaJob(now: Date = new Date()): Promise<{ escalated: number }> {
  const threads = await db.messageThread.findMany({ where: { isEscalated: false } });
  const overdue = findOverdueThreads(threads as SlaThread[], now);
  for (const t of overdue) {
    await db.messageThread.update({ where: { id: t.id }, data: { isEscalated: true, escalatedAt: now, slaBreached: true } });
    await db.auditLog.create({
      data: { userId: null, action: "SLA_ESCALATION", entity: "message_thread", entityId: t.id, details: null },
    }).catch(() => null);
  }
  if (overdue.length) console.log(`[sla] escalated ${overdue.length} overdue thread(s)`);
  return { escalated: overdue.length };
}
