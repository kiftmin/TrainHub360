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
import { initials } from '@/components/shared';
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
import { Overview } from '@/pages/Overview';
import { Learning } from '@/pages/Learning';
import { Programmes, ProgrammeDetail } from '@/pages/Programmes';
import { People } from '@/pages/People';
import { MyLearning } from '@/pages/MyLearning';
import { Assessments } from '@/pages/Assessments';
import { CalendarPage } from '@/pages/Calendar';
import { Messages } from '@/pages/Messages';
import { Reports } from '@/pages/Reports';
import { Governance } from '@/pages/Governance';
import { ReviewCredit } from '@/pages/ReviewCredit';
import { SettingsPage } from '@/pages/Settings';

function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [location, setLocation] = useLocation();
  const go = (href: string) => { setMobileOpen(false); setLocation(href); };
  const isStakeholder = getSessionUser()?.role === 'stakeholder';
  const visibleNav = isStakeholder ? [] : nav;
  const visibleAdminNav = isStakeholder ? [] : adminNav;
  const allNav = [...visibleNav, ...visibleAdminNav];
  const active = allNav.find((n) => n.href === location) ?? (location.startsWith('/programmes') ? { href: '/programmes', label: 'Programmes' } : null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspace = useWorkspace();
  const user = workspace.data?.user;
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
        {visibleNav.map(({ href, label, icon: Icon }) => <button key={href} onClick={() => go(href)} className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', (location === href || (href === '/programmes' && location.startsWith('/programmes'))) ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className="size-[17px]" /><span>{label}</span>{label === 'Messages' && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}</button>)}
      </nav>
      <div className="my-7 h-px bg-sidebar-border" />
      <p className="px-3 font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/40">Governance</p>
      <nav className="mt-2 space-y-1">
        {visibleAdminNav.map(({ href, label, icon: Icon }) => <button key={href} onClick={() => go(href)} className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className="size-[17px]" /><span>{label}</span></button>)}
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

function NotFound() {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center text-center"><Gauge className="size-8 text-primary" /><h1 className="mt-4 text-3xl font-extrabold">That page is off the map.</h1><p className="mt-2 text-sm text-muted-foreground">Return to your workspace overview.</p><Link className="mt-5 text-sm font-semibold text-primary hover:underline" href="/">Back to overview</Link></div>;
}

function Router() {
  if (getSessionUser()?.role === 'stakeholder') return <StakeholderDashboard />;
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
  const [registering, setRegistering] = useState(false);
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {authed ? (
        <Shell onLogout={() => { clearSession(); setAuthed(false); }}>
          <RoutedErrorBoundary><Router /></RoutedErrorBoundary>
        </Shell>
      ) : registering ? (
        <Register onDone={() => setRegistering(false)} onBack={() => setRegistering(false)} />
      ) : (
        <Login onDone={() => setAuthed(true)} onRegister={() => setRegistering(true)} />
      )}
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;


