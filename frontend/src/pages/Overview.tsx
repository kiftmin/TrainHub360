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
  ShieldCheck, SlidersHorizontal, Target, TrendingDown, TrendingUp, Users, X, Zap,
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

function Delta({ value, label }: { value: number; label: string }) {
  const positive = value >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-[10px]', positive ? 'text-emerald-600' : 'text-destructive')}>
      {positive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {positive ? '+' : ''}{value}% {label}
    </span>
  );
}

export function Overview() {
  const [, setLocation] = useLocation();
  const summary = useDashboardSummary();
  const programmes = useProgrammes();
  const workspace = useWorkspace();
  const data = summary.data;
  const role = getSessionUser()?.role;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const isTrainer = role === 'trainer';
  const isLearner = role === 'learner';
  const loading = summary.isLoading || programmes.isLoading || workspace.isLoading;

  if (isTrainer) return <TrainerOverview />;
  if (isLearner) return <LearnerOverview />;

  return <div className="page-in">
    <PageHeading
      eyebrow={isOwnerOrAdmin ? 'Manager overview' : 'Overview'}
      title="Readiness, at a glance."
      detail={`A live view of competence across ${workspace.data?.organization.name || 'your workspace'}.`}
      action={<div className="flex items-center gap-2"><Button variant="outline" size="sm"><Download className="size-3.5" />Export brief</Button><Button size="sm" onClick={() => setLocation('/assessments')}><Plus className="size-3.5" />Run assessment</Button></div>}
    />
    {loading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    : summary.isError ? <ErrorState retry={() => summary.refetch()} />
    : <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Compliance health" value={pct(data?.complianceHealth)} detail="Across active programmes" icon={ShieldCheck} tone="good" />
        <KpiCard label="Competence met" value={pct(data?.competencyRate)} detail={`${data?.completionRate ?? 0}% completion rate`} icon={Target} tone="accent" />
        <KpiCard label="At-risk learners" value={`${data?.dropOffRate ?? 0}%`} detail="Require intervention" icon={Activity} tone="warn" />
        <KpiCard label="Time to competency" value={`${data?.timeToCompetency ?? 0}d`} detail={`${data?.trainerUtilization ?? 0}% trainer utilization`} icon={Clock3} />
        <KpiCard label="Credentials expiring" value={`${data?.expiringCredentials ?? 0}`} detail="Within the next 30 days" icon={Zap} tone={data && data.expiringCredentials > 0 ? 'warn' : undefined} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_.9fr]">
        <section className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Learning activity</p><h2 className="mt-1 text-base font-bold tracking-[-.025em]">Momentum this week</h2></div><button className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Activity options"><SlidersHorizontal className="size-3.5" /></button></div>
          <div className="mt-5 flex h-40 items-end gap-2 sm:gap-3">{(data?.weeklyActivity || []).map((point) => <div key={point.label} className="flex flex-1 flex-col items-center gap-1.5"><div className="flex h-32 w-full items-end justify-center gap-1">{[point.active, point.completed].map((v, index) => <div key={index} className={cn('w-1/2 max-w-7 rounded-t-sm transition-all duration-700', index === 0 ? 'bg-primary/25' : 'bg-primary')} style={{ height: `${Math.max(8, v)}%` }} title={`${v} ${index ? 'completed' : 'active'}`} />)}</div><span className="font-mono text-[10px] text-muted-foreground">{point.label}</span></div>)}</div>
          <div className="mt-3 flex gap-4 border-t border-border/70 pt-2.5 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-primary/25" />Active learning</span><span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-primary" />Completed</span></div>
        </section>
        <section className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Programme pulse</p><h2 className="mt-1 text-base font-bold tracking-[-.025em]">Active programmes</h2></div><Link href="/learning" className="text-xs font-semibold text-primary hover:underline">View all</Link></div>
          <div className="mt-4 space-y-3">{programmes.data?.length ? programmes.data.slice(0, 4).map((programme) => <div key={programme.id}><div className="mb-1.5 flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{programme.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{programme.learnerCount} learners · {programme.courseCount} courses</p></div><span className="font-mono text-xs font-medium">{pct(programme.progress)}</span></div><ProgressLine value={programme.progress} color={programme.progress > 70 ? 'bg-emerald-600' : 'bg-primary'} /></div>) : <EmptyState title="No programmes yet" detail="Create your first programme to see readiness here." />}</div>
        </section>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[.9fr_1.45fr]">
        <section className="rounded-lg border border-border/80 bg-primary p-4 text-primary-foreground">
          <div className="flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Readiness signal</p><Activity className="size-3.5 text-primary-foreground/50" /></div>
          <div className="mt-5 grid grid-cols-2 gap-4"><div><p className="text-3xl font-extrabold tracking-[-.06em]">{pct(data?.dropOffRate)}</p><p className="mt-1 text-xs text-primary-foreground/65">drop-off rate</p></div><div><p className="text-3xl font-extrabold tracking-[-.06em]">{pct(data?.trainerUtilization)}</p><p className="mt-1 text-xs text-primary-foreground/65">trainer utilized</p></div></div>
          <div className="mt-6 border-t border-primary-foreground/15 pt-2.5 text-xs text-primary-foreground/65">The fastest lever this week is reducing assessment drop-off.</div>
        </section>
        <section className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Governance queue</p><h2 className="mt-1 text-base font-bold">Expiring credentials</h2></div><Link href="/learning" className="text-xs font-semibold text-primary">Review queue <ArrowUpRight className="ml-1 inline size-3.5" /></Link></div>
          <div className="mt-3 divide-y divide-border/70">{data?.expiringItems?.length ? data.expiringItems.slice(0, 3).map((item, index) => <div className="flex items-center gap-2.5 py-2.5" key={`${item.name}-${index}`}><div className="grid size-7 place-items-center rounded-md bg-amber-50 text-amber-700"><Clock3 className="size-3.5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.course}</p></div><div className="text-right"><Status tone={item.status === 'expired' ? 'bad' : 'warn'}>{item.status}</Status><p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(item.expires)}</p></div></div>) : <EmptyState title="Nothing expiring" detail="All credentials are current." />}</div>
        </section>
      </div>
    </>}
  </div>;
}

function TrainerOverview() {
  const sessions = useSessions();
  const workspace = useWorkspace();
  const summary = useDashboardSummary();
  const data = summary.data;
  return <div className="page-in">
    <PageHeading eyebrow="Trainer dashboard" title="Your sessions, your learners." detail={`Coaching view across ${workspace.data?.organization.name || 'your workspace'}.`} />
    {summary.isLoading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    : summary.isError ? <ErrorState retry={() => summary.refetch()} />
    : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Trainer utilization" value={pct(data?.trainerUtilization)} detail="Across all trainers" icon={Users} tone="accent" />
      <KpiCard label="Time to competency" value={`${data?.timeToCompetency ?? 0}d`} detail="Average across learners" icon={Clock3} />
      <KpiCard label="At-risk learners" value={`${data?.dropOffRate ?? 0}%`} detail="Need attention" icon={Activity} tone="warn" />
      <KpiCard label="Sessions scheduled" value={`${sessions.data?.length ?? 0}`} detail="Upcoming sessions" icon={CalendarDays} />
    </div>}
    <section className="mt-4 rounded-lg border border-border/80 bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Upcoming sessions</p>
      <h2 className="mt-1 text-base font-bold">Your schedule</h2>
      <div className="mt-3 space-y-2">
        {(sessions.data || []).slice(0, 5).map((s) => <div key={s.id} className="flex items-center gap-3 rounded-md bg-secondary/55 p-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary"><CalendarDays className="size-3.5" /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{s.title}</p><p className="text-xs text-muted-foreground">{fmtDate(s.date)} · {s.time} · {s.attendees} attendees</p></div>
          <Status tone={s.status === 'confirmed' ? 'good' : 'neutral'}>{s.status}</Status>
        </div>)}
        {!sessions.data?.length && <EmptyState title="No sessions scheduled" detail="Book sessions from the calendar." />}
      </div>
    </section>
  </div>;
}

function LearnerOverview() {
  const courses = useCourses();
  const certs = useCertificates();
  const summary = useDashboardSummary();
  return <div className="page-in">
    <PageHeading eyebrow="My learning" title="Your progress, in order." detail="Active courses and earned credentials." />
    {summary.isLoading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    : summary.isError ? <ErrorState retry={() => summary.refetch()} />
    : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Enrolled courses" value={`${(courses.data || []).length}`} detail="Active assignments" icon={BookOpen} />
      <KpiCard label="Completion rate" value={pct(summary.data?.completionRate)} detail="Courses finished" icon={Target} tone="good" />
      <KpiCard label="Competence" value={pct(summary.data?.competencyRate)} detail="Evidence-backed" icon={ShieldCheck} tone="accent" />
      <KpiCard label="Certificates" value={`${certs.data?.length ?? 0}`} detail="Earned" icon={Zap} />
    </div>}
    <section className="mt-4 rounded-lg border border-border/80 bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Active path</p>
      <h2 className="mt-1 text-base font-bold">Up next</h2>
      <div className="mt-3 space-y-2">
        {(courses.data || []).filter((c) => c.status !== 'archived').slice(0, 4).map((c) => <div key={c.id} className="rounded-md border border-border/70 p-3">
          <div className="flex justify-between gap-3"><p className="truncate text-sm font-semibold">{c.title}</p><span className="font-mono text-xs">{pct(c.progress)}</span></div>
          <p className="mt-0.5 text-xs text-muted-foreground">{c.programmeName} · due {fmtDate(c.dueDate)}</p>
          <div className="mt-2"><ProgressLine value={c.progress} /></div>
        </div>)}
        {!(courses.data || []).filter((c) => c.status !== 'archived').length && <EmptyState title="Nothing assigned" detail="New courses will appear here." />}
      </div>
    </section>
  </div>;
}
