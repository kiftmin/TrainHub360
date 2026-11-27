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
  useModules,
  useCreateModule,
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
  useProgrammeMembers,
  useAddProgrammeMember,
  useUpdateProgrammeMember,
  useRemoveProgrammeMember,
  useBulkRemoveProgrammeMembers,
  useMemberCourseAssignments,
  useUpdateMemberCourseAssignments,
  useUserDirectory,
  useModuleContent,
  useCourseContent,
  useCreateContent,
  useArchiveContent,
  useUploadContent,
  useRecalculationStatus,
  downloadReviewCreditCsv,
  type Course,
  type Module,
  type UploadedFile,
  type ProgrammeMemberRole,
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
import { PendingAssessmentResultsPanel } from '@/components/PendingAssessmentResults';
export function Programmes() {
  const programmes = useProgrammes();
  const updateProgramme = useUpdateProgramme();
  const requestDeletion = useRequestDeletion();
  const [editing, setEditing] = useState<null | { id: string; name: string; type: string; owner: string; slaHours: string }>(null);
  const canManage = ['admin', 'owner'].includes(getSessionUser()?.role ?? '');
  const saveEdit = () => {
    if (!editing || !editing.name) return;
    const slaHours = editing.slaHours.trim() === '' ? null : Number(editing.slaHours);
    if (slaHours !== null && (!Number.isInteger(slaHours) || slaHours < 1 || slaHours > 720)) return;
    updateProgramme.mutate(
      { id: editing.id, patch: { name: editing.name, type: editing.type, owner: editing.owner || undefined, slaHours } },
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
    <PageHeading eyebrow="Programme portfolio" title="Programmes with owners." detail="Every programme has movement, membership, and an accountable owner." action={canCreate ? <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="size-4" />New programme</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create a programme</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Programme name<Input className="mt-2" placeholder="e.g. Leadership Accelerator" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-programme-name" /></label><label className="block text-xs font-semibold">Type<Input className="mt-2" placeholder="e.g. Onboarding" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} data-testid="input-programme-type" /></label><label className="block text-xs font-semibold">Owner (optional)<Input className="mt-2" placeholder="Accountable owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} data-testid="input-programme-owner" /></label><Button className="w-full" disabled={createProgramme.isPending} onClick={submit} data-testid="button-submit-programme">{createProgramme.isPending ? 'Creating-' : 'Create programme'}</Button></div></DialogContent></Dialog> : undefined} />
    {programmes.isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
    : programmes.isError ? <ErrorState retry={() => programmes.refetch()} />
    : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(programmes.data || []).map((p) => <div key={p.id} className="rounded-lg border border-border/80 bg-card p-5 transition-transform hover:-translate-y-0.5"><Link href={`/programmes/${p.id}`} className="block"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><GraduationCap className="size-5" /></div><div className="min-w-0 flex-1"><p className="truncate font-bold">{p.name}</p><p className="text-xs text-muted-foreground">{p.type} - {p.owner}</p></div><Status tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Status></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{p.learnerCount}</p><p className="text-[10px] text-muted-foreground">learners</p></div><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{p.courseCount}</p><p className="text-[10px] text-muted-foreground">courses</p></div><div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{pct(p.progress)}</p><p className="text-[10px] text-muted-foreground">progress</p></div></div><div className="mt-4"><ProgressLine value={p.progress} /></div></Link>{canManage && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditing({ id: p.id, name: p.name, type: p.type, owner: p.owner, slaHours: p.slaHours == null ? '' : String(p.slaHours) })}>Edit</Button><Button size="sm" variant="outline" disabled={requestDeletion.isPending} onClick={() => { setActionError(null); const reason = window.prompt(`Request deletion approval for "${p.name}"? Optionally give a reason:`); if (reason === null) return; requestDeletion.mutate({ programmeId: p.id, reason: reason || undefined }, { onSuccess: () => setActionError(null), onError: (e) => setActionError(`Request failed (${(e as Error).message}).`) }); }}>Request deletion</Button></div>}</div>)}
    </div>}
    {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}
    {!programmes.isLoading && !programmes.isError && !programmes.data?.length && <EmptyState title="No programmes" detail="Programmes will appear here once created." />}
    <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Edit programme</DialogTitle></DialogHeader>{editing && <div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Name<Input className="mt-2" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label><label className="block text-xs font-semibold">Type<Input className="mt-2" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })} /></label><label className="block text-xs font-semibold">Owner<Input className="mt-2" value={editing.owner} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} /></label><label className="block text-xs font-semibold">Response window override (hours)<Input className="mt-2" type="number" min={1} max={720} placeholder="Use workspace default" value={editing.slaHours} onChange={(e) => setEditing({ ...editing, slaHours: e.target.value })} data-testid="input-programme-sla-hours" /></label><Button className="w-full" disabled={updateProgramme.isPending} onClick={saveEdit}>{updateProgramme.isPending ? 'Saving-' : 'Save changes'}</Button></div>}</DialogContent></Dialog>
  </div>;
}

function CourseCard({ course, modules, canAuthorDetail, canManageDetail, onEdit, onDelete }: { course: Course; modules: Module[]; canAuthorDetail: boolean; canManageDetail: boolean; onEdit: () => void; onDelete: () => void }) {
  const content = useCourseContent(course.id);
  const enrolments = useEnrolments();
  const moduleCount = modules.filter((m) => m.courseId === course.id).length;
  const materialCount = (content.data && Array.isArray(content.data.modules) ? content.data.modules.reduce((sum, m) => sum + (m.contentItems?.length ?? 0), 0) : 0);
  const enrolledCount = (enrolments.data || []).filter((e: any) => e.courseId === course.id && e.status !== 'withdrawn').length;
  return <div className="rounded-lg border border-border/70 p-4">
    <div className="flex items-center justify-between gap-3">
      <p className="truncate text-sm font-semibold">{course.title}</p>
      <Status tone={course.status === 'published' ? 'good' : 'warn'}>{course.status}</Status>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{course.category} - {course.trainer || 'Unassigned'}</p>
    <p className="mt-1 text-xs text-muted-foreground">{enrolledCount} learners enrolled</p>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
      <div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{moduleCount}</p><p className="text-[10px] text-muted-foreground">modules</p></div>
      <div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{materialCount}</p><p className="text-[10px] text-muted-foreground">materials</p></div>
      <div className="rounded-lg bg-secondary/55 p-2"><p className="font-bold">{Math.round(course.progress ?? 0)}%</p><p className="text-[10px] text-muted-foreground">progress</p></div>
    </div>
    <div className="mt-3"><ProgressLine value={course.progress} /></div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Link href={`/programmes/${course.programmeId}/courses/${course.id}`} className="inline-flex"><Button size="sm">Manage course</Button></Link>
      {canAuthorDetail && <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>}
      {canManageDetail && <Button size="sm" variant="outline" onClick={onDelete}>Delete</Button>}
    </div>
  </div>;
}

function CourseAssignmentEditor({ programmeId, member, courses, onClose }: { programmeId: string; member: { userId: string; name: string; email: string }; courses: Course[]; onClose: () => void }) {
  const assignments = useMemberCourseAssignments(programmeId, member.userId);
  const update = useUpdateMemberCourseAssignments(programmeId, member.userId);
  const [selected, setSelected] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (assignments.data && !initialized) {
    setSelected(assignments.data.filter((a) => a.assigned).map((a) => a.courseId));
    setInitialized(true);
  }
  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const selectAll = () => setSelected(courses.map((c) => c.id));
  const clearAll = () => setSelected([]);
  const save = () => {
    setMessage(null);
    update.mutate(selected, {
      onSuccess: (res) => { setMessage(`Course assignments updated. This learner is now enrolled in ${res.assignedCount} course${res.assignedCount === 1 ? '' : 's'}.`); },
      onError: (e) => setMessage((e as Error).message),
    });
  };
  return <div className="space-y-4 pt-2">
    <p className="text-xs text-muted-foreground">{member.email}</p>
    {assignments.isLoading ? <p className="text-xs text-muted-foreground">Loading assignments-</p>
    : <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={selectAll}>Select all</Button>
          <Button size="sm" variant="outline" onClick={clearAll}>Clear selection</Button>
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {courses.length === 0 && <p className="text-xs text-muted-foreground">No courses in this programme yet.</p>}
          {courses.map((c) => {
            const a = (assignments.data || []).find((x) => x.courseId === c.id);
            return (
              <label key={c.id} className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} data-testid={`checkbox-course-${c.id}`} />
                <span className="flex-1">{c.title}</span>
                <span className="text-xs text-muted-foreground">{a?.status ?? c.status}</span>
              </label>
            );
          })}
        </div>
      </div>}
    {message && <p className="text-xs text-muted-foreground" data-testid="assignment-message">{message}</p>}
    <div className="flex gap-2">
      <Button className="flex-1" variant="outline" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" disabled={update.isPending} onClick={save} data-testid="button-save-assignments">{update.isPending ? 'Saving-' : 'Save assignments'}</Button>
    </div>
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
  const createCourse = useCreateCourse();
  const createModule = useCreateModule(id);
  const sessionUser = getSessionUser();
  const canAuthorDetail = ['admin', 'owner', 'trainer'].includes(sessionUser?.role ?? '');
  const canManageDetail = ['admin', 'owner'].includes(sessionUser?.role ?? '');
  const members = useProgrammeMembers(id, canAuthorDetail);
  const enrolments = useEnrolments();
  const canCreateDetail = canManageDetail || (sessionUser?.role === 'trainer' && !!sessionUser?.id && (members.data || []).some((m) => m.userId === sessionUser.id && ['trainer', 'admin', 'owner'].includes(m.role)));
  const addMember = useAddProgrammeMember(id);
  const updateMember = useUpdateProgrammeMember(id);
  const removeMember = useRemoveProgrammeMember(id);
  const bulkRemove = useBulkRemoveProgrammeMembers(id);
  const requestDelete = (target: 'courses' | 'modules', id: string, label: string) => { const reason = window.prompt(`Request deletion approval for "${label}"? A second admin must approve:`); if (reason === null) return; requestContentDeletion.mutate({ target, id, reason: reason || undefined }, { onSuccess: refreshDetail }); };
  const dqc = useQueryClient();
  const [editingCourse, setEditingCourse] = useState<null | { id: string; title: string; category: string; trainer: string }>(null);
  const [editingModule, setEditingModule] = useState<null | { id: string; title: string }>(null);
  const [contentModule, setContentModule] = useState<null | { id: string; title: string; courseId: string }>(null);
  const [editingMember, setEditingMember] = useState<null | { userId: string; name: string; email: string; roles: ProgrammeMemberRole[] }>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [courseAssignMember, setCourseAssignMember] = useState<null | { userId: string; name: string; email: string }>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberForm, setMemberForm] = useState<{ userId: string; name: string; email: string; roles: ProgrammeMemberRole[] }>({ userId: '', name: '', email: '', roles: ['learner'] });
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberEditError, setMemberEditError] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<null | { userId: string; name: string; email: string; role: ProgrammeMemberRole }>(null);
  const [memberRemoveError, setMemberRemoveError] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<null | { pendingApproval: boolean; removed: number; withdrawn: number; coursesUnassigned: number }>(null);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', category: 'General', trainerId: '' });
  const [courseError, setCourseError] = useState<string | null>(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [moduleForm, setModuleForm] = useState({ courseId: '', title: '' });
  const [moduleError, setModuleError] = useState<string | null>(null);
  const memberIds = useMemo(() => Array.from(new Set((members.data || []).map((m) => m.userId))), [members.data]);
  const allSelected = memberIds.length > 0 && selectedMembers.length === memberIds.length;
  const toggleMemberSelection = (userId: string) => setSelectedMembers((current) => current.includes(userId) ? current.filter((x) => x !== userId) : [...current, userId]);
  const directory = useUserDirectory(memberSearch, memberOpen && canManageDetail);
  const availableUsers = useMemo(() => {
    const existing = new Set((members.data || []).map((m) => m.userId));
    return (directory.data || []).filter((u) => !existing.has(u.id));
  }, [directory.data, members.data]);
  const submitMember = () => {
    if (!memberForm.userId) return;
    setMemberError(null);
    if (!memberForm.roles.length) { setMemberError('Select at least one role.'); return; }
    addMember.mutate({ userId: memberForm.userId, roles: memberForm.roles }, {
      onSuccess: () => { setMemberOpen(false); setMemberForm({ userId: '', name: '', email: '', roles: ['learner'] }); setMemberSearch(''); },
      onError: (e) => setMemberError((e as Error).message),
    });
  };
  const saveMember = () => {
    if (!editingMember) return;
    setMemberEditError(null);
    updateMember.mutate({ userId: editingMember.userId, name: editingMember.name, roles: editingMember.roles }, {
      onSuccess: () => setEditingMember(null),
      onError: (e) => setMemberEditError((e as Error).message),
    });
  };
  const confirmRemoveMember = () => {
    if (!removingMember) return;
    setMemberRemoveError(null);
    removeMember.mutate(removingMember.userId, {
      onSuccess: () => setRemovingMember(null),
      onError: (e) => setMemberRemoveError((e as Error).message),
    });
  };
  const confirmBulkRemove = () => {
    setBulkError(null);
    bulkRemove.mutate(selectedMembers, {
      onSuccess: (res) => {
        setBulkOpen(false);
        setSelectedMembers([]);
        setBulkResult({
          pendingApproval: !!res.pendingApproval,
          removed: res.removed ?? 0,
          withdrawn: res.withdrawn ?? 0,
          coursesUnassigned: res.coursesUnassigned ?? 0,
        });
      },
      onError: (e) => setBulkError((e as Error).message),
    });
  };
  const trainerNames = useMemo(() => {
    const names = (members.data || []).filter((m) => m.role === 'trainer').map((m) => m.name);
    if (editingCourse?.trainer && !names.includes(editingCourse.trainer)) names.unshift(editingCourse.trainer);
    return Array.from(new Set(names));
  }, [members.data, editingCourse]);
  const trainerOptions = useMemo(() => {
    const seen = new Set<string>();
    return (members.data || []).filter((m) => m.role === 'trainer' && !seen.has(m.userId) && !!seen.add(m.userId)).map((m) => ({ userId: m.userId, name: m.name }));
  }, [members.data]);
  const refreshDetail = () => { dqc.invalidateQueries({ queryKey: ['courses'] }); dqc.invalidateQueries({ queryKey: ['programmes'] }); dqc.invalidateQueries({ queryKey: ['programme-members', id] }); };
  const submitCourse = () => {
    setCourseError(null);
    const title = courseForm.title.trim();
    if (!title) { setCourseError('Course title is required.'); return; }
    createCourse.mutate(
      { title, programmeId: id, category: courseForm.category.trim() || 'General', ...(courseForm.trainerId ? { trainerId: courseForm.trainerId } : {}) },
      {
        onSuccess: () => { refreshDetail(); setCourseOpen(false); setCourseForm({ title: '', category: 'General', trainerId: '' }); },
        onError: (e) => setCourseError((e as Error).message),
      },
    );
  };
  const submitModule = () => {
    setModuleError(null);
    const title = moduleForm.title.trim();
    if (!moduleForm.courseId) { setModuleError('Select a course in this programme first.'); return; }
    if (!title) { setModuleError('Module title is required.'); return; }
    createModule.mutate(
      { courseId: moduleForm.courseId, title },
      {
        onSuccess: () => { refreshDetail(); setModuleOpen(false); setModuleForm({ courseId: '', title: '' }); },
        onError: (e) => setModuleError((e as Error).message),
      },
    );
  };
  const programme = programmes.data?.find((p) => p.id === id);
  return <div className="page-in">
    <PageHeading eyebrow="Programme detail" title={programme?.name || 'Programme'} detail={programme ? `${programme.type} - ${programme.owner} - ${programme.learnerCount} learners` : 'Loading programme-'} action={<Link href="/programmes" className="text-xs font-semibold text-primary hover:underline">Back to portfolio</Link>} />
    {programmes.isLoading || courses.isLoading ? <Skeleton className="h-64" />
    : programmes.isError || courses.isError ? <ErrorState retry={() => { programmes.refetch(); courses.refetch(); }} />
    : !programme ? <EmptyState title="Programme not found" detail="It may have been archived." />
    : <div className="space-y-5"><PendingAssessmentResultsPanel /><div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5"><div className="flex items-start justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Courses in this programme</p>{canCreateDetail && <Button size="sm" onClick={() => { setCourseError(null); setCourseOpen(true); }} data-testid="button-add-course"><Plus className="size-4" />Add course</Button>}</div>
        <div className="mt-4 space-y-3">{(courses.data || []).map((c) => <CourseCard key={c.id} course={c} modules={modules.data || []} canAuthorDetail={canAuthorDetail} canManageDetail={canManageDetail} onEdit={() => setEditingCourse({ id: c.id, title: c.title, category: c.category, trainer: c.trainer })} onDelete={() => requestDelete('courses', c.id, c.title)} />)}
        {!courses.data?.length && <EmptyState title="No courses yet" detail="Create the first course to start organising modules and learning materials." />}</div>
        <Dialog open={!!editingCourse} onOpenChange={(v) => { if (!v) setEditingCourse(null); }}><DialogContent><DialogHeader><DialogTitle>Edit course</DialogTitle></DialogHeader>{editingCourse && <div className="space-y-4 pt-2"><label className="block text-xs font-semibold">Title<Input className="mt-2" value={editingCourse.title} onChange={(e) => setEditingCourse({ ...editingCourse, title: e.target.value })} /></label><label className="block text-xs font-semibold">Category<Input className="mt-2" value={editingCourse.category} onChange={(e) => setEditingCourse({ ...editingCourse, category: e.target.value })} /></label><label className="block text-xs font-semibold">Trainer<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={editingCourse.trainer} onChange={(e) => setEditingCourse({ ...editingCourse, trainer: e.target.value })} data-testid="select-course-trainer"><option value="">Unassigned</option>{trainerNames.map((name) => <option value={name} key={name}>{name}</option>)}</select>{!trainerNames.length && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">No trainers in this programme yet - add one under Members.</span>}</label><Button className="w-full" disabled={updateCourse.isPending} onClick={() => updateCourse.mutate({ id: editingCourse.id, patch: { title: editingCourse.title, category: editingCourse.category, trainer: editingCourse.trainer } }, { onSuccess: () => { refreshDetail(); setEditingCourse(null); } })}>{updateCourse.isPending ? 'Saving-' : 'Save changes'}</Button></div>}</DialogContent></Dialog>
        <Dialog open={courseOpen} onOpenChange={(v) => { setCourseOpen(v); if (!v) { setCourseError(null); setCourseForm({ title: '', category: 'General', trainerId: '' }); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add course</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <label className="block text-xs font-semibold">Course title<Input className="mt-2" placeholder="e.g. Induction" value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} data-testid="input-course-title" /></label>
              <label className="block text-xs font-semibold">Category<Input className="mt-2" placeholder="General" value={courseForm.category} onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })} data-testid="input-course-category" /></label>
              <label className="block text-xs font-semibold">Assigned trainer<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={courseForm.trainerId} onChange={(e) => setCourseForm({ ...courseForm, trainerId: e.target.value })} data-testid="select-course-trainer-create"><option value="">Unassigned</option>{trainerOptions.map((t) => <option value={t.userId} key={t.userId}>{t.name}</option>)}</select>{!trainerOptions.length && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">No trainers in this programme yet - leave this unassigned or add one under Members.</span>}</label>
              {courseError && <p className="text-xs text-destructive" data-testid="course-form-error">{courseError}</p>}
              <Button className="w-full" disabled={createCourse.isPending} onClick={submitCourse} data-testid="button-submit-course">{createCourse.isPending ? 'Adding-' : 'Add course'}</Button>
            </div>
          </DialogContent>
        </Dialog></section>
      <section className="rounded-lg border border-border/80 bg-card p-5"><div className="flex items-start justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Course content</p><p className="text-xs text-muted-foreground">Open a course to manage its modules and learning materials.</p></div></section>
      <section className="rounded-lg border border-border/80 bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Members</p>
            <p className="mt-1 text-xs text-muted-foreground">Trainers, learners and stakeholders assigned to this programme.</p>
          </div>
          {canManageDetail && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {selectedMembers.length > 0 && <Button size="sm" variant="destructive" onClick={() => { setBulkError(null); setBulkOpen(true); }} data-testid="button-bulk-remove">Remove selected ({selectedMembers.length})</Button>}
          <Dialog open={memberOpen} onOpenChange={(v) => { setMemberOpen(v); if (!v) { setMemberError(null); setMemberSearch(''); setMemberForm({ userId: '', name: '', email: '', roles: ['learner'] }); } }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="size-4" />Add member</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add programme member</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <label className="block text-xs font-semibold">Search the organization directory<Input className="mt-2" placeholder="Name, email or department" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} data-testid="input-member-search" /></label>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border/70 p-1" data-testid="list-member-directory">
                  {directory.isLoading ? <p className="p-2 text-xs text-muted-foreground">Loading directory-</p>
                  : directory.isError ? <p className="p-2 text-xs text-destructive">{(directory.error as Error)?.message ?? 'Could not load the directory.'}</p>
                  : !availableUsers.length ? <p className="p-2 text-xs text-muted-foreground">No matching people available to add.</p>
                  : availableUsers.map((u) => (
                    <button key={u.id} type="button" onClick={() => setMemberForm({ ...memberForm, userId: u.id, name: u.name, email: u.email })} className={cn('w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary/60', memberForm.userId === u.id && 'bg-primary/10 ring-1 ring-primary/40')} data-testid={`option-member-${u.id}`}>
                      <span className="font-semibold">{u.name}</span>
                      <span className="block text-xs font-normal text-muted-foreground">{u.email}{u.department ? ` - ${u.department}` : ''}</span>
                    </button>
                  ))}
                </div>
                {memberSearch.trim() && !directory.isLoading && !availableUsers.length && <p className="text-xs text-muted-foreground">Not in the directory? {getSessionUser()?.isOrgStaff ? <>Add them under <Link href="/people" className="font-semibold text-primary hover:underline">People</Link> first, then grant a role here.</> : 'Ask an organization administrator to add them under People first.'}</p>}
                <div className="block text-xs font-semibold">Roles<span className="ml-1 font-normal text-muted-foreground">(select all that apply)</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(['learner', 'trainer', 'stakeholder', 'admin'] as ProgrammeMemberRole[]).map((r) => (
                      <label key={r} className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs font-normal capitalize">
                        <input
                          type="checkbox"
                          checked={memberForm.roles.includes(r)}
                          onChange={(e) => setMemberForm({ ...memberForm, roles: e.target.checked ? [...memberForm.roles, r] : memberForm.roles.filter((x) => x !== r) })}
                          data-testid={`checkbox-member-role-${r}`}
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                </div>
                {memberError && <p className="text-xs text-destructive">{memberError}</p>}
                <Button className="w-full" disabled={addMember.isPending || !memberForm.userId} onClick={submitMember} data-testid="button-submit-member">{addMember.isPending ? 'Adding-' : 'Add member'}</Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>}
        </div>
        {bulkResult && <div className="mt-3 rounded-md border border-border/70 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground" data-testid="bulk-remove-result">
          {bulkResult.pendingApproval
            ? <>This removal needs a second administrator's approval. <Link href="/governance" className="font-semibold text-primary hover:underline">Open the pending request in Governance</Link>.</>
            : <>Removed {bulkResult.removed} grant(s), withdrew {bulkResult.withdrawn} enrolment(s) and unassigned {bulkResult.coursesUnassigned} course(s).</>}
        </div>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border/70 text-left font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{canManageDetail && <th className="w-8 py-2 pr-2"><input type="checkbox" aria-label="Select all members" checked={allSelected} onChange={(e) => setSelectedMembers(e.target.checked ? memberIds : [])} data-testid="checkbox-select-all-members" /></th>}<th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Assigned courses</th><th className="py-2 text-right">Actions</th></tr></thead>
            <tbody>
              {(members.data || []).map((m) => <tr key={`${m.userId}-${m.role}`} className="border-b border-border/50 last:border-0">
                {canManageDetail && <td className="py-2 pr-2"><input type="checkbox" aria-label={`Select ${m.name}`} checked={selectedMembers.includes(m.userId)} onChange={() => toggleMemberSelection(m.userId)} data-testid={`checkbox-select-member-${m.userId}`} /></td>}
                <td className="py-2 pr-3 font-medium">{m.name}</td>
                <td className="py-2 pr-3 text-muted-foreground">{m.email}</td>
<td className="py-2 pr-3"><Status tone={m.role === 'admin' ? 'good' : 'neutral'}>{m.role}</Status></td>
<td className="py-2 pr-3">{m.role === 'learner' ? (() => { const count = (enrolments.data || []).filter((e: any) => e.learnerId === m.userId && e.status !== 'withdrawn').length; return <span className="text-xs text-muted-foreground">{count} of {courses.data?.length ?? 0}</span>; })() : <span className="text-xs text-muted-foreground">—</span>}</td>
<td className="py-2 text-right"><div className="flex justify-end gap-2">
{m.role === 'learner' && canAuthorDetail && <Button size="sm" variant="outline" onClick={() => { setCourseAssignMember({ userId: m.userId, name: m.name, email: m.email }); }} data-testid={`button-manage-courses-${m.userId}`}>Manage courses</Button>}
{canManageDetail && <><Button size="sm" variant="outline" onClick={() => { setMemberEditError(null); setEditingMember({ userId: m.userId, name: m.name, email: m.email, roles: [m.role as ProgrammeMemberRole] }); }}>Edit</Button><Button size="sm" variant="outline" onClick={() => { setMemberRemoveError(null); setRemovingMember({ userId: m.userId, name: m.name, email: m.email, role: m.role as ProgrammeMemberRole }); }}>Remove</Button></>}</div></td>
              </tr>)}
            </tbody>
          </table>
          {!members.data?.length && <div className="py-3"><EmptyState title="No members yet" detail="Add trainers, learners or stakeholders to this programme." /></div>}
        </div>
        <Dialog open={!!editingMember} onOpenChange={(v) => { if (!v) { setEditingMember(null); setMemberEditError(null); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit programme member</DialogTitle></DialogHeader>
            {editingMember && <div className="space-y-4 pt-2">
              <label className="block text-xs font-semibold">Email<Input className="mt-2" value={editingMember.email} disabled /></label>
              <label className="block text-xs font-semibold">Name<Input className="mt-2" value={editingMember.name} onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })} data-testid="input-edit-member-name" /></label>
              <div className="block text-xs font-semibold">Roles<span className="ml-1 font-normal text-muted-foreground">(select all that apply)</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['learner', 'trainer', 'stakeholder', 'admin'] as ProgrammeMemberRole[]).map((r) => (
                    <label key={r} className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs font-normal capitalize">
                      <input
                        type="checkbox"
                        checked={editingMember.roles.includes(r)}
                        onChange={(e) => setEditingMember({ ...editingMember, roles: e.target.checked ? [...editingMember.roles, r] : editingMember.roles.filter((x) => x !== r) })}
                        data-testid={`checkbox-edit-member-role-${r}`}
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              {memberEditError && <p className="text-xs text-destructive">{memberEditError}</p>}
              <Button className="w-full" disabled={updateMember.isPending || !editingMember.name.trim()} onClick={saveMember} data-testid="button-save-member">{updateMember.isPending ? 'Saving-' : 'Save changes'}</Button>
            </div>}
          </DialogContent>
        </Dialog>
        <Dialog open={!!removingMember} onOpenChange={(v) => { if (!v) { setRemovingMember(null); setMemberRemoveError(null); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Remove programme member</DialogTitle></DialogHeader>
            {removingMember && <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">Remove <span className="font-semibold text-foreground">{removingMember.name}</span> ({removingMember.email}) from this programme? Their role and programme enrolments will be deleted.</p>
              {removingMember.role === 'trainer' && <p className="text-xs text-muted-foreground">Courses assigned to this trainer will be set to Unassigned.</p>}
              {memberRemoveError && <p className="text-xs text-destructive">{memberRemoveError}</p>}
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={() => { setRemovingMember(null); setMemberRemoveError(null); }}>Cancel</Button>
                <Button className="flex-1" variant="destructive" disabled={removeMember.isPending} onClick={confirmRemoveMember} data-testid="button-confirm-remove-member">{removeMember.isPending ? 'Removing-' : 'Remove member'}</Button>
              </div>
            </div>}
          </DialogContent>
        </Dialog>
        <Dialog open={bulkOpen} onOpenChange={(v) => { if (!v) { setBulkOpen(false); setBulkError(null); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Remove selected members</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">Remove <span className="font-semibold text-foreground">{selectedMembers.length}</span> people from this programme? Their grants are deleted and their enrolments withdrawn. Courses assigned to a removed trainer are set to Unassigned.</p>
              <p className="text-xs text-muted-foreground">Large removals may need a second administrator's approval. If this one does, it is queued in Governance and nobody is removed until it is approved.</p>
              {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
                <Button className="flex-1" variant="destructive" disabled={bulkRemove.isPending || !selectedMembers.length} onClick={confirmBulkRemove} data-testid="button-confirm-bulk-remove">{bulkRemove.isPending ? 'Removing-' : `Remove ${selectedMembers.length}`}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </section>
      <section className="rounded-lg border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Workspace detail</p><h2 className="mt-1 text-base font-bold">Progress {pct(programme.progress)}</h2><div className="mt-4"><ProgressLine value={programme.progress} color="bg-emerald-600" /></div><div className="mt-4 space-y-2 text-sm"><p className="flex justify-between"><span className="text-muted-foreground">Status</span><Status tone={programme.status === 'active' ? 'good' : 'neutral'}>{programme.status}</Status></p><p className="flex justify-between"><span className="text-muted-foreground">Learners</span><span className="font-semibold">{programme.learnerCount}</span></p><p className="flex justify-between"><span className="text-muted-foreground">Courses</span><span className="font-semibold">{programme.courseCount}</span></p><p className="flex justify-between"><span className="text-muted-foreground">Owner</span><span className="font-semibold">{programme.owner}</span></p></div></section>
    </div></div>}
    <Dialog open={!!courseAssignMember} onOpenChange={(v) => { if (!v) setCourseAssignMember(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Manage courses{courseAssignMember ? ` - ${courseAssignMember.name}` : ''}</DialogTitle></DialogHeader>
        {courseAssignMember && <CourseAssignmentEditor programmeId={id} member={courseAssignMember} courses={courses.data || []} onClose={() => setCourseAssignMember(null)} />}
      </DialogContent>
    </Dialog>
    <Dialog open={!!contentModule} onOpenChange={(v) => { if (!v) setContentModule(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{contentModule ? `Manage learning materials - ${contentModule.title}` : 'Manage learning materials'}</DialogTitle></DialogHeader>
        {contentModule && <ModuleContentManager moduleId={contentModule.id} moduleTitle={contentModule.title} courseId={contentModule.courseId} />}
      </DialogContent>
    </Dialog>
  </div>;
}

export function CourseContentManager({ id, courseId: courseIdProp, programmeId: programmeIdProp }: { id?: string; courseId?: string; programmeId?: string } = {}) {
  const cid = courseIdProp ?? id ?? '';
  const courses = useCourses();
  const course = (courses.data || []).find((c) => c.id === cid);
  const programmeId = programmeIdProp ?? course?.programmeId ?? '';
  const programmes = useProgrammes();
  const programme = programmes.data?.find((p) => p.id === (programmeId || course?.programmeId));
  const content = useCourseContent(cid);
  const programmeModules = useModules(programmeId || '', !!programmeId);
  const modulesFromProgramme = (programmeModules.data || []).filter((m) => m.courseId === cid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const modulesFromContent = (content.data?.modules ?? []).map((m) => ({ id: m.id, courseId: cid, title: m.title, order: m.order, contentItems: m.contentItems }));
  const modules: any[] = (modulesFromProgramme.length ? modulesFromProgramme : modulesFromContent).map((m: any) => ({ ...m }));
  const createModule = useCreateModule(programmeId || cid);
  const updateModule = useUpdateModule();
  const requestContentDeletion = useRequestContentDeletion();
  const qc = useQueryClient();
  const sessionUser = getSessionUser();
  const canAuthor = ['admin', 'owner', 'trainer'].includes(sessionUser?.role ?? '');
  const canManage = ['admin', 'owner'].includes(sessionUser?.role ?? '');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moduleOpen, setModuleOpen] = useState(false);
  const [moduleTitle, setModuleTitle] = useState('');
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<null | { id: string; title: string }>(null);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const expandAll = () => setExpanded(new Set(modules.map((m) => m.id)));
  const collapseAll = () => setExpanded(new Set());

  const submitModule = () => {
    if (!moduleTitle.trim()) { setModuleError('Module title is required.'); return; }
    if (!programmeId) { setModuleError('Course programme is unavailable.'); return; }
    createModule.mutate(
      { courseId: cid, title: moduleTitle.trim() },
      {
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['course-content', cid] }); setModuleOpen(false); setModuleTitle(''); setModuleError(null); },
        onError: (e) => setModuleError((e as Error).message),
      },
    );
  };

  const moveModule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;
    const a = modules[index];
    const b = modules[target];
    updateModule.mutate({ id: a.id, patch: { order: target } });
    updateModule.mutate({ id: b.id, patch: { order: index } });
  };

  if (courses.isLoading || content.isLoading) return <div className="page-in"><Skeleton className="h-64" /></div>;
  if (!course) return <div className="page-in"><EmptyState title="Course not found" detail="It may have been removed." /></div>;

  return <div className="page-in">
    <PageHeading eyebrow="Course content" title={course.title} detail="Organise the modules and learning materials learners will work through." action={<Link href="/programmes" className="text-xs font-semibold text-primary hover:underline">Back to programmes</Link>} />
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{programme?.name ?? course.programmeName}</span>
      <span>-</span>
      <span>{modules.length} module{modules.length === 1 ? '' : 's'}</span>
      <span>-</span>
      <span>{modules.reduce((s, m) => s + (m.contentItems?.length ?? 0), 0)} learning materials</span>
    </div>
    <div className="mb-4 flex flex-wrap gap-2">
      <Button size="sm" onClick={() => { setModuleError(null); setModuleOpen(true); }} data-testid="button-add-module"><Plus className="size-4" />Add module</Button>
      <Button size="sm" variant="outline" onClick={expandAll} data-testid="button-expand-all">Expand all</Button>
      <Button size="sm" variant="outline" onClick={collapseAll} data-testid="button-collapse-all">Collapse all</Button>
    </div>
    <div className="space-y-3">
      {modules.length === 0 && <EmptyState title="No modules yet" detail="Add the first module to start organising content." />}
      {modules.map((m, index) => {
        const isOpen = expanded.has(m.id);
        const itemCount = m.contentItems?.length ?? 0;
        return <div key={m.id} className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => toggle(m.id)} aria-expanded={isOpen} data-testid={`button-toggle-module-${m.id}`}>
              <span className="text-sm font-semibold">{isOpen ? '▾' : '▸'}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{m.title}</p>
                <p className="text-xs text-muted-foreground">Module {index + 1} · {itemCount === 0 ? 'No learning materials added yet.' : `${itemCount} learning material${itemCount === 1 ? '' : 's'}`}</p>
              </div>
            </button>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => moveModule(index, -1)} disabled={index === 0} aria-label="Move module up">Up</Button>
              <Button size="sm" variant="outline" onClick={() => moveModule(index, 1)} disabled={index === modules.length - 1} aria-label="Move module down">Down</Button>
              {canAuthor && <Button size="sm" variant="outline" onClick={() => setEditingModule({ id: m.id, title: m.title })}>Edit</Button>}
              {canManage && <Button size="sm" variant="outline" onClick={() => requestContentDeletion.mutate({ target: 'modules', id: m.id, reason: undefined }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['course-content', cid] }) })}>Delete</Button>}
            </div>
          </div>
          {isOpen && <div className="mt-3 border-t border-border/60 pt-3">
            <ModuleContentManager moduleId={m.id} moduleTitle={m.title} courseId={cid} />
          </div>}
        </div>;
      })}
    </div>
    <Dialog open={moduleOpen} onOpenChange={(v) => { setModuleOpen(v); if (!v) { setModuleError(null); setModuleTitle(''); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add module</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <label className="block text-xs font-semibold">Module title<Input className="mt-2" value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} data-testid="input-module-title" /></label>
          {moduleError && <p className="text-xs text-destructive" data-testid="module-form-error">{moduleError}</p>}
          <Button className="w-full" disabled={createModule.isPending} onClick={submitModule} data-testid="button-submit-module">{createModule.isPending ? 'Adding-' : 'Add module'}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!editingModule} onOpenChange={(v) => { if (!v) setEditingModule(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit module</DialogTitle></DialogHeader>
        {editingModule && <div className="space-y-4 pt-2">
          <label className="block text-xs font-semibold">Title<Input className="mt-2" value={editingModule.title} onChange={(e) => setEditingModule({ ...editingModule, title: e.target.value })} /></label>
          <Button className="w-full" disabled={updateModule.isPending} onClick={() => updateModule.mutate({ id: editingModule.id, patch: { title: editingModule.title } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: ['course-content', cid] }); setEditingModule(null); } })}>{updateModule.isPending ? 'Saving-' : 'Save changes'}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}

// alias for compatibility
export const CourseContentView = CourseContentManager;
export const CourseContent = CourseContentManager;

export function ModuleContentManager({ moduleId, moduleTitle, courseId }: { moduleId: string; moduleTitle: string; courseId: string }) {
  const content = useModuleContent(moduleId);
  const create = useCreateContent(moduleId, courseId);
  const archive = useArchiveContent(moduleId, courseId);
  const upload = useUploadContent(moduleId);
  const [recalcActive, setRecalcActive] = useState(false);
  const recalculation = useRecalculationStatus(courseId, recalcActive, 2000);
  const [type, setType] = useState<'native' | 'file' | 'external_link'>('native');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [completionMode, setCompletionMode] = useState<'trainer_verified' | 'self_report'>('trainer_verified');
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const reset = () => { setTitle(''); setBody(''); setUrl(''); setUploaded(null); setError(null); };
  const submit = async () => {
    setError(null);
    if (!title.trim()) { setError('Title is required.'); return; }
    if (type === 'file' && !uploaded) { setError('Upload a file first.'); return; }
    if (type === 'external_link' && !/^https:\/\//i.test(url)) { setError('A valid https URL is required.'); return; }
    create.mutate({
      type, title: title.trim(), required,
      body: type === 'native' ? body : undefined,
      url: type === 'external_link' ? url : undefined,
      completionMode: type === 'external_link' ? completionMode : undefined,
      // A.3: the item points at the org-bound upload, not at a key copied from the response.
      ...(uploaded ? { storedFileId: uploaded.storedFileId } : {}),
    }, {
      onSuccess: (item) => { reset(); if (item.required) setRecalcActive(true); },
      onError: (e) => setError((e as Error).message),
    });
  };
  return <div className="space-y-4 pt-2">
    <p className="text-xs text-muted-foreground">{moduleTitle} - learners see items in this order.</p>
    {recalcActive && <div data-testid="recalculation-status" className="rounded-lg border border-border/60 bg-secondary/40 p-3 text-xs">
      {recalculation.isError ? `Could not check recalculation: ${(recalculation.error as Error)?.message ?? 'unknown error'}`
        : recalculation.data?.stale || recalculation.data?.job?.status === 'failed'
          ? `Recalculation stalled${recalculation.data?.lastError ? `: ${recalculation.data.lastError}` : ''}. Check the evaluation queue.`
          : recalculation.data?.pending === false
            ? 'Recalculation complete — course progress is up to date.'
            : `Recalculating… ${recalculation.data?.job?.status ?? 'queued'} · ${recalculation.data?.attempts ?? 0} attempt(s)`}
    </div>}
    <div className="space-y-2">
      {content.isLoading ? <p className="text-xs text-muted-foreground">Loading learning materials-</p>
      : !content.data?.length ? <p className="text-xs text-muted-foreground">No learning materials added yet.</p>
      : content.data.map((item, index) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border/70 p-2 text-xs">
        <span className="min-w-0 truncate"><span className="font-semibold">{index + 1}. {item.title}</span> <span className="text-muted-foreground">- {item.type === 'native' ? 'Text lesson' : item.type === 'file' ? 'Document' : 'External resource'}{item.required ? ' - required' : ' - optional'}</span></span>
        <Button size="sm" variant="outline" onClick={() => archive.mutate(item.id, { onSuccess: () => setRecalcActive(true) })} disabled={archive.isPending}>Archive</Button>
      </div>)}
    </div>
    <div className="rounded-lg border border-border/70 p-4">
      <p className="text-sm font-semibold">Add learning material</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-semibold">Type<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={type} onChange={(e) => setType(e.target.value as 'native' | 'file' | 'external_link')} data-testid="select-content-type">
          <option value="native">Text lesson</option><option value="file">Upload a document</option><option value="external_link">Add an external resource</option>
        </select></label>
        <label className="block text-xs font-semibold">Title<Input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-content-title" /></label>
      </div>
      {type === 'native' && <label className="mt-3 block text-xs font-semibold">Body<Textarea className="mt-2" value={body} onChange={(e) => setBody(e.target.value)} /></label>}
      {type === 'file' && <div className="mt-3 space-y-2">
        <label className="block text-xs font-semibold">File (pdf, office, image, video, zip; max 50MB)<input className="mt-2 block w-full text-sm" type="file" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file, { onSuccess: setUploaded, onError: (err) => setError((err as Error).message) }); }} data-testid="input-content-file" /></label>
        {upload.isPending && <p className="text-xs text-muted-foreground">Uploading-</p>}
        {uploaded && <p className="text-xs text-emerald-700">Uploaded {uploaded.fileName} ({Math.round(uploaded.sizeBytes / 1024)} KB)</p>}
      </div>}
      {type === 'external_link' && <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-semibold">https URL<Input className="mt-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://-" data-testid="input-content-url" /></label>
        <label className="block text-xs font-semibold">Completion<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={completionMode} onChange={(e) => setCompletionMode(e.target.value as 'trainer_verified' | 'self_report')}>
          <option value="trainer_verified">Trainer verified (evidence)</option><option value="self_report">Learner self-report</option>
        </select></label>
      </div>}
      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required for completion</label>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{type === 'native' ? 'A text lesson written directly in TrainHub360.' : type === 'file' ? 'Upload a document, image, video or other file.' : 'Link to an external website or resource.'}</p>
      <Button className="mt-3 w-full" onClick={submit} disabled={create.isPending || upload.isPending} data-testid="button-add-content">{create.isPending ? 'Adding-' : 'Add learning material'}</Button>
    </div>
  </div>;
}








