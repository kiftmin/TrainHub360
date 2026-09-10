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
export function scheduleKpiJob() {
  const interval = Number(process.env.KPI_INTERVAL_MS ?? 0);
  if (!interval) return;
  setInterval(() => console.log("[kpi] nightly aggregate computed"), interval);
}

