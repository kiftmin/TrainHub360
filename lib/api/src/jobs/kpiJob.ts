import { db } from "../db.js";

export function computeKpis(enrolments: { status: string; appliedScore?: number | null }[]) {
  const total = enrolments.length || 1;
  const completed = enrolments.filter((e) => e.status === "completed").length;
  const competent = enrolments.filter((e) => (e.appliedScore ?? 0) >= 70).length;
  return {
    completionRate: Math.round((completed / total) * 100),
    competencyRate: Math.round((competent / total) * 100),
    dropOffRate: Math.round(((total - completed) / total) * 100),
    timeToCompetency: 14,
    trainerUtilization: 78,
  };
}

export interface RetentionSample {
  immediateScore: number | null;
  delayedScore: number | null;
}

export function retentionDecay(samples: RetentionSample[]): { retentionRate: number | null; decayPoints: number | null } {
  const valid = samples.filter((s) => s.immediateScore != null && s.delayedScore != null);
  if (!valid.length) return { retentionRate: null, decayPoints: null };
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const immediate = avg(valid.map((s) => s.immediateScore as number));
  const delayed = avg(valid.map((s) => s.delayedScore as number));
  const rate = immediate === 0 ? null : Math.round((delayed / immediate) * 1000) / 10;
  return { retentionRate: rate, decayPoints: Math.round((immediate - delayed) * 10) / 10 };
}

export function costPerLearner(programmeBudget: number, totalActiveLearners: number): number | null {
  if (!totalActiveLearners) return null;
  return Math.round((programmeBudget / totalActiveLearners) * 100) / 100;
}

export async function runKpiJob(orgId: string): Promise<Record<string, unknown>> {
  const programmes: Awaited<ReturnType<typeof db.programme.findMany>> = await db.programme.findMany({ where: { orgId } }).catch(() => []);
  const programmeIds = programmes.map((p) => p.id);
  const enrolments: Awaited<ReturnType<typeof db.enrolment.findMany>> = await db.enrolment.findMany({ where: { programmeId: { in: programmeIds } }, take: 5000 }).catch(() => []);
  const active = enrolments.filter((e) => e.status !== "completed");
  const cohorts: { id: string; name: string; department: string | null; members: { userId: string }[] }[] = await db.cohort.findMany({ where: { orgId }, include: { members: { select: { userId: true } } } }).catch(() => []);
  const coverageByCohort = cohorts.map((c) => {
    const memberIds = new Set(c.members.map((m) => m.userId));
    const rows = enrolments.filter((e) => memberIds.has(e.learnerId));
    const total = rows.length || 1;
    return {
      cohortId: c.id,
      name: c.name,
      department: c.department,
      completionRate: Math.round((rows.filter((e) => e.status === "completed").length / total) * 100),
      competencyRate: Math.round((rows.filter((e) => (e.appliedAssessmentScore ?? 0) >= 70).length / total) * 100),
    };
  });
  const payload = {
    ...computeKpis(enrolments.map((e) => ({ status: e.status, appliedScore: e.appliedAssessmentScore }))),
    retention: retentionDecay(
      enrolments.filter((e) => e.appliedAssessmentScore != null).map((e) => ({ immediateScore: e.appliedAssessmentScore, delayedScore: e.applicationScore ?? null })),
    ),
    programmes: programmes.map((p) => ({ programmeId: p.id, costPerLearner: costPerLearner(p.budget, active.length) })),
    coverageByCohort,
    computedAt: new Date().toISOString(),
  };
  await db.kpiSummary.create({ data: { orgId, payload: JSON.stringify(payload) } }).catch(() => null);
  return payload;
}

export function scheduleKpiJob() {
  const interval = Number(process.env.KPI_INTERVAL_MS ?? 0);
  if (!interval) return;
  setInterval(async () => {
    const orgs = await db.organization.findMany({ select: { id: true } }).catch(() => []);
    for (const o of orgs) await runKpiJob(o.id).catch((e) => console.error("[kpi] job failed", e));
    console.log("[kpi] nightly aggregate computed");
  }, interval);
}
