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
  downloadReviewCreditCsv,
  type Course,
  type ReviewCreditSettings,
} from '@/api/hooks';
import { getToken, clearSession } from '@/api/client';
import { Login } from '@/pages/Login';
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

function fmtDate(date?: string | null) {
  if (!date) return '—';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function pct(value?: number | null) { return `${Math.round(value ?? 0)}%`; }
function initials(name?: string) { return name?.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'TH'; }

function Skeleton({ className }: { className?: string }) { return <div className={cn('skeleton rounded-lg', className)} />; }
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/55 p-6 text-center">
    <div className="mb-3 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground"><FileCheck2 className="size-5" /></div>
    <p className="font-semibold text-foreground">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}
  </div>;
}
function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center">
    <CircleAlert className="mb-3 size-6 text-destructive" /><p className="font-semibold">Could not load this view</p><p className="mt-1 text-sm text-muted-foreground">The workspace service did not respond. Try again.</p>
    {retry && <Button variant="outline" size="sm" className="mt-4" onClick={retry}>Retry</Button>}
  </div>;
}
function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <Badge variant="outline" className={cn('font-mono text-[10px] uppercase tracking-[.12em]', tone === 'good' && 'border-emerald-600/25 bg-emerald-50 text-emerald-700', tone === 'warn' && 'border-amber-600/25 bg-amber-50 text-amber-700', tone === 'bad' && 'border-destructive/25 bg-destructive/5 text-destructive')}>{children}</Badge>;
}
function ProgressLine({ value, color = 'bg-primary' }: { value: number; color?: string }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}
function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[.22em] text-primary">{eyebrow}</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-foreground md:text-[2.45rem]">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p></div>{action}</div>;
}

function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspace = useWorkspace();
  const user = workspace.data?.user;
  const allNav = [...nav, ...adminNav];
  const active = allNav.find((n) => n.href === location) ?? (location.startsWith('/programmes') ? { href: '/programmes', label: 'Programmes' } : null);
  const go = (href: string) => { setMobileOpen(false); setLocation(href); };
  return <div className="grain app-shell min-h-[100dvh]">
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center justify-between px-2">
        <button onClick={() => go('/')} className="flex items-center gap-3 text-left">
          <div className="grid size-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><ShieldCheck className="size-5" /></div>
          <div><p className="text-[15px] font-extrabold tracking-[-.03em]">TrainHub<span className="text-sidebar-primary">360</span></p><p className="font-mono text-[9px] uppercase tracking-[.16em] text-sidebar-foreground/45">readiness OS</p></div>
        </button>
        <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="size-5" /></button>
      </div>
      <div className="mt-10 px-2"><p className="font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/40">Workspace</p>
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(workspace.data?.organization.name)}</div>
          <div className="min-w-0"><p className="truncate text-xs font-semibold">{workspace.data?.organization.name || 'Loading workspace'}</p><p className="font-mono text-[9px] text-sidebar-foreground/45">{workspace.data?.organization.plan || '—'} plan</p></div>
          <ChevronDown className="ml-auto size-3.5 text-sidebar-foreground/45" />
        </div>
        {workspace.data && workspace.data.dataSource !== 'mssql' && <p className="mt-2 rounded-md border border-sidebar-primary/20 bg-sidebar-primary/10 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-sidebar-primary">Demo workspace · SQL Server unavailable</p>}
      </div>
      <nav className="mt-8 space-y-1" aria-label="Main navigation">
        {nav.map(({ href, label, icon: Icon }) => <button key={href} onClick={() => go(href)} className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', (location === href || (href === '/programmes' && location.startsWith('/programmes'))) ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className="size-[17px]" /><span>{label}</span>{label === 'Messages' && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}</button>)}
      </nav>
      <div className="my-7 h-px bg-sidebar-border" />
      <p className="px-3 font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/40">Governance</p>
      <nav className="mt-2 space-y-1">
        {adminNav.map(({ href, label, icon: Icon }) => <button key={href} onClick={() => go(href)} className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className="size-[17px]" /><span>{label}</span></button>)}
      </nav>
      <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">{user?.initials || 'TH'}</div>
          <div className="min-w-0"><p className="truncate text-xs font-semibold">{user?.name || 'Workspace user'}</p><p className="truncate text-[10px] text-sidebar-foreground/45">{user?.role || 'Manager'}</p></div>
          <MoreHorizontal className="ml-auto size-4 text-sidebar-foreground/40" />
        </div>
        <button onClick={onLogout} className="mt-3 w-full rounded-md border border-sidebar-border px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent">Sign out</button>
      </div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-30 bg-sidebar/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    <div className="lg:pl-[244px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/70 bg-background/85 px-5 backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-3">
          <button className="rounded-md p-2 hover:bg-secondary lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><span>Operations</span><span className="text-border">/</span><span className="font-medium text-foreground">{active?.label || location.slice(1) || 'Overview'}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <button className="hidden rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex md:items-center md:gap-2"><Search className="size-3.5" />Search <kbd className="rounded border border-border px-1 font-mono text-[9px]">⌘ K</kbd></button>
          <button className="relative rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Notifications"><Bell className="size-[18px]" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" /></button>
          <div className="ml-1 grid size-8 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{user?.initials || 'TH'}</div>
        </div>
      </header>
      <main className="mx-auto max-w-[1480px] px-5 py-8 md:px-8">{children}</main>
    </div>
  </div>;
}

function KpiCard({ label, value, detail, icon: Icon, tone = 'primary' }: { label: string; value: string; detail: string; icon: typeof Gauge; tone?: 'primary' | 'accent' | 'good' | 'warn' }) {
  return <div className="group rounded-xl border border-border/80 bg-card p-4 shadow-[0_7px_24px_rgba(25,51,57,.035)] transition-transform duration-200 hover:-translate-y-0.5"><div className="flex items-start justify-between"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</p><div className={cn('grid size-8 place-items-center rounded-lg', tone === 'accent' ? 'bg-accent/20 text-foreground' : tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-primary/10 text-primary')}><Icon className="size-4" /></div></div><p className="mt-4 text-2xl font-extrabold tracking-[-.04em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function Overview() {
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

function Learning() {
  const programmes = useProgrammes();
  const courses = useCourses();
  const createCourse = useCreateCourse();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', programmeId: '', category: 'Core capability', appliedThreshold: '80' });
  const list = (courses.data || []).filter((course) => course.title.toLowerCase().includes(search.toLowerCase()) || course.programmeName.toLowerCase().includes(search.toLowerCase()));
  const submit = () => {
    if (!form.title || !form.programmeId) return;
    createCourse.mutate(
      { title: form.title, programmeId: form.programmeId, category: form.category, appliedThreshold: Number(form.appliedThreshold) },
      { onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); setOpen(false); setForm({ title: '', programmeId: '', category: 'Core capability', appliedThreshold: '80' }); } },
    );
  };
  return <div className="page-in">
    <PageHeading eyebrow="Learning operations" title="Learning that holds up." detail="Track programme movement, not just content consumption." action={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="size-4" />Add course</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Add a course to the workspace</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><Input placeholder="Course title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.programmeId} onChange={(e) => setForm({ ...form, programmeId: e.target.value })}><option value="">Select programme</option>{programmes.data?.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select><Input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><Input type="number" placeholder="Applied threshold" value={form.appliedThreshold} onChange={(e) => setForm({ ...form, appliedThreshold: e.target.value })} /><Button className="w-full" disabled={createCourse.isPending} onClick={submit}>{createCourse.isPending ? 'Adding course…' : 'Add course'}</Button></div></DialogContent></Dialog>} />
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="border-0 bg-secondary/60 pl-9 shadow-none focus-visible:ring-1" placeholder="Search courses or programmes" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Status>{programmes.data?.length || 0} programmes</Status><Status>{courses.data?.length || 0} courses</Status></div>
    </div>
    {programmes.isLoading || courses.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}</div>
    : programmes.isError || courses.isError ? <ErrorState retry={() => { programmes.refetch(); courses.refetch(); }} />
    : <>
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Programme portfolio</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(programmes.data || []).map((p) => <Link key={p.id} href={`/programmes/${p.id}`} className="rounded-xl border border-border/80 bg-card p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-start justify-between"><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status><span className="font-mono text-[10px] text-muted-foreground">{p.type}</span></div><p className="mt-3 text-base font-bold tracking-tight">{p.name}</p><p className="mt-1 text-xs text-muted-foreground">{p.learnerCount} learners · {p.courseCount} courses · {p.owner}</p><div className="mt-4"><ProgressLine value={p.progress} /></div><p className="mt-2 font-mono text-xs">{pct(p.progress)}</p></Link>)}
      </div>
      {!programmes.data?.length && <div className="mt-4"><EmptyState title="No programmes" detail="Programmes will appear here once created." /></div>}
      <h2 className="mb-3 mt-8 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Course catalogue</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => <div key={c.id} className="rounded-xl border border-border/80 bg-card p-5"><div className="flex items-center justify-between"><Status tone={c.status === 'published' ? 'good' : 'warn'}>{c.status}</Status><span className="text-[11px] text-muted-foreground">{c.category}</span></div><p className="mt-3 text-base font-bold">{c.title}</p><p className="mt-1 text-xs text-muted-foreground">{c.programmeName} · {c.trainer} · due {fmtDate(c.dueDate)}</p><div className="mt-4"><ProgressLine value={c.progress} /></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>Threshold {c.appliedThreshold}%</span><span>{c.appliedScore == null ? 'No score yet' : `${c.appliedScore}% applied`}</span></div></div>)}
      </div>
      {!list.length && <div className="mt-4"><EmptyState title="No courses match" detail="Try a different search or add a course." /></div>}
    </>}
  </div>;
}

function Programmes() {
  const programmes = useProgrammes();
  return <div className="page-in">
    <PageHeading eyebrow="Programme portfolio" title="Programmes with owners." detail="Every programme has movement, membership, and an accountable owner." />
    {programmes.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
    : programmes.isError ? <ErrorState retry={() => programmes.refetch()} />
    : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(programmes.data || []).map((p) => <Link key={p.id} href={`/programmes/${p.id}`} className="rounded-xl border border-border/80 bg-card p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><GraduationCap className="size-5" /></div><div className="min-w-0"><p className="truncate font-bold">{p.name}</p><p className="text-xs text-muted-foreground">{p.type} · {p.owner}</p></div><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{p.learnerCount}</p><p className="text-[10px] text-muted-foreground">learners</p></div><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{p.courseCount}</p><p className="text-[10px] text-muted-foreground">courses</p></div><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{pct(p.progress)}</p><p className="text-[10px] text-muted-foreground">progress</p></div></div><div className="mt-4"><ProgressLine value={p.progress} /></div></Link>)}
    </div>}
    {!programmes.isLoading && !programmes.isError && !programmes.data?.length && <EmptyState title="No programmes" detail="Programmes will appear here once created." />}
  </div>;
}

function ProgrammeDetail({ id }: { id: string }) {
  const programmes = useProgrammes();
  const courses = useCourses(id);
  const programme = programmes.data?.find((p) => p.id === id);
  return <div className="page-in">
    <PageHeading eyebrow="Programme detail" title={programme?.name || 'Programme'} detail={programme ? `${programme.type} · ${programme.owner} · ${programme.learnerCount} learners` : 'Loading programme…'} action={<Link href="/programmes" className="text-xs font-semibold text-primary hover:underline">Back to portfolio</Link>} />
    {programmes.isLoading || courses.isLoading ? <Skeleton className="h-64" />
    : programmes.isError || courses.isError ? <ErrorState retry={() => { programmes.refetch(); courses.refetch(); }} />
    : !programme ? <EmptyState title="Programme not found" detail="It may have been archived." />
    : <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Courses in this programme</p>
        <div className="mt-4 space-y-3">{(courses.data || []).map((c) => <div key={c.id} className="rounded-lg border border-border/70 p-4"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-semibold">{c.title}</p><Status tone={c.status === 'published' ? 'good' : 'warn'}>{c.status}</Status></div><p className="mt-1 text-xs text-muted-foreground">{c.category} · {c.trainer}</p><div className="mt-3"><ProgressLine value={c.progress} /></div></div>)}
        {!courses.data?.length && <EmptyState title="No courses yet" detail="Courses assigned to this programme will appear here." />}</div></section>
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Workspace detail</p><h2 className="mt-1 text-lg font-bold">Progress {pct(programme.progress)}</h2><div className="mt-4"><ProgressLine value={programme.progress} color="bg-emerald-600" /></div><div className="mt-5 space-y-2 text-sm"><p className="flex justify-between"><span className="text-muted-foreground">Status</span><Status tone={programme.status === 'active' ? 'good' : 'neutral'}>{programme.status}</Status></p><p className="flex justify-between"><span className="text-muted-foreground">Learners</span><span className="font-semibold">{programme.learnerCount}</span></p><p className="flex justify-between"><span className="text-muted-foreground">Courses</span><span className="font-semibold">{programme.courseCount}</span></p><p className="flex justify-between"><span className="text-muted-foreground">Owner</span><span className="font-semibold">{programme.owner}</span></p></div></section>
    </div>}
  </div>;
}

function People() {
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
    <PageHeading eyebrow="People" title="Everyone moving forward." detail="Membership, progress, and accountability across the workspace." action={<Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogTrigger asChild><Button><Plus className="size-4" />Invite learner</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Invite a learner</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><Input placeholder="learner@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} /><Button className="w-full" onClick={() => setInviteOpen(false)}>Send invite (visual only)</Button><p className="text-xs text-muted-foreground">Invites are visual-only in this build and post nothing.</p></div></DialogContent></Dialog>} />
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

function MyLearning() {
  const courses = useCourses();
  const events = useCalendarEvents();
  const active = (courses.data || []).filter((c) => c.status !== 'archived').slice(0, 4);
  const done = (courses.data || []).filter((c) => c.progress >= 100);
  return <div className="page-in">
    <PageHeading eyebrow="My learning" title="Your path, in order." detail="Active courses, upcoming schedule, and earned certificates." />
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Active path</p><h2 className="mt-1 text-lg font-bold">Up next</h2>
        {courses.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : courses.isError ? <div className="mt-4"><ErrorState retry={() => courses.refetch()} /></div>
        : !active.length ? <div className="mt-4"><EmptyState title="Nothing assigned" detail="New courses will appear here." /></div>
        : <div className="mt-4 space-y-3">{active.map((c) => <div key={c.id} className="rounded-lg border border-border/70 p-4"><div className="flex justify-between gap-3"><p className="truncate text-sm font-semibold">{c.title}</p><span className="font-mono text-xs">{pct(c.progress)}</span></div><p className="mt-1 text-xs text-muted-foreground">{c.programmeName} · due {fmtDate(c.dueDate)}</p><div className="mt-3"><ProgressLine value={c.progress} /></div></div>)}</div>}
      </section>
      <div className="space-y-5">
        <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Schedule</p><h2 className="mt-1 text-lg font-bold">Coming up</h2>
          {events.isLoading ? <div className="mt-4"><Skeleton className="h-24" /></div>
          : events.isError ? <div className="mt-4"><ErrorState retry={() => events.refetch()} /></div>
          : <div className="mt-4 space-y-2">{(events.data || []).slice(0, 4).map((e) => <div key={e.id} className="flex items-center gap-3 rounded-lg bg-secondary/55 p-3"><div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{e.title}</p><p className="text-xs text-muted-foreground">{fmtDate(e.date)} · {e.time}</p></div></div>)}
          {!events.data?.length && <EmptyState title="No sessions scheduled" detail="Book coaching from the calendar." />}</div>}
        </section>
        <section className="rounded-xl border border-border/80 bg-primary p-5 text-primary-foreground"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Certificates</p><h2 className="mt-1 text-lg font-bold">{done.length} earned</h2><p className="mt-1 text-xs text-primary-foreground/65">Completed courses issue a verifiable certificate.</p></section>
      </div>
    </div>
  </div>;
}

function Assessments() {
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
      <section className="rounded-xl border border-border/80 bg-card p-5">
        <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Assessment queue</p><h2 className="mt-1 text-lg font-bold">Courses ready for review</h2></div><Status tone="warn">{courses.data?.length || 0} courses</Status></div>
        {courses.isLoading ? <div className="mt-5 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        : courses.isError ? <div className="mt-5"><ErrorState retry={() => courses.refetch()} /></div>
        : <div className="mt-5 space-y-2">{courses.data?.map((course) => <button key={course.id} onClick={() => { setSelectedId(course.id); setResult(null); }} className={cn('w-full rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/35', selected?.id === course.id ? 'border-primary/50 bg-primary/5' : 'border-border/70')}><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-accent/25 text-primary"><Target className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{course.title}</p><p className="mt-1 text-xs text-muted-foreground">{course.programmeName} · threshold {course.appliedThreshold}%</p></div><div className="text-right"><p className="font-mono text-xs">{course.appliedScore == null ? '—' : `${course.appliedScore}%`}</p><p className="mt-1 text-[10px] text-muted-foreground">applied score</p></div></div></button>)}</div>}
        {!courses.data?.length && !courses.isLoading && !courses.isError && <div className="mt-4"><EmptyState title="Assessment queue is clear" detail="New courses will appear here when ready for evidence." /></div>}
      </section>
      <section className="rounded-xl border border-primary/20 bg-primary p-5 text-primary-foreground">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Submission panel</p>
        <h2 className="mt-1 text-lg font-bold">{selected ? selected.title : 'Select a course'}</h2>
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

function CalendarPage() {
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

function Messages() {
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

function Reports() {
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

function Governance() {
  const logs = useAuditLogs();
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
    <section className="mt-5 overflow-hidden rounded-xl border border-border/80 bg-card"><div className="border-b border-border/70 p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Audit trail</p><h2 className="mt-1 text-lg font-bold">Live from /audit/logs</h2></div>
      {logs.isLoading ? <div className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      : logs.isError ? <div className="p-5"><ErrorState retry={() => logs.refetch()} /></div>
      : !logs.data?.length ? <div className="p-5"><EmptyState title="No audit events" detail="Admin actions will be recorded here." /></div>
      : <table className="w-full text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="p-4">Action</th><th className="p-4">Entity</th><th className="p-4">Timestamp</th></tr></thead><tbody className="divide-y divide-border/70">{logs.data.map((l) => <tr key={l.id}><td className="p-4 font-semibold">{l.action}</td><td className="p-4 text-muted-foreground">{l.entity}</td><td className="p-4 font-mono text-xs">{fmtDate(l.timestamp)}</td></tr>)}</tbody></table>}
    </section>
  </div>;
}

function ReviewCredit() {
  const settings = useReviewCreditSettings();
  const update = useUpdateReviewCreditSettings();
  const [local, setLocal] = useState<ReviewCreditSettings | null>(null);
  const [exporting, setExporting] = useState(false);
  const value = local || settings.data;
  const save = (patch: Partial<ReviewCreditSettings>) => {
    if (!value) return;
    const next = { ...value, ...patch };
    setLocal(next);
    update.mutate(patch, { onError: () => setLocal(value) });
  };
  const exportCsv = async () => {
    setExporting(true);
    try { await downloadReviewCreditCsv(); } finally { setExporting(false); }
  };
  return <div className="page-in">
    <PageHeading eyebrow="Governance controls" title="Make performance visible." detail="Give managers a defensible way to credit demonstrated learning in performance reviews." action={<Button variant="outline" onClick={exportCsv} disabled={exporting}><Download className="size-4" />{exporting ? 'Preparing…' : 'Export credits'}</Button>} />
    {settings.isLoading ? <div className="grid gap-5 md:grid-cols-2">{[1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>
    : settings.isError ? <ErrorState retry={() => settings.refetch()} />
    : value && <div className="grid gap-5 xl:grid-cols-[1fr_.72fr]">
      <section className="rounded-xl border border-border/80 bg-card p-5">
        <div className="flex items-center justify-between border-b border-border/70 pb-5"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Workspace switch</p><h2 className="mt-1 text-lg font-bold">Review credit is {value.enabled ? 'active' : 'off'}</h2><p className="mt-1 text-sm text-muted-foreground">When enabled, competence evidence can contribute to performance reviews.</p></div><Toggle checked={value.enabled} onCheckedChange={(checked) => save({ enabled: checked })} /></div>
        <div className="mt-6 space-y-5">
          <div><div className="flex justify-between text-sm"><span className="font-semibold">Maximum weighting</span><span className="font-mono text-primary">{value.maxWeighting}%</span></div><input className="mt-3 w-full accent-[hsl(var(--primary))]" type="range" min="0" max="40" value={value.maxWeighting} onChange={(e) => save({ maxWeighting: Number(e.target.value) })} /></div>
          <div className="grid gap-3 sm:grid-cols-3">{([['Assessment', value.assessmentWeight], ['Timeliness', value.timelinessWeight], ['Application', value.applicationWeight]] as const).map(([label, amount]) => <div key={label} className="rounded-lg bg-secondary/55 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-bold">{amount}%</p></div>)}</div>
        </div>
      </section>
      <section className="rounded-xl border border-border/80 bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Policy</p><h2 className="mt-1 text-lg font-bold">Guardrails</h2>
        <div className="mt-4 space-y-4">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Require manager sign-off</span><Toggle checked={value.requireManagerSignoff} onCheckedChange={(checked) => save({ requireManagerSignoff: checked })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Collect application scores</span><Toggle checked={value.collectApplicationScores} onCheckedChange={(checked) => save({ collectApplicationScores: checked })} /></label>
          <div><p className="text-sm font-semibold">Eligible programme types</p><div className="mt-2 flex flex-wrap gap-2">{value.eligibleProgrammeTypes.map((t) => <Status key={t} tone="good">{t}</Status>)}{!value.eligibleProgrammeTypes.length && <span className="text-xs text-muted-foreground">All types eligible</span>}</div></div>
          {update.isError && <p className="text-xs text-destructive">Save failed — retry the toggle.</p>}
        </div>
      </section>
    </div>}
  </div>;
}

function SettingsPage() {
  const workspace = useWorkspace();
  const [saved, setSaved] = useState(false);
  const user = workspace.data?.user;
  const org = workspace.data?.organization;
  return <div className="page-in">
    <PageHeading eyebrow="Workspace administration" title="A calm control room." detail="Keep roles, identity, and governance details aligned with how work actually runs." action={<Button onClick={() => { setSaved(true); window.setTimeout(() => setSaved(false), 2200); }}>{saved ? <><Check className="size-4" />Saved</> : 'Save changes'}</Button>} />
    {workspace.isLoading ? <div className="grid gap-5 md:grid-cols-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
    : workspace.isError ? <ErrorState retry={() => workspace.refetch()} />
    : <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Identity</p><h2 className="mt-1 text-lg font-bold">Workspace details</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold">Organisation<Input className="mt-2" value={org?.name || ''} readOnly /></label><label className="text-xs font-semibold">Plan<Input className="mt-2" value={org?.plan || ''} readOnly /></label><label className="text-xs font-semibold">Active programme<Input className="mt-2" value={workspace.data?.activeProgramme.name || ''} readOnly /></label><label className="text-xs font-semibold">Workspace ID<Input className="mt-2 font-mono text-xs" value={org?.id || ''} readOnly /></label></div>
        <div className="mt-6 rounded-lg bg-secondary/55 p-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{user?.initials}</div><div><p className="text-sm font-semibold">{user?.name}</p><p className="text-xs text-muted-foreground">{user?.email}</p></div><Status tone="good">{user?.role}</Status></div></div>
      </section>
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Governance</p><h2 className="mt-1 text-lg font-bold">Data source</h2><p className="mt-3 text-sm text-muted-foreground">Backend API at <span className="font-mono">/api</span> proxied to <span className="font-mono">localhost:4000</span>. Source: <span className="font-mono">{workspace.data?.dataSource}</span>.</p><div className="mt-4 flex items-center gap-2 text-sm"><Gauge className="size-4 text-primary" />JWT session via localStorage <span className="font-mono text-xs">th360_token</span></div></section>
    </div>}
  </div>;
}

function NotFound() {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center text-center"><Gauge className="size-8 text-primary" /><h1 className="mt-4 text-3xl font-extrabold">That page is off the map.</h1><p className="mt-2 text-sm text-muted-foreground">Return to your workspace overview.</p><Link className="mt-5 text-sm font-semibold text-primary hover:underline" href="/">Back to overview</Link></div>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Overview} />
    <Route path="/learning" component={Learning} />
    <Route path="/programmes" component={Programmes} />
    <Route path="/programmes/:id">{(params) => <ProgrammeDetail id={params.id} />}</Route>
    <Route path="/people" component={People} />
    <Route path="/my-learning" component={MyLearning} />
    <Route path="/assessments" component={Assessments} />
    <Route path="/calendar" component={CalendarPage} />
    <Route path="/messages" component={Messages} />
    <Route path="/reports" component={Reports} />
    <Route path="/governance" component={Governance} />
    <Route path="/review-credit" component={ReviewCredit} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {authed ? (
        <Shell onLogout={() => { clearSession(); setAuthed(false); }}>
          <RoutedErrorBoundary><Router /></RoutedErrorBoundary>
        </Shell>
      ) : (
        <Login onDone={() => setAuthed(true)} />
      )}
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;
