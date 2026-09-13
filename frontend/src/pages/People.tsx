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
export function People() {
  const enrolments = useEnrolments();
  const programmes = useProgrammes();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const rows = useMemo(() => {
    const map = new Map<string, { learnerId: string; courses: number; completed: number }>();
    for (const e of enrolments.data || []) {
      const row = map.get(e.learnerId) || { learnerId: e.learnerId, courses: 0, completed: 0 };
      row.courses += 1;
      if (e.status === 'completed') row.completed += 1;
      map.set(e.learnerId, row);
    }
    return [...map.values()].slice(0, 12);
  }, [enrolments.data]);
  return <div className="page-in">
    <PageHeading eyebrow="People" title="Everyone moving forward." detail="Membership, progress, and accountability across the workspace." action={<div className="flex items-center gap-2"><BulkImportButton /><Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogTrigger asChild><Button><Plus className="size-4" />Invite learner</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Invite a learner</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Email address<Input className="mt-2" placeholder="learner@company.com" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} /></label><Button className="w-full" onClick={() => setInviteOpen(false)}>Send invite (visual only)</Button><p className="text-xs text-muted-foreground">Invites are visual-only in this build and post nothing.</p></div></DialogContent></Dialog></div>} />
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard label="Learners" value={`${programmes.data?.reduce((a, p) => a + p.learnerCount, 0) ?? 0}`} detail="Across all programmes" icon={Users} />
      <KpiCard label="Enrolments" value={`${enrolments.data?.length ?? 0}`} detail="Tracked course enrolments" icon={BookOpen} />
      <KpiCard label="Programmes" value={`${programmes.data?.length ?? 0}`} detail="Active portfolio" icon={GraduationCap} tone="accent" />
    </div>
    <section className="mt-5 overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="border-b border-border/70 p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Directory</p><h2 className="mt-1 text-lg font-bold">Learners by enrolment</h2></div>
      {enrolments.isLoading ? <div className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      : enrolments.isError ? <div className="p-5"><ErrorState retry={() => enrolments.refetch()} /></div>
      : !rows.length ? <div className="p-5"><EmptyState title="No learners yet" detail="Enrolments will build this directory automatically." /></div>
      : <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="p-4">Learner</th><th className="p-4">Enrolments</th><th className="p-4">Completed</th><th className="p-4">Role</th></tr></thead><tbody className="divide-y divide-border/70">{rows.map((r) => <tr key={r.learnerId}><td className="p-4 font-semibold">{r.learnerId}</td><td className="p-4">{r.courses}</td><td className="p-4">{r.completed}</td><td className="p-4"><Status tone="good">learner</Status></td></tr>)}</tbody></table>}
    </section>
  </div>;
}


