import { useMemo, useState, type ReactNode } from 'react';
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
  ShieldCheck, SlidersHorizontal, Target, Users, X, Zap,
} from 'lucide-react';

const queryClient = new QueryClient();

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/learning', label: 'Learning', icon: BookOpen },
  { href: '/programmes', label: 'Programmes', icon: GraduationCap },
  { href: '/people', label: 'People', icon: Users },
  { href: '/my-learning', label: 'My learning', icon: Target },
  { href: '/assessments', label: 'Assessments', icon: FileCheck2 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
];
const adminNav = [
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/governance', label: 'Governance', icon: ShieldCheck },
  { href: '/review-credit', label: 'Review credit', icon: Zap },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

import { fmtDate, pct, initials, Skeleton, EmptyState, ErrorState, Status, ProgressLine, PageHeading, KpiCard } from '@/components/shared';
export function ReviewCredit() {
  const settings = useReviewCreditSettings();
  const update = useUpdateReviewCreditSettings();
  const [local, setLocal] = useState<ReviewCreditSettings | null>(null);
  const [exporting, setExporting] = useState(false);
  const value = local || settings.data;
  const save = (patch: Partial<ReviewCreditSettings>) => {
    if (!value) return;
    const next = { ...value, ...patch };
    setLocal(next);
    update.mutate(patch, { onError: () => setLocal(value) });
  };
  const exportCsv = async () => {
    setExporting(true);
    try { await downloadReviewCreditCsv(); } finally { setExporting(false); }
  };
  return <div className="page-in">
    <PageHeading eyebrow="Governance controls" title="Make performance visible." detail="Give managers a defensible way to credit demonstrated learning in performance reviews." action={<Button variant="outline" onClick={exportCsv} disabled={exporting}><Download className="size-4" />{exporting ? 'Preparing…' : 'Export credits'}</Button>} />
    {settings.isLoading ? <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
    : settings.isError ? <ErrorState retry={() => settings.refetch()} />
    : value && <div className="grid gap-4 xl:grid-cols-[1fr_.72fr]">
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <div className="flex items-center justify-between border-b border-border/70 pb-4"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Workspace switch</p><h2 className="mt-1 text-base font-bold">Review credit is {value.enabled ? 'active' : 'off'}</h2><p className="mt-1 text-sm text-muted-foreground">When enabled, competence evidence can contribute to performance reviews.</p></div><Toggle checked={value.enabled} onCheckedChange={(checked) => save({ enabled: checked })} /></div>
        <div className="mt-5 space-y-4">
          <div><div className="flex justify-between text-sm"><span className="font-semibold">Maximum weighting</span><span className="font-mono text-primary">{value.maxWeighting}%</span></div><input className="mt-2 w-full accent-[hsl(var(--primary))]" type="range" min="0" max="40" value={value.maxWeighting} onChange={(e) => save({ maxWeighting: Number(e.target.value) })} /></div>
          <div className="grid gap-2.5 sm:grid-cols-3">{([['Assessment', value.assessmentWeight], ['Timeliness', value.timelinessWeight], ['Application', value.applicationWeight]] as const).map(([label, amount]) => <div key={label} className="rounded-md bg-secondary/55 p-2.5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 font-mono text-base font-bold">{amount}%</p></div>)}</div>
        </div>
      </section>
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Policy</p><h2 className="mt-1 text-base font-bold">Guardrails</h2>
        <div className="mt-3 space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Require manager sign-off</span><Toggle checked={value.requireManagerSignoff} onCheckedChange={(checked) => save({ requireManagerSignoff: checked })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Collect application scores</span><Toggle checked={value.collectApplicationScores} onCheckedChange={(checked) => save({ collectApplicationScores: checked })} /></label>
          <div><p className="text-sm font-semibold">Eligible programme types</p><div className="mt-1.5 flex flex-wrap gap-1.5">{value.eligibleProgrammeTypes.map((t) => <Status key={t} tone="good">{t}</Status>)}{!value.eligibleProgrammeTypes.length && <span className="text-xs text-muted-foreground">All types eligible</span>}</div></div>
          {update.isError && <p className="text-xs text-destructive">Save failed — retry the toggle.</p>}
        </div>
      </section>
    </div>}
  </div>;
}


