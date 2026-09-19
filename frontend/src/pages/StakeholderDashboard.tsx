import type { ReactNode } from "react";
import { useProgrammes, useKpiSummary } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Users, Target, BookOpen, RefreshCw, CircleAlert, ShieldCheck, Activity } from "lucide-react";
import { fmtDate, pct, Skeleton, EmptyState, ErrorState, Status, ProgressLine, PageHeading, KpiCard } from "@/components/shared";

export function StakeholderDashboard() {
  const programmes = useProgrammes();
  const kpis = useKpiSummary();
  return (
    <div className="page-in">
      <PageHeading eyebrow="Stakeholder view" title="Progress, at a glance." detail="Read-only coverage across the programmes you oversee." />
      {programmes.isLoading || kpis.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : programmes.isError || kpis.isError ? (
        <ErrorState retry={() => { programmes.refetch(); kpis.refetch(); }} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="Programmes" value={`${programmes.data?.length ?? 0}`} detail="In your scope" icon={BookOpen} />
            <KpiCard label="Compliance" value={pct(kpis.data?.complianceHealth)} detail="Workspace-wide" icon={ShieldCheck} />
            <KpiCard label="Competence" value={pct(kpis.data?.competencyRate)} detail="Evidence-backed" icon={Target} />
            <KpiCard label="Completion" value={pct(kpis.data?.completionRate)} detail="Courses finished" icon={Users} />
            <KpiCard label="At-risk" value={`${kpis.data?.dropOffRate ?? 0}%`} detail="Require intervention" icon={Activity} />
          </div>
          <section className="mt-4 rounded-lg border border-border/80 bg-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Coverage</p>
            <h2 className="mt-1 text-base font-bold">Programme progress</h2>
            <div className="mt-3 space-y-3">
              {(programmes.data || []).map((p) => (
                <div key={p.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <Status tone={p.progress > 70 ? 'good' : 'neutral'}>{pct(p.progress)}</Status>
                  </div>
                  <ProgressLine value={p.progress} />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{p.learnerCount} learners · {p.courseCount} courses</p>
                </div>
              ))}
            </div>
            {!programmes.data?.length && <EmptyState title="No programmes in scope" detail="Ask your administrator for programme access." />}
          </section>
        </>
      )}
    </div>
  );
}
