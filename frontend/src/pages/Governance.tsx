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
  useAuditLogs, useDeleteRequests, useDecideDeletion,
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
const RBAC = [
  { action: 'View programmes', admin: true, manager: true, trainer: true, learner: true },
  { action: 'Create courses', admin: true, manager: true, trainer: false, learner: false },
  { action: 'Submit assessments', admin: true, manager: true, trainer: true, learner: false },
  { action: 'Manage bookings', admin: true, manager: true, trainer: true, learner: false },
  { action: 'Edit review-credit', admin: true, manager: false, trainer: false, learner: false },
  { action: 'View audit logs', admin: true, manager: false, trainer: false, learner: false },
];

export function Governance() {
  const logs = useAuditLogs();
  const requests = useDeleteRequests();
  const decide = useDecideDeletion();
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs.data || [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trainhub360-audit.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return <div className="page-in">
    <PageHeading eyebrow="Governance" title="Trust, on record." detail="Who can do what, and everything that happened — audit-ready." action={<Button variant="outline" size="sm" onClick={exportLogs}><Download className="size-4" />Export trail</Button>} />
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card"><div className="border-b border-border/70 p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Access control</p><h2 className="mt-1 text-lg font-bold">RBAC matrix (static policy)</h2></div>
      <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="p-4">Capability</th><th className="p-4">Admin</th><th className="p-4">Manager</th><th className="p-4">Trainer</th><th className="p-4">Learner</th></tr></thead><tbody className="divide-y divide-border/70">{RBAC.map((r) => <tr key={r.action}><td className="p-4 font-semibold">{r.action}</td>{[r.admin, r.manager, r.trainer, r.learner].map((v, i) => <td key={i} className="p-4">{v ? <Check className="size-4 text-emerald-600" /> : <span className="text-muted-foreground">—</span>}</td>)}</tr>)}</tbody></table>
    </section>
    <section className="mt-5 overflow-hidden rounded-xl border border-border/80 bg-card"><div className="border-b border-border/70 p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Two-person approval</p><h2 className="mt-1 text-lg font-bold">Delete requests</h2><p className="mt-1 text-xs text-muted-foreground">Programme deletions need a second admin — the requester cannot approve their own request. Approval archives the programme and its courses (reversible, nothing is hard-deleted).</p></div>
      {requests.isLoading ? <div className="space-y-2 p-5"><Skeleton className="h-12" /></div>
      : requests.isError ? <div className="p-5"><ErrorState retry={() => requests.refetch()} /></div>
      : !(requests.data || []).filter((r) => r.status === 'pending').length ? <div className="p-5"><EmptyState title="No pending requests" detail="Deletion requests from programme admins will queue here." /></div>
      : <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="p-4">Target</th><th className="p-4">Requested by</th><th className="p-4">Reason</th><th className="p-4">Decision</th></tr></thead><tbody className="divide-y divide-border/70">{(requests.data || []).filter((r) => r.status === 'pending').map((r) => <tr key={r.id}><td className="p-4 font-semibold">{r.targetName ?? r.targetId}<p className="text-xs font-normal text-muted-foreground">{r.targetType}</p></td><td className="p-4">{r.requester?.name ?? '—'}</td><td className="p-4 text-muted-foreground">{r.reason ?? '—'}</td><td className="p-4"><div className="flex gap-2"><Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'approve' })}>Approve</Button><Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'reject' })}>Reject</Button></div></td></tr>)}</tbody></table>}
    </section>
    <section className="mt-5 overflow-hidden rounded-xl border border-border/80 bg-card"><div className="border-b border-border/70 p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Audit trail</p><h2 className="mt-1 text-lg font-bold">Live from /audit/logs</h2></div>
      {logs.isLoading ? <div className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      : logs.isError ? <div className="p-5"><ErrorState retry={() => logs.refetch()} /></div>
      : !logs.data?.length ? <div className="p-5"><EmptyState title="No audit events" detail="Admin actions will be recorded here." /></div>
      : <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="p-4">Action</th><th className="p-4">Entity</th><th className="p-4">Timestamp</th></tr></thead><tbody className="divide-y divide-border/70">{logs.data.map((l) => <tr key={l.id}><td className="p-4 font-semibold">{l.action}</td><td className="p-4 text-muted-foreground">{l.entity}</td><td className="p-4 font-mono text-xs">{fmtDate(l.timestamp)}</td></tr>)}</tbody></table>}
    </section>
  </div>;
}



