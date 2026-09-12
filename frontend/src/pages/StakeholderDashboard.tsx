import type { ReactNode } from "react";
import { useProgrammes, useKpiSummary } from "@/api/hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Target, BookOpen, RefreshCw, CircleAlert } from "lucide-react";

function pct(value?: number | null) { return `${Math.round(value ?? 0)}%`; }
function Skeleton({ className }: { className?: string }) { return <div className={cn('skeleton rounded-lg', className)} />; }
function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center">
    <CircleAlert className="mb-3 size-6 text-destructive" /><p className="font-semibold">Could not load this view</p>
    {retry && <Button variant="outline" size="sm" className="mt-4" onClick={retry}><RefreshCw className="size-4" />Retry</Button>}
  </div>;
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/55 p-6 text-center">
    <p className="font-semibold text-foreground">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>
  </div>;
}
function PageHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="mb-8"><p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[.22em] text-primary">{eyebrow}</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-foreground md:text-[2.45rem]">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p></div>;
}
function KpiCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Users }) {
  return <div className="rounded-xl border border-border/80 bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</p><p className="mt-4 text-2xl font-extrabold tracking-[-.04em]">{value}</p><p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{detail}</p></div>;
}
function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'neutral' }) {
  return <Badge variant="outline" className={cn('font-mono text-[10px] uppercase tracking-[.12em]', tone === 'good' && 'border-emerald-600/25 bg-emerald-50 text-emerald-700', tone === 'warn' && 'border-amber-600/25 bg-amber-50 text-amber-700')}>{children}</Badge>;
}
function ProgressLine({ value }: { value: number }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={cn('h-full rounded-full bg-primary transition-all duration-700')} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

export function StakeholderDashboard() {
  const programmes = useProgrammes();
  const kpis = useKpiSummary();
  return (
    <div className="page-in">
      <PageHeading eyebrow="Stakeholder view" title="Progress, at a glance." detail="Read-only coverage across the programmes you oversee." />
      {programmes.isLoading || kpis.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : programmes.isError || kpis.isError ? (
        <ErrorState retry={() => { programmes.refetch(); kpis.refetch(); }} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard label="Programmes" value={`${programmes.data?.length ?? 0}`} detail="In your scope" icon={BookOpen} />
            <KpiCard label="Competence" value={pct(kpis.data?.competencyRate)} detail="Across scoped programmes" icon={Target} />
            <KpiCard label="Completion" value={pct(kpis.data?.completionRate)} detail="Hygiene metric" icon={Users} />
          </div>
          <section className="mt-5 rounded-xl border border-border/80 bg-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Coverage</p>
            <h2 className="mt-1 text-lg font-bold">Programme progress</h2>
            <div className="mt-4 space-y-4">
              {(programmes.data || []).map((p) => (
                <div key={p.id}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <Status tone={p.progress > 70 ? 'good' : 'neutral'}>{pct(p.progress)}</Status>
                  </div>
                  <ProgressLine value={p.progress} />
                  <p className="mt-1 text-[11px] text-muted-foreground">{p.learnerCount} learners · {p.courseCount} courses</p>
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
