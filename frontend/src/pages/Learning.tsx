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
export function Learning() {
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
    <PageHeading eyebrow="Learning operations" title="Learning that holds up." detail="Track programme movement, not just content consumption." action={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="size-4" />Add course</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Add a course to the workspace</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Course title<Input className="mt-2" placeholder="e.g. Coaching for performance" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label className="block text-xs font-semibold">Programme<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={form.programmeId} onChange={(e) => setForm({ ...form, programmeId: e.target.value })}><option value="">Select programme</option>{programmes.data?.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="block text-xs font-semibold">Category<Input className="mt-2" placeholder="e.g. Leadership" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label><label className="block text-xs font-semibold">Applied threshold (%)<Input className="mt-2" type="number" placeholder="80" value={form.appliedThreshold} onChange={(e) => setForm({ ...form, appliedThreshold: e.target.value })} /></label><Button className="w-full" disabled={createCourse.isPending} onClick={submit}>{createCourse.isPending ? 'Adding course…' : 'Add course'}</Button></div></DialogContent></Dialog>} />
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border/80 bg-card p-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="border-0 bg-secondary/60 pl-9 shadow-none focus-visible:ring-1" placeholder="Search courses or programmes" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Status>{programmes.data?.length || 0} programmes</Status><Status>{courses.data?.length || 0} courses</Status></div>
    </div>
    {programmes.isLoading || courses.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}</div>
    : programmes.isError || courses.isError ? <ErrorState retry={() => { programmes.refetch(); courses.refetch(); }} />
    : <>
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Programme portfolio</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(programmes.data || []).map((p) => <Link key={p.id} href={`/programmes/${p.id}`} className="rounded-lg border border-border/80 bg-card p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-start justify-between"><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status><span className="font-mono text-[10px] text-muted-foreground">{p.type}</span></div><p className="mt-3 text-base font-bold tracking-tight">{p.name}</p><p className="mt-1 text-xs text-muted-foreground">{p.learnerCount} learners · {p.courseCount} courses · {p.owner}</p><div className="mt-4"><ProgressLine value={p.progress} /></div><p className="mt-2 font-mono text-xs">{pct(p.progress)}</p></Link>)}
      </div>
      {!programmes.data?.length && <div className="mt-4"><EmptyState title="No programmes" detail="Programmes will appear here once created." /></div>}
      <h2 className="mb-3 mt-8 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Course catalogue</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => <div key={c.id} className="rounded-lg border border-border/80 bg-card p-5"><div className="flex items-center justify-between"><Status tone={c.status === 'published' ? 'good' : 'warn'}>{c.status}</Status><span className="text-[11px] text-muted-foreground">{c.category}</span></div><p className="mt-3 text-base font-bold">{c.title}</p><p className="mt-1 text-xs text-muted-foreground">{c.programmeName} · {c.trainer} · due {fmtDate(c.dueDate)}</p><div className="mt-4"><ProgressLine value={c.progress} /></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>Threshold {c.appliedThreshold}%</span><span>{c.appliedScore == null ? 'No score yet' : `${c.appliedScore}% applied`}</span></div></div>)}
      </div>
      {!list.length && <div className="mt-4"><EmptyState title="No courses match" detail="Try a different search or add a course." /></div>}
    </>}
  </div>;
}


