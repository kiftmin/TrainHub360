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
import { SessionRosterPanel, canManageSessionRoster } from '@/components/SessionRosterPanel';
import {
  useWorkspace,
  useDashboardSummary,
  useKpiSummary,
  useProgrammes,
  useCourses,
  useCreateCourse,
  useModules,
  useSessions,
  useCreateSession,
  useRsvpSession,
  useGenerateIcalToken,
  useThreads,
  useThreadMessages,
  useSendMessage,
  useBookings,
  useCreateBooking,
  useBookableTrainers,
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
  const programmes = useProgrammes();
  const bookings = useBookings();
  const events = useCalendarEvents();
  const trainers = useBookableTrainers();
  const courses = useCourses();
  const create = useCreateBooking();
  const createSession = useCreateSession();
  const rsvp = useRsvpSession();
  const generateIcal = useGenerateIcalToken();
  const qc = useQueryClient();
  const canManageRoster = canManageSessionRoster(getSessionUser());
  const [rosterSessionId, setRosterSessionId] = useState('');
  const [open, setOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState({ title: '', programmeId: '', date: '', time: '', mode: 'online' as 'online' | 'offline', joinUrl: '', location: '', capacity: '', endsAt: '' });
  const [sessionError, setSessionError] = useState<string | null>(null);
  const scheduleSession = () => {
    if (!sessionForm.title || !sessionForm.date || !sessionForm.time) { setSessionError('Title, date and time are required.'); return; }
    if (sessionForm.mode === 'online' && !/^https:\/\//i.test(sessionForm.joinUrl)) { setSessionError('Online sessions need an https join URL.'); return; }
    setSessionError(null);
    createSession.mutate({
      title: sessionForm.title, programmeId: sessionForm.programmeId || undefined,
      date: sessionForm.date, time: sessionForm.time,
      startsAt: new Date(`${sessionForm.date}T${sessionForm.time}`).toISOString(),
      endsAt: sessionForm.endsAt ? new Date(sessionForm.endsAt).toISOString() : undefined,
      mode: sessionForm.mode, joinUrl: sessionForm.joinUrl || undefined, location: sessionForm.location || undefined,
      capacity: sessionForm.capacity ? Number(sessionForm.capacity) : null,
    }, {
      onSuccess: () => { setSessionOpen(false); setSessionForm({ title: '', programmeId: '', date: '', time: '', mode: 'online', joinUrl: '', location: '', capacity: '', endsAt: '' }); },
      onError: (e) => setSessionError((e as Error).message),
    });
  };
  const addToCalendar = async () => {
    // Round 8 / D.2: the server only keeps a hash of the feed token, so every subscription
    // starts by rotating it. The previous subscription stops working.
    const meId = getSessionUser()?.id;
    if (!meId) return;
    generateIcal.mutate(meId, { onSuccess: (data) => { window.location.href = data.url; } });
  };
  // Round 8 / B.1: a booking points at a trainer and course by id, so the booking cannot drift
  // to a different person when someone is renamed.
  const [form, setForm] = useState({ trainerId: '', courseId: '', date: '', time: '' });
  const [bookingError, setBookingError] = useState<string | null>(null);
  const book = () => {
    setBookingError(null);
    if (!form.trainerId || !form.date || !form.time) { setBookingError('Pick a trainer, date and time.'); return; }
    create.mutate({ trainerId: form.trainerId, courseId: form.courseId || undefined, date: form.date, time: form.time }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); setOpen(false); setForm({ trainerId: '', courseId: '', date: '', time: '' }); },
      onError: (e) => setBookingError((e as Error).message),
    });
  };
  const loading = sessions.isLoading || bookings.isLoading || events.isLoading;
  const failed = sessions.isError || bookings.isError || events.isError;
  return <div className="page-in">
    <PageHeading eyebrow="Schedule & support" title="Make the next step easy." detail="One operational view for live training, online sessions, and focused 1:1 support." action={<><Button variant="outline" onClick={() => setSessionOpen(true)}><CalendarDays className="size-4" />Schedule session</Button><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="size-4" />Book 1:1</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Book a 1:1 session</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Trainer<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={form.trainerId} onChange={(e) => setForm({ ...form, trainerId: e.target.value })} data-testid="select-booking-trainer"><option value="">Select a trainer</option>{(trainers.data || []).map((t) => <option key={t.id} value={t.id}>{t.name} - {t.email}</option>)}</select>{!trainers.isLoading && !(trainers.data || []).length && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">No trainer is available in your programmes yet.</span>}</label><label className="block text-xs font-semibold">Course (optional)<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} data-testid="select-booking-course"><option value="">No specific course</option>{(courses.data || []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label className="block text-xs font-semibold">Date<Input className="mt-2" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label className="block text-xs font-semibold">Time<Input className="mt-2" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>{bookingError && <p className="text-xs text-destructive">{bookingError}</p>}<Button className="w-full" onClick={book} disabled={create.isPending}>{create.isPending ? 'Booking-' : 'Confirm booking'}</Button></div></DialogContent></Dialog></>} />
    <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule a session</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <label className="block text-xs font-semibold">Title<Input className="mt-2" value={sessionForm.title} onChange={(e) => setSessionForm({ ...sessionForm, title: e.target.value })} data-testid="input-session-title" /></label>
          <label className="block text-xs font-semibold">Programme (optional)<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={sessionForm.programmeId} onChange={(e) => setSessionForm({ ...sessionForm, programmeId: e.target.value })}>
            <option value="">Organization-wide</option>
            {(programmes.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold">Date<Input className="mt-2" type="date" value={sessionForm.date} onChange={(e) => setSessionForm({ ...sessionForm, date: e.target.value })} data-testid="input-session-date" /></label>
            <label className="block text-xs font-semibold">Time<Input className="mt-2" type="time" value={sessionForm.time} onChange={(e) => setSessionForm({ ...sessionForm, time: e.target.value })} data-testid="input-session-time" /></label>
          </div>
          <label className="block text-xs font-semibold">Ends at (optional)<Input className="mt-2" type="datetime-local" value={sessionForm.endsAt} onChange={(e) => setSessionForm({ ...sessionForm, endsAt: e.target.value })} /></label>
          <label className="block text-xs font-semibold">Mode<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={sessionForm.mode} onChange={(e) => setSessionForm({ ...sessionForm, mode: e.target.value as 'online' | 'offline' })} data-testid="select-session-mode">
            <option value="online">Online</option><option value="offline">In person</option>
          </select></label>
          {sessionForm.mode === 'online'
            ? <label className="block text-xs font-semibold">Join URL (https)<Input className="mt-2" value={sessionForm.joinUrl} onChange={(e) => setSessionForm({ ...sessionForm, joinUrl: e.target.value })} data-testid="input-session-join-url" /></label>
            : <label className="block text-xs font-semibold">Location<Input className="mt-2" value={sessionForm.location} onChange={(e) => setSessionForm({ ...sessionForm, location: e.target.value })} data-testid="input-session-location" /></label>}
          <label className="block text-xs font-semibold">Capacity (optional)<Input className="mt-2" type="number" min="1" value={sessionForm.capacity} onChange={(e) => setSessionForm({ ...sessionForm, capacity: e.target.value })} /></label>
          {sessionError && <p className="text-xs text-destructive">{sessionError}</p>}
          <Button className="w-full" disabled={createSession.isPending} onClick={scheduleSession} data-testid="button-create-session">{createSession.isPending ? 'Scheduling-' : 'Schedule session'}</Button>
        </div>
      </DialogContent>
    </Dialog>
    {loading ? <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
    : failed ? <ErrorState retry={() => { sessions.refetch(); bookings.refetch(); events.refetch(); }} />
    : <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5"><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Unified calendar</p><h2 className="mt-1 text-base font-bold">Upcoming moments</h2></div><Status>{(events.data?.length || 0) + (sessions.data?.length || 0)} upcoming</Status></div>
        <div className="mt-5 space-y-3">
          {(events.data || []).slice(0, 5).map((event) => <div key={event.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3"><div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{event.title}</p><p className="text-xs text-muted-foreground">{fmtDate(event.date)} - {event.time} - {event.type}</p></div></div>)}
          {(sessions.data || []).slice(0, 3).map((s) => <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3"><div className="grid size-9 place-items-center rounded-lg bg-accent/25 text-primary"><Users className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{s.title}</p><p className="text-xs text-muted-foreground">{s.programme} - {fmtDate(s.date)} - {s.time} - {s.attendees} attending</p></div><div className="flex shrink-0 items-center gap-2"><Status tone="good">{s.status}</Status><Button size="sm" variant="outline" onClick={() => rsvp.mutate({ sessionId: s.id, status: 'confirmed' })} disabled={rsvp.isPending}>RSVP</Button></div></div>)}
          {!(events.data?.length || sessions.data?.length) && <EmptyState title="Calendar is clear" detail="Upcoming sessions will appear here." />}
        </div>
      </section>
      <section className="rounded-lg border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Booked coaching</p><div className="flex items-center justify-between gap-2"><h2 className="mt-1 text-base font-bold">{bookings.data?.length || 0} sessions</h2><Button size="sm" variant="outline" onClick={addToCalendar} disabled={generateIcal.isPending} data-testid="button-ical-feed">{generateIcal.isPending ? 'Preparing-' : 'Subscribe (.ics)'}</Button></div>
        <div className="mt-4 space-y-2">{(bookings.data || []).slice(0, 5).map((b) => <div key={b.id} className="rounded-lg bg-secondary/55 p-3"><p className="text-sm font-semibold">{b.trainer}</p><p className="text-xs text-muted-foreground">{b.course} - {fmtDate(b.date)} - {b.time}</p></div>)}
        {!bookings.data?.length && <EmptyState title="No 1:1s booked" detail="Book focused support with a trainer." />}</div>
      </section>
    </div>}
    {canManageRoster && <section className="rounded-lg border border-border/80 bg-card p-5" data-testid="trainer-roster-tools">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Trainer tools</p><h2 className="mt-1 text-base font-bold">Manage a session roster</h2></div>
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={rosterSessionId} onChange={(event) => setRosterSessionId(event.target.value)} data-testid="select-roster-session">
          <option value="">Choose a session</option>
          {(sessions.data || []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {rosterSessionId && <SessionRosterPanel sessionId={rosterSessionId} sessionTitle={(sessions.data || []).find((s) => s.id === rosterSessionId)?.title || 'Session'} />}
    </section>}
  </div>;
}


