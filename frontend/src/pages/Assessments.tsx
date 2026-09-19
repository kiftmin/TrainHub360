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
export function Assessments() {
  const courses = useCourses();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: Course | null = courses.data?.find((c) => c.id === selectedId) || null;
  const submit = useSubmitAttempt(selected?.id || '');
  const [applied, setApplied] = useState('');
  const [recall, setRecall] = useState('');
  const [result, setResult] = useState<{ passed: boolean; competenceMet: boolean; message: string } | null>(null);
  const send = () => {
    if (!selected) return;
    submit.mutate({ appliedScore: Number(applied), recallScore: Number(recall) }, { onSuccess: (data) => setResult(data) });
  };
  return <div className="page-in">
    <PageHeading eyebrow="Competence assurance" title="Assessments with evidence." detail="A passing completion is not the same as competence. Keep both signals visible." />
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5">
        <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Assessment queue</p><h2 className="mt-1 text-base font-bold">Courses ready for review</h2></div><Status tone="warn">{courses.data?.length || 0} courses</Status></div>
        {courses.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        : courses.isError ? <div className="mt-4"><ErrorState retry={() => courses.refetch()} /></div>
        : <div className="mt-4 space-y-2">{courses.data?.map((course) => <button key={course.id} onClick={() => { setSelectedId(course.id); setResult(null); }} className={cn('w-full rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/35', selected?.id === course.id ? 'border-primary/50 bg-primary/5' : 'border-border/70')}><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-accent/25 text-primary"><Target className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{course.title}</p><p className="mt-1 text-xs text-muted-foreground">{course.programmeName} · threshold {course.appliedThreshold}%</p></div><div className="text-right"><p className="font-mono text-xs">{course.appliedScore == null ? '—' : `${course.appliedScore}%`}</p><p className="mt-1 text-[10px] text-muted-foreground">applied score</p></div></div></button>)}</div>}
        {!courses.data?.length && !courses.isLoading && !courses.isError && <div className="mt-4"><EmptyState title="Assessment queue is clear" detail="New courses will appear here when ready for evidence." /></div>}
      </section>
      <section className="rounded-lg border border-primary/20 bg-primary p-5 text-primary-foreground">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Submission panel</p>
        <h2 className="mt-1 text-base font-bold">{selected ? selected.title : 'Select a course'}</h2>
        {selected ? <>
          <p className="mt-1 text-xs text-primary-foreground/65">Threshold {selected.appliedThreshold}% · {selected.programmeName}</p>
          <div className="mt-5 space-y-3"><label className="text-xs font-semibold">Applied score (0–100)<Input className="mt-2 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/40" type="number" value={applied} onChange={(e) => setApplied(e.target.value)} placeholder="e.g. 82" /></label><label className="text-xs font-semibold">Recall score (0–100)<Input className="mt-2 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/40" type="number" value={recall} onChange={(e) => setRecall(e.target.value)} placeholder="e.g. 90" /></label></div>
          <Button variant="secondary" className="mt-5 w-full" disabled={submit.isPending || !applied || !recall} onClick={send}><Send className="size-4" />{submit.isPending ? 'Submitting…' : 'Submit evidence'}</Button>
          {submit.isError && <p className="mt-3 text-xs text-primary-foreground/80">Submission failed. Check the backend and retry.</p>}
          {result && <div className="mt-4 rounded-lg bg-primary-foreground/10 p-4 text-sm"><p className="font-bold">{result.passed ? 'Passed' : 'Not passed'} · {result.competenceMet ? 'competence met' : 'competence not met'}</p><p className="mt-1 text-xs text-primary-foreground/70">{result.message}</p></div>}
        </> : <p className="mt-3 text-sm text-primary-foreground/70">Choose a course from the queue to submit applied + recall evidence.</p>}
      </section>
    </div>
  </div>;
}


