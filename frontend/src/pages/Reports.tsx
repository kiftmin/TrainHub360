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
export function Reports() {
  const kpi = useKpiSummary();
  const programmes = useProgrammes();
  return <div className="page-in">
    <PageHeading eyebrow="Reports" title="Prove the progress." detail="Completion versus competence, drilled down to every programme." />
    {kpi.isLoading || programmes.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36" />)}</div>
    : kpi.isError || programmes.isError ? <ErrorState retry={() => { kpi.refetch(); programmes.refetch(); }} />
    : <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Compliance health" value={pct(kpi.data?.complianceHealth)} detail="Workspace-wide" icon={ShieldCheck} tone="good" />
        <KpiCard label="Completion" value={pct(kpi.data?.completionRate)} detail="Courses finished" icon={BookOpen} />
        <KpiCard label="Competence" value={pct(kpi.data?.competencyRate)} detail="Evidence-backed" icon={Target} tone="accent" />
        <KpiCard label="Drop-off" value={pct(kpi.data?.dropOffRate)} detail="Needs attention" icon={Activity} tone="warn" />
      </div>
      <section className="mt-5 rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Completion vs competence</p><h2 className="mt-1 text-lg font-bold">Programme bars</h2>
        <div className="mt-5 space-y-4">{(programmes.data || []).map((p) => <div key={p.id}><div className="mb-2 flex justify-between text-sm"><span className="font-semibold">{p.name}</span><span className="font-mono text-xs">{pct(p.progress)}</span></div><ProgressLine value={p.progress} color={p.progress > 70 ? 'bg-emerald-600' : 'bg-primary'} /></div>)}
        {!programmes.data?.length && <EmptyState title="No data yet" detail="Programme bars will render here." />}</div>
      </section>
      <section className="mt-5 overflow-hidden rounded-xl border border-border/80 bg-card"><div className="border-b border-border/70 p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Drill-down</p><h2 className="mt-1 text-lg font-bold">Programme table</h2></div>
        <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="p-4">Programme</th><th className="p-4">Type</th><th className="p-4">Learners</th><th className="p-4">Progress</th><th className="p-4">Status</th></tr></thead><tbody className="divide-y divide-border/70">{(programmes.data || []).map((p) => <tr key={p.id}><td className="p-4 font-semibold">{p.name}</td><td className="p-4 text-muted-foreground">{p.type}</td><td className="p-4">{p.learnerCount}</td><td className="p-4 font-mono">{pct(p.progress)}</td><td className="p-4"><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status></td></tr>)}</tbody></table>
      </section>
    </>}
  </div>;
}

const RBAC = [
  { action: 'View programmes', admin: true, manager: true, trainer: true, learner: true },
  { action: 'Create courses', admin: true, manager: true, trainer: false, learner: false },
  { action: 'Submit assessments', admin: true, manager: true, trainer: true, learner: false },
  { action: 'Manage bookings', admin: true, manager: true, trainer: true, learner: false },
  { action: 'Edit review-credit', admin: true, manager: false, trainer: false, learner: false },
  { action: 'View audit logs', admin: true, manager: false, trainer: false, learner: false },
];


