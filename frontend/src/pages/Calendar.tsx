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
export function CalendarPage() {
  const sessions = useSessions();
  const bookings = useBookings();
  const events = useCalendarEvents();
  const create = useCreateBooking();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ trainer: '', course: '', date: '', time: '' });
  const book = () => {
    if (!form.trainer || !form.date || !form.time) return;
    create.mutate({ trainer: form.trainer, course: form.course, date: form.date, time: form.time }, { onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); setOpen(false); setForm({ trainer: '', course: '', date: '', time: '' }); } });
  };
  const loading = sessions.isLoading || bookings.isLoading || events.isLoading;
  const failed = sessions.isError || bookings.isError || events.isError;
  return <div className="page-in">
    <PageHeading eyebrow="Schedule & support" title="Make the next step easy." detail="One operational view for live training, online sessions, and focused 1:1 support." action={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="size-4" />Book 1:1</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Book a 1:1 session</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><Input placeholder="Trainer name" value={form.trainer} onChange={(e) => setForm({ ...form, trainer: e.target.value })} /><Input placeholder="Course (optional)" value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} /><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /><Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /><Button className="w-full" onClick={book} disabled={create.isPending}>{create.isPending ? 'Booking…' : 'Confirm booking'}</Button></div></DialogContent></Dialog>} />
    {loading ? <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
    : failed ? <ErrorState retry={() => { sessions.refetch(); bookings.refetch(); events.refetch(); }} />
    : <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-xl border border-border/80 bg-card p-5"><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Unified calendar</p><h2 className="mt-1 text-lg font-bold">Upcoming moments</h2></div><Status>{(events.data?.length || 0) + (sessions.data?.length || 0)} upcoming</Status></div>
        <div className="mt-5 space-y-3">
          {(events.data || []).slice(0, 5).map((event) => <div key={event.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3"><div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{event.title}</p><p className="text-xs text-muted-foreground">{fmtDate(event.date)} · {event.time} · {event.type}</p></div></div>)}
          {(sessions.data || []).slice(0, 3).map((s) => <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3"><div className="grid size-9 place-items-center rounded-lg bg-accent/25 text-primary"><Users className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{s.title}</p><p className="text-xs text-muted-foreground">{s.programme} · {fmtDate(s.date)} · {s.time} · {s.attendees} attending</p></div><Status tone="good">{s.status}</Status></div>)}
          {!(events.data?.length || sessions.data?.length) && <EmptyState title="Calendar is clear" detail="Upcoming sessions will appear here." />}
        </div>
      </section>
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Booked coaching</p><h2 className="mt-1 text-lg font-bold">{bookings.data?.length || 0} sessions</h2>
        <div className="mt-4 space-y-2">{(bookings.data || []).slice(0, 5).map((b) => <div key={b.id} className="rounded-lg bg-secondary/55 p-3"><p className="text-sm font-semibold">{b.trainer}</p><p className="text-xs text-muted-foreground">{b.course} · {fmtDate(b.date)} · {b.time}</p></div>)}
        {!bookings.data?.length && <EmptyState title="No 1:1s booked" detail="Book focused support with a trainer." />}</div>
      </section>
    </div>}
  </div>;
}


