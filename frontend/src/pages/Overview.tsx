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
export function Overview() {
  const [, setLocation] = useLocation();
  const summary = useDashboardSummary();
  const programmes = useProgrammes();
  const workspace = useWorkspace();
  const data = summary.data;
  const loading = summary.isLoading || programmes.isLoading || workspace.isLoading;
  return <div className="page-in">
    <PageHeading eyebrow="Manager overview" title="Readiness, at a glance." detail={`A live view of competence across ${workspace.data?.organization.name || 'your workspace'}.`} action={<div className="flex items-center gap-2"><Button variant="outline" size="sm"><Download className="size-4" />Export brief</Button><Button size="sm" onClick={() => setLocation('/assessments')}><Plus className="size-4" />Run assessment</Button></div>} />
    {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36" />)}</div>
    : summary.isError ? <ErrorState retry={() => summary.refetch()} />
    : <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Compliance health" value={pct(data?.complianceHealth)} detail="Across active programmes" icon={ShieldCheck} tone="good" />
        <KpiCard label="Competence met" value={pct(data?.competencyRate)} detail={`${data?.completionRate ?? 0}% completion rate`} icon={Target} tone="accent" />
        <KpiCard label="Credentials expiring" value={`${data?.expiringCredentials ?? 0}`} detail="Within the next 30 days" icon={Clock3} tone="warn" />
        <KpiCard label="Time to competence" value={`${data?.timeToCompetency ?? 0}d`} detail={`${data?.trainerUtilization ?? 0}% trainer utilization`} icon={Zap} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.9fr]">
        <section className="rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Learning activity</p><h2 className="mt-1 text-lg font-bold tracking-[-.025em]">Momentum this week</h2></div><button className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary" aria-label="Activity options"><SlidersHorizontal className="size-4" /></button></div>
          <div className="mt-7 flex h-48 items-end gap-2 sm:gap-4">{(data?.weeklyActivity || []).map((point) => <div key={point.label} className="flex flex-1 flex-col items-center gap-2"><div className="flex h-36 w-full items-end justify-center gap-1.5">{[point.active, point.completed].map((v, index) => <div key={index} className={cn('w-1/2 max-w-8 rounded-t-sm transition-all duration-700', index === 0 ? 'bg-primary/25' : 'bg-primary')} style={{ height: `${Math.max(8, v)}%` }} title={`${v} ${index ? 'completed' : 'active'}`} />)}</div><span className="font-mono text-[10px] text-muted-foreground">{point.label}</span></div>)}</div>
          <div className="mt-4 flex gap-5 border-t border-border/70 pt-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-primary/25" />Active learning</span><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-primary" />Completed</span></div>
        </section>
        <section className="rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Programme pulse</p><h2 className="mt-1 text-lg font-bold tracking-[-.025em]">Active programmes</h2></div><Link href="/learning" className="text-xs font-semibold text-primary hover:underline">View all</Link></div>
          <div className="mt-5 space-y-4">{programmes.data?.length ? programmes.data.slice(0, 4).map((programme) => <div key={programme.id}><div className="mb-2 flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{programme.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{programme.learnerCount} learners · {programme.courseCount} courses</p></div><span className="font-mono text-xs font-medium">{pct(programme.progress)}</span></div><ProgressLine value={programme.progress} color={programme.progress > 70 ? 'bg-emerald-600' : 'bg-primary'} /></div>) : <EmptyState title="No programmes yet" detail="Create your first programme to see readiness here." />}</div>
        </section>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.45fr]">
        <section className="rounded-xl border border-border/80 bg-primary p-5 text-primary-foreground">
          <div className="flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Readiness signal</p><Activity className="size-4 text-accent" /></div>
          <div className="mt-7 grid grid-cols-2 gap-5"><div><p className="text-4xl font-extrabold tracking-[-.06em]">{pct(data?.dropOffRate)}</p><p className="mt-1 text-xs text-primary-foreground/65">drop-off rate</p></div><div><p className="text-4xl font-extrabold tracking-[-.06em]">{pct(data?.trainerUtilization)}</p><p className="mt-1 text-xs text-primary-foreground/65">trainer utilized</p></div></div>
          <div className="mt-8 border-t border-primary-foreground/15 pt-3 text-xs text-primary-foreground/65">The fastest lever this week is reducing assessment drop-off.</div>
        </section>
        <section className="rounded-xl border border-border/80 bg-card p-5">
          <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Governance queue</p><h2 className="mt-1 text-lg font-bold">Expiring credentials</h2></div><Link href="/learning" className="text-xs font-semibold text-primary">Review queue <ArrowUpRight className="ml-1 inline size-3.5" /></Link></div>
          <div className="mt-4 divide-y divide-border/70">{data?.expiringItems?.length ? data.expiringItems.slice(0, 3).map((item, index) => <div className="flex items-center gap-3 py-3" key={`${item.name}-${index}`}><div className="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-700"><Clock3 className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.course}</p></div><div className="text-right"><Status tone={item.status === 'expired' ? 'bad' : 'warn'}>{item.status}</Status><p className="mt-1 text-[11px] text-muted-foreground">{fmtDate(item.expires)}</p></div></div>) : <EmptyState title="Nothing expiring" detail="All credentials are current." />}</div>
        </section>
      </div>
    </>}
  </div>;
}


