import { useEffect, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { SESSION_EXPIRED_EVENT, getToken, clearSession, getSessionUser } from '@/api/client';
import { canAccessRoute } from '@/auth/routePolicy';
import { RequireRouteAccess } from '@/components/route-guard';
import { StakeholderDashboard } from '@/pages/StakeholderDashboard';
import { Login } from '@/pages/Login';
import { Activate } from '@/pages/Activate';
import { ResetPassword } from '@/pages/ResetPassword';
import { Register } from '@/pages/Register';
import { AiConceptExplainer } from '@/components/AiConceptExplainer';
import { BulkImportButton } from '@/components/BulkImport';
import { NotificationBell } from '@/components/NotificationBell';
import { initials } from '@/components/shared';
import {
  Activity, ArrowUpRight, BarChart3, Bell, BookOpen, CalendarDays, Check, ChevronDown,
  CircleAlert, ClipboardCheck, Clock3, Download, FileCheck2, Gauge, GraduationCap, LayoutDashboard,
  Menu, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search, Send, Settings2,
  ShieldCheck, SlidersHorizontal, Target, UserRound, Users, X, Zap,
} from 'lucide-react';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      if ((error as { status?: number }).status === 401) clearSession();
    },
  }),
});

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/learning', label: 'Learning', icon: BookOpen },
  { href: '/programmes', label: 'Programmes', icon: GraduationCap },
  { href: '/people', label: 'People', icon: Users },
  { href: '/my-learning', label: 'My learning', icon: Target },
  { href: '/assessments', label: 'Assessments', icon: FileCheck2 },
  { href: '/verification', label: 'Verification', icon: ClipboardCheck },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
];
const adminNav = [
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/governance', label: 'Governance', icon: ShieldCheck },
  { href: '/review-credit', label: 'Review credit', icon: Zap },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];
const learnerNav = [
  { href: '/my-learning', label: 'My learning', icon: Target },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/profile', label: 'Profile', icon: UserRound },
];
import { Overview } from '@/pages/Overview';
import { Learning } from '@/pages/Learning';
import { Programmes, ProgrammeDetail, CourseContentManager } from '@/pages/Programmes';
import { People } from '@/pages/People';
import { MyLearning } from '@/pages/MyLearning';
import { Assessments } from '@/pages/Assessments';
import { GradingQueuePage, GradingAttemptPage } from '@/pages/Grading';
import { VerificationPage } from '@/pages/Verification';
import { CalendarPage } from '@/pages/Calendar';
import { Messages } from '@/pages/Messages';
import { Reports } from '@/pages/Reports';
import { Governance } from '@/pages/Governance';
import { ReviewCredit } from '@/pages/ReviewCredit';
import { SettingsPage } from '@/pages/Settings';
import { ProfilePage } from '@/pages/Profile';

function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [location, setLocation] = useLocation();
  const go = (href: string) => { setMobileOpen(false); setLocation(href); };
  const sessionUser = getSessionUser();
  const isLearner = sessionUser?.role === 'learner';
  const visibleNav = nav.filter((item) => canAccessRoute(sessionUser, item.href));
  if (isLearner) {
    visibleNav.splice(0, visibleNav.length, ...learnerNav.filter((item) => canAccessRoute(sessionUser, item.href)));
  }
  const visibleAdminNav = adminNav.filter((item) => canAccessRoute(sessionUser, item.href));
  const allNav = [...visibleNav, ...visibleAdminNav];
  const active = allNav.find((n) => n.href === location) ?? (location.startsWith('/programmes') ? { href: '/programmes', label: 'Programmes' } : null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspace = useWorkspace();
  const user = workspace.data?.user;
  return <div className="min-h-[100dvh] bg-background">
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground transition-transform duration-200 lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center gap-3 px-2 py-1">
        <button onClick={() => go('/')} className="flex items-center gap-3 text-left">
          <div className="grid size-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><ShieldCheck className="size-5" /></div>
          <div><p className="text-[15px] font-bold tracking-[-.02em]">TrainHub<span className="text-sidebar-primary">360</span></p><p className="text-[10px] font-medium tracking-wide text-sidebar-foreground/50">Workforce readiness</p></div>
        </button>
        <button className="ml-auto rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="size-5" /></button>
      </div>
      <div className="mt-5 rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-sidebar-foreground/45">Workspace</p>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">{initials(workspace.data?.organization.name)}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{workspace.data?.organization.name || 'Loading workspace'}</p><p className="truncate text-[11px] text-sidebar-foreground/50">{workspace.data?.organization.plan || '—'} plan</p></div>
        </div>
        {workspace.data && workspace.data.dataSource !== 'mssql' && <p className="mt-2.5 rounded-md border border-sidebar-primary/25 bg-sidebar-primary/10 px-2 py-1.5 text-[10px] leading-relaxed text-sidebar-primary">Demo workspace — SQL Server unavailable</p>}
      </div>
      <nav className="mt-6 space-y-0.5" aria-label="Main navigation">
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-sidebar-foreground/40">Workspace</p>
        {visibleNav.map(({ href, label, icon: Icon }) => {
          const isActive = location === href || (href === '/programmes' && location.startsWith('/programmes'));
          return <button key={href} onClick={() => go(href)} className={cn('group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors', isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className="size-[17px] shrink-0" /><span className="truncate">{label}</span>{label === 'Messages' && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}</button>;
        })}
      </nav>
      {visibleAdminNav.length > 0 && <>
        <div className="my-4 h-px bg-sidebar-border" />
        <nav className="space-y-0.5" aria-label="Governance navigation">
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-sidebar-foreground/40">Governance</p>
          {visibleAdminNav.map(({ href, label, icon: Icon }) => <button key={href} onClick={() => go(href)} className={cn('group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors', location === href ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className="size-[17px] shrink-0" /><span className="truncate">{label}</span></button>)}
        </nav>
      </>}
      <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">{user?.initials || 'TH'}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.name || 'Workspace user'}</p><p className="truncate text-[11px] capitalize text-sidebar-foreground/50">{user?.role || 'Manager'}</p></div>
        </div>
        <button onClick={onLogout} className="mt-3 w-full rounded-lg border border-sidebar-border px-3 py-1.5 text-xs font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent">Sign out</button>
      </div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    <div className="lg:pl-[260px]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-md md:px-8">
        <div className="flex items-center gap-3">
          <button className="rounded-lg p-2 text-muted-foreground hover:bg-secondary lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
            <span className="text-muted-foreground/70">TrainHub360</span>
            <span className="text-border">/</span>
            <span className="font-medium text-foreground">{active?.label || location.slice(1) || 'Overview'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground md:flex">
            <Search className="size-3.5" />
            <span>Search</span>
            <kbd className="ml-2 rounded border border-border bg-muted px-1 font-mono text-[9px]">⌘K</kbd>
          </div>
          <NotificationBell onNavigate={go} />
          <button onClick={() => go('/profile')} className="ml-1 grid size-9 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-sm transition-transform hover:scale-[1.02]" aria-label="Open profile" data-testid="header-profile">{user?.initials || 'TH'}</button>
        </div>
      </header>
      <main className={cn('mx-auto max-w-[1440px] px-4 pt-6 md:px-8', isLearner ? 'pb-24 lg:pb-8' : 'pb-8')}>{children}</main>
    </div>
    {isLearner && <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border/80 bg-background/95 backdrop-blur-md lg:hidden" aria-label="Learner mobile navigation" data-testid="mobile-learner-nav">
      {learnerNav.map(({ href, label, icon: Icon }) => <button key={href} onClick={() => go(href)} aria-current={location === href ? 'page' : undefined} className={cn('flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold transition-colors', location === href ? 'text-primary' : 'text-muted-foreground hover:text-foreground')} data-testid={`mobile-nav-${label.toLowerCase().replace(' ', '-')}`}><Icon className="size-5" /><span>{label}</span></button>)}
    </nav>}
  </div>;
}
function NotFound() {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center text-center"><Gauge className="size-8 text-primary" /><h1 className="mt-4 text-3xl font-extrabold">That page is off the map.</h1><p className="mt-2 text-sm text-muted-foreground">Return to your workspace overview.</p><Link className="mt-5 text-sm font-semibold text-primary hover:underline" href="/">Back to overview</Link></div>;
}

function Home() {
  return getSessionUser()?.role === 'stakeholder' ? <StakeholderDashboard /> : <Overview />;
}

function Protected({ path, children }: { path: string; children: ReactNode }) {
  return <RequireRouteAccess path={path}>{children}</RequireRouteAccess>;
}

function Router() {
  return <Switch>
    <Route path="/"><Protected path="/"><Home /></Protected></Route>
    <Route path="/learning"><Protected path="/learning"><Learning /></Protected></Route>
    <Route path="/programmes"><Protected path="/programmes"><Programmes /></Protected></Route>
    <Route path="/programmes/:id">{(params) => <Protected path="/programmes/:id"><ProgrammeDetail id={params.id} /></Protected>}</Route>
    <Route path="/programmes/:id/courses/:courseId">{(params) => <Protected path="/programmes/:id"><CourseContentManager courseId={params.courseId} programmeId={params.id} /></Protected>}</Route>
    <Route path="/course-content/:courseId">{(params) => <Protected path="/course-content/:courseId"><CourseContentManager courseId={params.courseId} /></Protected>}</Route>
    <Route path="/people"><Protected path="/people"><People /></Protected></Route>
    <Route path="/my-learning"><Protected path="/my-learning"><MyLearning /></Protected></Route>
    <Route path="/assessments"><Protected path="/assessments"><Assessments /></Protected></Route>
    <Route path="/assessments/grading"><Protected path="/assessments/grading"><GradingQueuePage /></Protected></Route>
    <Route path="/assessments/grading/:attemptId">{(params) => <Protected path="/assessments/grading/:attemptId"><GradingAttemptPage attemptId={params.attemptId} /></Protected>}</Route>
    <Route path="/verification"><Protected path="/verification"><VerificationPage /></Protected></Route>
    <Route path="/calendar"><Protected path="/calendar"><CalendarPage /></Protected></Route>
    <Route path="/messages"><Protected path="/messages"><Messages /></Protected></Route>
    <Route path="/reports"><Protected path="/reports"><Reports /></Protected></Route>
    <Route path="/governance"><Protected path="/governance"><Governance /></Protected></Route>
    <Route path="/review-credit"><Protected path="/review-credit"><ReviewCredit /></Protected></Route>
    <Route path="/settings"><Protected path="/settings"><SettingsPage /></Protected></Route>
    <Route path="/profile"><Protected path="/profile"><ProfilePage /></Protected></Route>
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
  useEffect(() => {
    const expire = () => setAuthed(false);
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, []);
  // Activation and password-reset links arrive from an email with ?token=…, so they must
  // render before any session exists. wouter is not mounted on the signed-out screen, so
  // read the path here. Round 7 gap 4 added /reset-password: the email already linked to it,
  // but there was no route, so the link landed on the login page and the token was dropped.
  if (window.location.pathname === '/activate') {
    return <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Activate onDone={() => { window.history.replaceState(null, '', '/'); window.location.reload(); }} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>;
  }
  if (window.location.pathname === '/reset-password') {
    return <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ResetPassword onDone={() => { window.history.replaceState(null, '', '/'); window.location.reload(); }} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>;
  }
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {authed ? (
        <Shell onLogout={() => { clearSession(); setAuthed(false); }}>
          <RoutedErrorBoundary><Router /></RoutedErrorBoundary>
        </Shell>
      ) : registering ? (
        <Register onDone={() => setRegistering(false)} onBack={() => setRegistering(false)} />
      ) : (
        <Login onDone={() => { window.history.replaceState(null, '', '/'); window.location.reload(); }} onRegister={() => setRegistering(true)} />
      )}
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;


