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
  useCourseAssessments,
  useStartAttempt,
  useSubmitAttemptAnswers,
  useCreateAssessment,
  useModuleAssessments,
  useAssessment,
  useCreateQuestion,
  usePublishAssessment,
  downloadReviewCreditCsv,
  type Course,
  type StartedAttempt,
  type AttemptSubmission,
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
export function Assessments() {
  const courses = useCourses();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: Course | null = courses.data?.find((c) => c.id === selectedId) || null;
  const assessments = useCourseAssessments(selected?.id || '', !!selected);
  const startAttempt = useStartAttempt(selected?.id);
  const submitAttempt = useSubmitAttemptAnswers(selected?.id || '');
  const [attempt, setAttempt] = useState<import('@/api/hooks').StartedAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<import('@/api/hooks').AttemptSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAuthor = ['admin', 'owner', 'trainer'].includes(getSessionUser()?.role ?? '');

  const toggleOption = (questionId: string, optionId: string, type: string) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (type === 'recall') return { ...prev, [questionId]: [optionId] };
      return { ...prev, [questionId]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] };
    });
  };

  const submit = () => {
    if (!attempt) return;
    submitAttempt.mutate({
      attemptId: attempt.attemptId,
      answers: Object.entries(answers).map(([questionId, optionIds]) => ({ questionId, optionIds })),
    }, { onSuccess: (data) => setResult(data), onError: (e) => setError((e as Error).message) });
  };

  return <div className="page-in">
    <PageHeading eyebrow="Competence assurance" title="Assessments with evidence." detail="A passing completion is not the same as competence. Scores are calculated from stored answers, never typed in." />
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5">
        <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Assessment queue</p><h2 className="mt-1 text-base font-bold">Courses ready for review</h2></div><Status tone="warn">{courses.data?.length || 0} courses</Status></div>
        {courses.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        : courses.isError ? <div className="mt-4"><ErrorState retry={() => courses.refetch()} /></div>
        : <div className="mt-4 space-y-2">{courses.data?.map((course) => <button key={course.id} onClick={() => { setSelectedId(course.id); setResult(null); setAttempt(null); setError(null); }} className={cn('w-full rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/35', selected?.id === course.id ? 'border-primary/50 bg-primary/5' : 'border-border/70')}><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-accent/25 text-primary"><Target className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{course.title}</p><p className="mt-1 text-xs text-muted-foreground">{course.programmeName} - pass mark from assessment</p></div></div></button>)}</div>}
        {!courses.data?.length && !courses.isLoading && !courses.isError && <div className="mt-4"><EmptyState title="Assessment queue is clear" detail="New courses will appear here when ready for evidence." /></div>}
      </section>
      <section className="rounded-lg border border-primary/20 bg-primary p-5 text-primary-foreground">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Submission panel</p>
        <h2 className="mt-1 text-base font-bold">{selected ? selected.title : 'Select a course'}</h2>
        {!selected ? <p className="mt-3 text-sm text-primary-foreground/70">Choose a course from the queue to start an assessment.</p>
        : result ? <div className="mt-4 rounded-lg bg-primary-foreground/10 p-4 text-sm"><p className="font-bold">{result.passed ? 'Passed' : 'Not passed'} - {result.score}%</p><p className="mt-1 text-xs text-primary-foreground/70">{result.earnedPoints}/{result.totalPoints} points - pass mark {result.passMark}% - {result.competenceMet ? 'competence met' : 'competence not yet met'}</p><Button variant="secondary" className="mt-3 w-full" onClick={() => { setResult(null); setAttempt(null); }}>Close</Button></div>
        : attempt ? <>
          <p className="mt-1 text-xs text-primary-foreground/65">Attempt {attempt.attemptNumber}{attempt.expiresAt ? ` - ends ${new Date(attempt.expiresAt).toLocaleTimeString()}` : ''}</p>
          <div className="mt-4 max-h-[420px] space-y-4 overflow-y-auto">
            {attempt.questions.map((q) => <div key={q.id} className="rounded-lg bg-primary-foreground/10 p-3"><p className="text-sm font-semibold">{q.prompt}</p><div className="mt-2 space-y-1">{q.options.map((o) => <label key={o.id} className="flex items-center gap-2 text-xs"><input type={q.type === 'recall' ? 'radio' : 'checkbox'} name={q.id} checked={(answers[q.id] ?? []).includes(o.id)} onChange={() => toggleOption(q.id, o.id, q.type)} />{o.text}</label>)}</div></div>)}
          </div>
          <Button variant="secondary" className="mt-4 w-full" disabled={submitAttempt.isPending} onClick={submit}>{submitAttempt.isPending ? 'Scoring...' : 'Submit answers'}</Button>
        </> : <>
          <p className="mt-1 text-xs text-primary-foreground/65">{selected.programmeName}</p>
          <div className="mt-4 space-y-2">
            {assessments.isLoading ? <p className="text-xs text-primary-foreground/70">Loading assessments-</p>
            : !assessments.data?.length ? <p className="text-xs text-primary-foreground/70">No published assessments for this course yet.</p>
            : assessments.data.map((a) => <div key={a.id} className="rounded-lg bg-primary-foreground/10 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold">{a.title || `${a.type} assessment`}</p><p className="text-xs text-primary-foreground/70">{a.type} - pass {a.passMark}% - best {a.bestScore == null ? '-' : `${a.bestScore}%`}</p></div><Button size="sm" variant="secondary" disabled={a.locked || !a.isPublished || startAttempt.isPending} onClick={() => startAttempt.mutate(a.id, { onSuccess: (data) => { setAttempt(data); setAnswers({}); }, onError: (e) => setError((e as Error).message) })}>{a.locked ? 'Locked' : 'Start'}</Button></div></div>)}
          </div>
        </>}
        {error && <p className="mt-3 text-xs text-primary-foreground/80">{error}</p>}
      </section>
    </div>
    {canAuthor && selected && <AssessmentBuilder courseId={selected.id} programmeId={selected.programmeId} />}
  </div>;
}

function AssessmentBuilder({ courseId, programmeId }: { courseId: string; programmeId: string }) {
  const modules = useModules(programmeId);
  const courseModules = (modules.data || []).filter((m) => m.courseId === courseId);
  const [moduleId, setModuleId] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const createAssessment = useCreateAssessment(moduleId, courseId);
  const moduleAssessments = useModuleAssessments(moduleId, !!moduleId);
  const detail = useAssessment(assessmentId, !!assessmentId);
  const createQuestion = useCreateQuestion(assessmentId);
  const publish = usePublishAssessment(assessmentId);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'recall' | 'applied'>('recall');
  const [passMark, setPassMark] = useState('70');
  const [maxAttempts, setMaxAttempts] = useState('');
  const [timeLimit, setTimeLimit] = useState('');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState([{ text: '', isCorrect: false }, { text: '', isCorrect: false }]);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const addAssessment = () => {
    if (!moduleId) { setBuilderError('Choose a module first.'); return; }
    createAssessment.mutate({ title: title || undefined, type, passMark: Number(passMark), maxAttempts: maxAttempts ? Number(maxAttempts) : undefined, timeLimitMinutes: timeLimit ? Number(timeLimit) : undefined }, { onSuccess: (a) => { setAssessmentId(a.id); setBuilderError(null); }, onError: (e) => setBuilderError((e as Error).message) });
  };
  const addQuestion = () => {
    if (!assessmentId || !prompt.trim()) return;
    createQuestion.mutate({ prompt: prompt.trim(), type, options }, { onSuccess: () => { setPrompt(''); setOptions([{ text: '', isCorrect: false }, { text: '', isCorrect: false }]); }, onError: (e) => setBuilderError((e as Error).message) });
  };
  return <section className="mt-5 rounded-lg border border-border/80 bg-card p-5">
    <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Assessment builder</p>
    <h2 className="mt-1 text-base font-bold">Draft questions, then publish</h2>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="block text-xs font-semibold">Module<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={moduleId} onChange={(e) => { setModuleId(e.target.value); setAssessmentId(''); }}>
        <option value="">Select module</option>{courseModules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select></label>
      <label className="block text-xs font-semibold">Title<Input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Applied scenario test" /></label>
      <label className="block text-xs font-semibold">Type<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={type} onChange={(e) => setType(e.target.value as 'recall' | 'applied')}><option value="recall">Recall</option><option value="applied">Applied</option></select></label>
      <label className="block text-xs font-semibold">Pass mark %<Input className="mt-2" type="number" value={passMark} onChange={(e) => setPassMark(e.target.value)} /></label>
      <label className="block text-xs font-semibold">Max attempts<Input className="mt-2" type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} placeholder="Unlimited" /></label>
      <label className="block text-xs font-semibold">Time limit (min)<Input className="mt-2" type="number" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} placeholder="Untimed" /></label>
    </div>
    <Button className="mt-3" onClick={addAssessment} disabled={!moduleId || createAssessment.isPending}>{createAssessment.isPending ? 'Creating...' : 'Create assessment'}</Button>
    {!!moduleAssessments.data?.length && <label className="mt-3 block text-xs font-semibold">Assessment<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={assessmentId} onChange={(e) => { setAssessmentId(e.target.value); const found = moduleAssessments.data?.find((a) => a.id === e.target.value); if (found) setType(found.type); }}>
      <option value="">Select assessment</option>{moduleAssessments.data.map((a) => <option key={a.id} value={a.id}>{a.title || `${a.type} assessment`}</option>)}
    </select></label>}
    {assessmentId && <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-4">
      <p className="text-sm font-semibold">{detail.data?.isPublished ? 'Published - questions are locked' : 'Add a question'}</p>
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="block text-xs font-semibold">Prompt<Textarea className="mt-2" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        <p className="self-end pb-2 text-xs text-muted-foreground">1 point per question</p>
      </div>
      <div className="space-y-2">{options.map((o, i) => <div key={i} className="flex items-center gap-2"><Input value={o.text} placeholder={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} /><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={o.isCorrect} onChange={(e) => setOptions(options.map((x, j) => ({ ...x, isCorrect: j === i ? e.target.checked : type === 'recall' ? false : x.isCorrect })))} />correct</label>{options.length > 2 && <Button size="sm" variant="outline" onClick={() => setOptions(options.filter((_, j) => j !== i))}>Remove</Button>}</div>)}</div>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setOptions([...options, { text: '', isCorrect: false }])}>Add option</Button><Button size="sm" onClick={addQuestion} disabled={!prompt.trim() || createQuestion.isPending}>Add question</Button><Button size="sm" variant="secondary" onClick={() => publish.mutate()} disabled={publish.isPending || detail.data?.isPublished}>{publish.isPending ? 'Publishing...' : 'Publish'}</Button></div>
      <p className="text-xs text-muted-foreground">{detail.data?.questions.length ?? 0} question(s) drafted.</p>
    </div>}
    {builderError && <p className="mt-2 text-xs text-destructive">{builderError}</p>}
  </section>;
}