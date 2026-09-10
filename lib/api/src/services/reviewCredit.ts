export interface EnrolmentInput {
  appliedAssessmentScore?: number | null;
  completionDate?: string | Date | null;
  deadlineDate?: string | Date | null;
  applicationScore?: number | null;
  weights?: { wa: number; wb: number; wc: number };
}

export function timelinessScore(completion?: string | Date | null, deadline?: string | Date | null): number {
  if (!completion) return 0;
  if (!deadline) return 100;
  const days = (new Date(completion).getTime() - new Date(deadline).getTime()) / 86400000;
  if (days <= 0) return 100;
  if (days <= 7) return 50;
  if (days <= 30) return 25;
  return 0;
}

export function calculateEnrolmentScore(e: EnrolmentInput): { score: number; a: number; b: number; c: number | null } {
  const a = e.appliedAssessmentScore ?? 0;
  const b = timelinessScore(e.completionDate ?? null, e.deadlineDate ?? null);
  const hasC = e.applicationScore != null;
  const c = e.applicationScore ?? null;
  let wa = e.weights?.wa ?? 50, wb = e.weights?.wb ?? 30, wc = e.weights?.wc ?? 20;
  if (!hasC) {
    const total = wa + wb;
    wa = (wa / total) * 100; wb = (wb / total) * 100; wc = 0;
  }
  const score = (a * wa + b * wb + (c ?? 0) * wc) / 100;
  return { score: Math.round(score * 100) / 100, a, b, c };
}

export function aggregateReviewCredit(scores: number[], maxWeighting: number) {
  if (!scores.length) return { raw: 0, final: 0 };
  const raw = scores.reduce((s, v) => s + v, 0) / scores.length;
  return { raw: Math.round(raw * 100) / 100, final: Math.round(((raw / 100) * maxWeighting) * 1000) / 1000 };
}

export function exportCSV(rows: { learnerId: string; raw: number; final: number; signoff: string }[]): string {
  const head = "learnerId,raw,final,signoff";
  return [head, ...rows.map((r) => [r.learnerId, r.raw, r.final, r.signoff].join(","))].join("\n");
}

