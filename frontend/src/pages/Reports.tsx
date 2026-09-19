import { useMemo, useState, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch as Toggle } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useWorkspace,
  useDashboardSummary,
  useKpiSummary,
  useProgrammes,
  useCourses,
  useCreateCourse,
  useSubmitAttempt,
  useModules,
  useSessions,
  useThreads,
  useThreadMessages,
  useSendMessage,
  useBookings,
  useCreateBooking,
  useCalendarEvents,
  useReviewCreditSettings,
  useUpdateReviewCreditSettings,
  useAuditLogs,
  useEnrolments,
  useCertificates,
  downloadReviewCreditCsv,
  type Course,
  type ReviewCreditSettings,
} from '@/api/hooks';
import { getToken, clearSession, getSessionUser } from '@/api/client';
import { StakeholderDashboard } from '@/pages/StakeholderDashboard';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { AiConceptExplainer } from '@/components/AiConceptExplainer';
import { BulkImportButton } from '@/components/BulkImport';
import {
  Activity, ArrowUpRight, BarChart3, Bell, BookOpen, CalendarDays, Check, ChevronDown,
  CircleAlert, Clock3, Download, FileCheck2, Gauge, GraduationCap, LayoutDashboard,
  Menu, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search, Send, Settings2,
  ShieldCheck, SlidersHorizontal, Target, TrendingDown, TrendingUp, Users, X, Zap,
} from 'lucide-react';

import { fmtDate, pct, initials, Skeleton, EmptyState, ErrorState, Status, ProgressLine, PageHeading, KpiCard } from '@/components/shared';

function exportKpiPanel(orgName: string) {
  const el = document.getElementById('kpi-export-panel');
  if (!el) return;
  const canvas = document.createElement('canvas');
  const scale = 2;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1a2332';
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillText(orgName, 16, 28);
  ctx.fillStyle = '#64748b';
  ctx.font = '400 11px Inter, sans-serif';
  ctx.fillText(`Reports — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, 16, 46);
  const cards = el.querySelectorAll('[data-kpi]');
  let x = 16;
  cards.forEach((card) => {
    const label = card.getAttribute('data-kpi-label') || '';
    const value = card.getAttribute('data-kpi-value') || '';
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, 64, 160, 72, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.font = '500 9px "DM Mono", monospace';
    ctx.fillText(label.toUpperCase(), x + 10, 82);
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 22px Inter, sans-serif';
    ctx.fillText(value, x + 10, 112);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 9px Inter, sans-serif';
    const detail = card.getAttribute('data-kpi-detail') || '';
    ctx.fillText(detail, x + 10, 126);
    x += 172;
  });
  const link = document.createElement('a');
  link.download = `trainhub360-kpi-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function Reports() {
  const kpi = useKpiSummary();
  const programmes = useProgrammes();
  const workspace = useWorkspace();
  const [exporting, setExporting] = useState(false);
  const handleExport = () => { setExporting(true); try { exportKpiPanel(workspace.data?.organization.name || 'TrainHub360'); } finally { setExporting(false); } };
  return <div className="page-in">
    <PageHeading eyebrow="Reports" title="Prove the progress." detail="Completion versus competence, drilled down to every programme." action={<Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}><Download className="size-3.5" />{exporting ? 'Exporting…' : 'Export KPI panel'}</Button>} />
    {kpi.isLoading || programmes.isLoading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    : kpi.isError || programmes.isError ? <ErrorState retry={() => { kpi.refetch(); programmes.refetch(); }} />
    : <>
      <div id="kpi-export-panel" className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div data-kpi data-kpi-label="Compliance health" data-kpi-value={pct(kpi.data?.complianceHealth)} data-kpi-detail="Workspace-wide"><KpiCard label="Compliance health" value={pct(kpi.data?.complianceHealth)} detail="Workspace-wide" icon={ShieldCheck} tone="good" /></div>
        <div data-kpi data-kpi-label="Completion" data-kpi-value={pct(kpi.data?.completionRate)} data-kpi-detail="Courses finished"><KpiCard label="Completion" value={pct(kpi.data?.completionRate)} detail="Courses finished" icon={BookOpen} /></div>
        <div data-kpi data-kpi-label="Competence" data-kpi-value={pct(kpi.data?.competencyRate)} data-kpi-detail="Evidence-backed"><KpiCard label="Competence" value={pct(kpi.data?.competencyRate)} detail="Evidence-backed" icon={Target} tone="accent" /></div>
        <div data-kpi data-kpi-label="Drop-off" data-kpi-value={pct(kpi.data?.dropOffRate)} data-kpi-detail="Needs attention"><KpiCard label="Drop-off" value={pct(kpi.data?.dropOffRate)} detail="Needs attention" icon={Activity} tone="warn" /></div>
        <div data-kpi data-kpi-label="Time to competency" data-kpi-value={`${kpi.data?.timeToCompetency ?? 0}d`} data-kpi-detail="Average"><KpiCard label="Time to competency" value={`${kpi.data?.timeToCompetency ?? 0}d`} detail="Average across learners" icon={Clock3} /></div>
      </div>
      <section className="mt-4 rounded-lg border border-border/80 bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Completion vs competence</p><h2 className="mt-1 text-base font-bold">Programme bars</h2>
        <div className="mt-4 space-y-3">{(programmes.data || []).map((p) => <div key={p.id}><div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold">{p.name}</span><span className="font-mono text-xs">{pct(p.progress)}</span></div><ProgressLine value={p.progress} color={p.progress > 70 ? 'bg-emerald-600' : 'bg-primary'} /></div>)}
      {!programmes.data?.length && <EmptyState title="No data yet" detail="Programme bars will render here." />}</div>
      </section>
      <section className="mt-4 overflow-hidden rounded-lg border border-border/80 bg-card"><div className="border-b border-border/70 p-4"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Drill-down</p><h2 className="mt-1 text-base font-bold">Programme table</h2></div>
        <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2.5">Programme</th><th className="px-4 py-2.5">Type</th><th className="px-4 py-2.5">Learners</th><th className="px-4 py-2.5">Progress</th><th className="px-4 py-2.5">Status</th></tr></thead><tbody className="divide-y divide-border/70">{(programmes.data || []).map((p) => <tr key={p.id}><td className="px-4 py-2.5 font-semibold">{p.name}</td><td className="px-4 py-2.5 text-muted-foreground">{p.type}</td><td className="px-4 py-2.5">{p.learnerCount}</td><td className="px-4 py-2.5 font-mono">{pct(p.progress)}</td><td className="px-4 py-2.5"><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status></td></tr>)}</tbody></table>
      </section>
    </>}
  </div>;
}
