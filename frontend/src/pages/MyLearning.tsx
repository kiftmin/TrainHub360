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
  useCertificates, useRecognitions,
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
export function MyLearning() {
  const courses = useCourses();
  const events = useCalendarEvents();
  const certs = useCertificates();
  const recognitions = useRecognitions();
  const active = (courses.data || []).filter((c) => c.status !== 'archived').slice(0, 4);
  const done = (courses.data || []).filter((c) => c.progress >= 100);
  return <div className="page-in">
    <PageHeading eyebrow="My learning" title="Your path, in order." detail="Active courses, upcoming schedule, and earned certificates." />
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Active path</p><h2 className="mt-1 text-base font-bold">Up next</h2>
        {courses.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : courses.isError ? <div className="mt-4"><ErrorState retry={() => courses.refetch()} /></div>
        : !active.length ? <div className="mt-4"><EmptyState title="Nothing assigned" detail="New courses will appear here." /></div>
        : <div className="mt-4 space-y-3">{active.map((c) => <div key={c.id} className="rounded-lg border border-border/70 p-4"><div className="flex justify-between gap-3"><p className="truncate text-sm font-semibold">{c.title}</p><span className="font-mono text-xs">{pct(c.progress)}</span></div><p className="mt-1 text-xs text-muted-foreground">{c.programmeName} · due {fmtDate(c.dueDate)}</p><div className="mt-3"><ProgressLine value={c.progress} /></div></div>)}</div>}
      </section>
      <div className="space-y-5">
        <section className="rounded-lg border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Schedule</p><h2 className="mt-1 text-base font-bold">Coming up</h2>
          {events.isLoading ? <div className="mt-4"><Skeleton className="h-24" /></div>
          : events.isError ? <div className="mt-4"><ErrorState retry={() => events.refetch()} /></div>
          : <div className="mt-4 space-y-2">{(events.data || []).slice(0, 4).map((e) => <div key={e.id} className="flex items-center gap-3 rounded-lg bg-secondary/55 p-3"><div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{e.title}</p><p className="text-xs text-muted-foreground">{fmtDate(e.date)} · {e.time}</p></div></div>)}
          {!events.data?.length && <EmptyState title="No sessions scheduled" detail="Book coaching from the calendar." />}</div>}
        </section>
        <section className="rounded-lg border border-border/80 bg-primary p-5 text-primary-foreground"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Certificates</p><h2 className="mt-1 text-base font-bold">{certs.data?.length ?? done.length} earned</h2><p className="mt-1 text-xs text-primary-foreground/65">Completed courses issue a verifiable certificate.</p>
          {recognitions.data && recognitions.data.length > 0 && <div className="mt-3 space-y-2">{recognitions.data.slice(0, 3).map((r) => <div key={r.id} className="rounded-lg bg-accent/20 p-2.5 text-xs"><p className="font-semibold">★ {r.type.replace(/_/g, ' ')}</p><p className="opacity-70">{fmtDate(r.awardedAt)}</p></div>)}</div>}
          {certs.data && certs.data.length > 0 && <div className="mt-3 space-y-2">{certs.data.slice(0, 4).map((c) => <div key={c.id} className="rounded-lg bg-primary-foreground/10 p-2.5 text-xs"><p className="font-semibold">{c.course?.title ?? 'Course'}</p><p className="opacity-70">Issued {fmtDate(c.issuedAt)}{c.expiresAt ? ` · expires ${fmtDate(c.expiresAt)}` : ''} · {c.status}</p></div>)}</div>}
        </section>
      </div>
    </div>
  </div>;
}



