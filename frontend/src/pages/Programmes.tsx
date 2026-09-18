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
  useCreateProgramme,
  useUpdateProgramme,
  useRequestDeletion,
  useUpdateCourse,
  useUpdateModule,
  useRequestContentDeletion,
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
export function Programmes() {
  const programmes = useProgrammes();
  const updateProgramme = useUpdateProgramme();
  const requestDeletion = useRequestDeletion();
  const [editing, setEditing] = useState<null | { id: string; name: string; type: string; owner: string }>(null);
  const canManage = ['admin', 'owner'].includes(getSessionUser()?.role ?? '');
  const saveEdit = () => {
    if (!editing || !editing.name) return;
    updateProgramme.mutate(
      { id: editing.id, patch: { name: editing.name, type: editing.type, owner: editing.owner || undefined } },
      { onSuccess: () => { qc.invalidateQueries({ queryKey: ['programmes'] }); setEditing(null); } },
    );
  };
  const [actionError, setActionError] = useState<string | null>(null);
  const createProgramme = useCreateProgramme();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'Professional Development', owner: '' });
  const canCreate = ['admin', 'owner'].includes(getSessionUser()?.role ?? '');
  const submit = () => {
    if (!form.name) return;
    createProgramme.mutate(
      { name: form.name, type: form.type, owner: form.owner || undefined },
      { onSuccess: () => { qc.invalidateQueries({ queryKey: ['programmes'] }); setOpen(false); setForm({ name: '', type: 'Professional Development', owner: '' }); } },
    );
  };
  return <div className="page-in">
    <PageHeading eyebrow="Programme portfolio" title="Programmes with owners." detail="Every programme has movement, membership, and an accountable owner." action={canCreate ? <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="size-4" />New programme</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create a programme</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Programme name<Input className="mt-2" placeholder="e.g. Leadership Accelerator" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-programme-name" /></label><label className="block text-xs font-semibold">Type<Input className="mt-2" placeholder="e.g. Onboarding" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} data-testid="input-programme-type" /></label><label className="block text-xs font-semibold">Owner (optional)<Input className="mt-2" placeholder="Accountable owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} data-testid="input-programme-owner" /></label><Button className="w-full" disabled={createProgramme.isPending} onClick={submit} data-testid="button-submit-programme">{createProgramme.isPending ? 'Creating…' : 'Create programme'}</Button></div></DialogContent></Dialog> : undefined} />
    {programmes.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
    : programmes.isError ? <ErrorState retry={() => programmes.refetch()} />
    : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(programmes.data || []).map((p) => <div key={p.id} className="rounded-xl border border-border/80 bg-card p-5 transition-transform hover:-translate-y-0.5"><Link href={`/programmes/${p.id}`} className="block"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><GraduationCap className="size-5" /></div><div className="min-w-0 flex-1"><p className="truncate font-bold">{p.name}</p><p className="text-xs text-muted-foreground">{p.type} · {p.owner}</p></div><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{p.learnerCount}</p><p className="text-[10px] text-muted-foreground">learners</p></div><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{p.courseCount}</p><p className="text-[10px] text-muted-foreground">courses</p></div><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{pct(p.progress)}</p><p className="text-[10px] text-muted-foreground">progress</p></div></div><div className="mt-4"><ProgressLine value={p.progress} /></div></Link>{canManage && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditing({ id: p.id, name: p.name, type: p.type, owner: p.owner })}>Edit</Button><Button size="sm" variant="outline" disabled={requestDeletion.isPending} onClick={() => { setActionError(null); const reason = window.prompt(`Request deletion approval for "${p.name}"? Optionally give a reason:`); if (reason === null) return; requestDeletion.mutate({ programmeId: p.id, reason: reason || undefined }, { onSuccess: () => setActionError(null), onError: (e) => setActionError(`Request failed (${(e as Error).message}).`) }); }}>Request deletion</Button></div>}</div>)}
    </div>}
    {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}
    {!programmes.isLoading && !programmes.isError && !programmes.data?.length && <EmptyState title="No programmes" detail="Programmes will appear here once created." />}
    <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Edit programme</DialogTitle></DialogHeader>{editing && <div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Name<Input className="mt-2" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label><label className="block text-xs font-semibold">Type<Input className="mt-2" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })} /></label><label className="block text-xs font-semibold">Owner<Input className="mt-2" value={editing.owner} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} /></label><Button className="w-full" disabled={updateProgramme.isPending} onClick={saveEdit}>{updateProgramme.isPending ? 'Saving…' : 'Save changes'}</Button></div>}</DialogContent></Dialog>
  </div>;
}

export function ProgrammeDetail({ id }: { id: string }) {
  const programmes = useProgrammes();
  const courses = useCourses(id);
  const modules = useModules(id);
  const [helpModuleId, setHelpModuleId] = useState<string | null>(null);
  const updateCourse = useUpdateCourse();
  const requestContentDeletion = useRequestContentDeletion();
  const updateModule = useUpdateModule();
  const requestDelete = (target: 'courses' | 'modules', id: string, label: string) => { const reason = window.prompt(`Request deletion approval for "${label}"? A second admin must approve:`); if (reason === null) return; requestContentDeletion.mutate({ target, id, reason: reason || undefined }, { onSuccess: refreshDetail }); };
  const dqc = useQueryClient();
  const [editingCourse, setEditingCourse] = useState<null | { id: string; title: string; category: string; trainer: string }>(null);
  const [editingModule, setEditingModule] = useState<null | { id: string; title: string }>(null);
  const canManageDetail = ['admin', 'owner'].includes(getSessionUser()?.role ?? '');
  const refreshDetail = () => { dqc.invalidateQueries({ queryKey: ['courses'] }); dqc.invalidateQueries({ queryKey: ['programmes'] }); };
  const programme = programmes.data?.find((p) => p.id === id);
  return <div className="page-in">
    <PageHeading eyebrow="Programme detail" title={programme?.name || 'Programme'} detail={programme ? `${programme.type} · ${programme.owner} · ${programme.learnerCount} learners` : 'Loading programme…'} action={<Link href="/programmes" className="text-xs font-semibold text-primary hover:underline">Back to portfolio</Link>} />
    {programmes.isLoading || courses.isLoading ? <Skeleton className="h-64" />
    : programmes.isError || courses.isError ? <ErrorState retry={() => { programmes.refetch(); courses.refetch(); }} />
    : !programme ? <EmptyState title="Programme not found" detail="It may have been archived." />
    : <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Courses in this programme</p>
        <div className="mt-4 space-y-3">{(courses.data || []).map((c) => <div key={c.id} className="rounded-lg border border-border/70 p-4"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-semibold">{c.title}</p><Status tone={c.status === 'published' ? 'good' : 'warn'}>{c.status}</Status></div><p className="mt-1 text-xs text-muted-foreground">{c.category} · {c.trainer}</p><div className="mt-3"><ProgressLine value={c.progress} /></div>{canManageDetail && <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditingCourse({ id: c.id, title: c.title, category: c.category, trainer: c.trainer })}>Edit</Button><Button size="sm" variant="outline" onClick={() => { requestDelete('courses', c.id, c.title); }}>Delete</Button></div>}</div>)}
        {!courses.data?.length && <EmptyState title="No courses yet" detail="Courses assigned to this programme will appear here." />}</div>
        <Dialog open={!!editingCourse} onOpenChange={(v) => { if (!v) setEditingCourse(null); }}><DialogContent><DialogHeader><DialogTitle>Edit course</DialogTitle></DialogHeader>{editingCourse && <div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Title<Input className="mt-2" value={editingCourse.title} onChange={(e) => setEditingCourse({ ...editingCourse, title: e.target.value })} /></label><label className="block text-xs font-semibold">Category<Input className="mt-2" value={editingCourse.category} onChange={(e) => setEditingCourse({ ...editingCourse, category: e.target.value })} /></label><label className="block text-xs font-semibold">Trainer<Input className="mt-2" value={editingCourse.trainer} onChange={(e) => setEditingCourse({ ...editingCourse, trainer: e.target.value })} /></label><Button className="w-full" disabled={updateCourse.isPending} onClick={() => updateCourse.mutate({ id: editingCourse.id, patch: { title: editingCourse.title, category: editingCourse.category, trainer: editingCourse.trainer } }, { onSuccess: () => { refreshDetail(); setEditingCourse(null); } })}>{updateCourse.isPending ? 'Saving…' : 'Save changes'}</Button></div>}</DialogContent></Dialog></section>
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Modules & concept help</p>
        <div className="mt-4 space-y-3">{(modules.data || []).map((m) => {
          const course = (courses.data || []).find((c) => c.id === m.courseId);
          return <div key={m.id} className="rounded-lg border border-border/70 p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{m.title}</p><p className="mt-1 text-xs text-muted-foreground">{course?.title ?? 'Course module'}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => setHelpModuleId(helpModuleId === m.id ? null : m.id)} data-testid={`button-module-help-${m.id}`}>Stuck on this concept?</Button>{canManageDetail && <><Button size="sm" variant="outline" onClick={() => setEditingModule({ id: m.id, title: m.title })}>Edit</Button><Button size="sm" variant="outline" onClick={() => { requestDelete('modules', m.id, m.title); }}>Delete</Button></>}</div></div>
          {helpModuleId === m.id && <div className="mt-3"><AiConceptExplainer courseId={m.courseId} moduleId={m.id} moduleTitle={m.title} /></div>}</div>;
        })}
        {!modules.data?.length && <EmptyState title="No modules yet" detail="Micro-learning modules will appear here once added." />}</div>
        <Dialog open={!!editingModule} onOpenChange={(v) => { if (!v) setEditingModule(null); }}><DialogContent><DialogHeader><DialogTitle>Edit module</DialogTitle></DialogHeader>{editingModule && <div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Title<Input className="mt-2" value={editingModule.title} onChange={(e) => setEditingModule({ ...editingModule, title: e.target.value })} /></label><Button className="w-full" disabled={updateModule.isPending} onClick={() => updateModule.mutate({ id: editingModule.id, patch: { title: editingModule.title } }, { onSuccess: () => { refreshDetail(); setEditingModule(null); } })}>{updateModule.isPending ? 'Saving…' : 'Save changes'}</Button></div>}</DialogContent></Dialog></section>
      <section className="rounded-xl border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Workspace detail</p><h2 className="mt-1 text-lg font-bold">Progress {pct(programme.progress)}</h2><div className="mt-4"><ProgressLine value={programme.progress} color="bg-emerald-600" /></div><div className="mt-5 space-y-2 text-sm"><p className="flex justify-between"><span className="text-muted-foreground">Status</span><Status tone={programme.status === 'active' ? 'good' : 'neutral'}>{programme.status}</Status></p><p className="flex justify-between"><span className="text-muted-foreground">Learners</span><span className="font-semibold">{programme.learnerCount}</span></p><p className="flex justify-between"><span className="text-muted-foreground">Courses</span><span className="font-semibold">{programme.courseCount}</span></p><p className="flex justify-between"><span className="text-muted-foreground">Owner</span><span className="font-semibold">{programme.owner}</span></p></div></section>
    </div>}
  </div>;
}








