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
export function Messages() {
  const threads = useThreads();
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const active = threads.data?.find((thread) => thread.id === selected) || threads.data?.[0];
  const activeId = active?.id || '';
  const messages = useThreadMessages(activeId, !!activeId);
  const send = useSendMessage(activeId);
  const sendMessage = () => {
    if (!body.trim() || !activeId) return;
    send.mutate({ body: body.trim(), urgent }, { onSuccess: () => { setBody(''); setUrgent(false); } });
  };
  return <div className="page-in">
    <PageHeading eyebrow="Workspace communication" title="Keep the context close." detail="Threaded conversations tied to programmes and courses, with urgency where it matters." />
    {threads.isLoading ? <Skeleton className="h-[590px]" />
    : threads.isError ? <ErrorState retry={() => threads.refetch()} />
    : <div className="grid min-h-[590px] overflow-hidden rounded-xl border border-border/80 bg-card lg:grid-cols-[340px_1fr]">
      <section className="border-b border-border/80 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-border/70 p-4"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Inbox</p><p className="mt-1 text-sm font-bold">{threads.data?.filter((t) => t.unread).length || 0} unread threads</p></div><button className="rounded-md p-2 text-muted-foreground hover:bg-secondary" aria-label="Thread options"><MoreHorizontal className="size-4" /></button></div>
        <div className="divide-y divide-border/70">{threads.data?.map((thread) => <button onClick={() => setSelected(thread.id)} key={thread.id} className={cn('w-full p-4 text-left transition-colors hover:bg-secondary/40', active?.id === thread.id && 'bg-primary/5')}><div className="flex items-start gap-3"><div className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-bold', thread.urgent ? 'bg-amber-100 text-amber-800' : 'bg-secondary text-primary')}>{initials(thread.participant)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{thread.subject}</p>{thread.urgent && <span className="size-1.5 rounded-full bg-amber-500" />}</div><p className="mt-1 truncate text-xs text-muted-foreground">{thread.preview}</p><p className="mt-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{thread.context}</p></div>{thread.unread && <span className="mt-1 size-1.5 rounded-full bg-primary" />}</div></button>)}</div>
        {!threads.data?.length && <div className="p-4"><EmptyState title="Inbox zero" detail="New threads will land here." /></div>}
      </section>
      <section className="flex flex-col">
        {active ? <>
          <div className="border-b border-border/70 p-4"><div className="flex items-center gap-2"><p className="font-bold">{active.subject}</p>{active.urgent && <Status tone="warn">urgent</Status>}</div><p className="mt-1 text-xs text-muted-foreground">{active.participant} · {active.context}</p></div>
          <div className="flex-1 space-y-3 p-4">
            {messages.isLoading ? <><Skeleton className="h-16" /><Skeleton className="h-16" /></>
            : messages.isError ? <ErrorState retry={() => messages.refetch()} />
            : !(messages.data?.length) ? <EmptyState title="No messages yet" detail="Start the conversation below." />
            : messages.data.map((m) => <div key={m.id} className="rounded-lg border border-border/70 bg-secondary/40 p-3"><div className="flex items-center gap-2 text-xs"><span className="font-bold">{m.author}</span>{m.urgent && <Status tone="warn">urgent</Status>}<span className="ml-auto text-muted-foreground">{fmtDate(m.createdAt)}</span></div><p className="mt-2 text-sm">{m.body}</p></div>)}
          </div>
          <div className="border-t border-border/70 p-4"><div className="flex items-center gap-2"><Textarea placeholder="Write a reply…" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-11" /><Button onClick={sendMessage} disabled={send.isPending || !body.trim()}><Send className="size-4" /></Button></div><label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Mark as urgent</label></div>
        </> : <div className="p-8"><EmptyState title="Select a thread" detail="Choose a conversation from the inbox." /></div>}
      </section>
    </div>}
  </div>;
}


