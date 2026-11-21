import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowDown, ArrowUp, Clock3, Plus, Target, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getSessionUser } from '@/api/client';
import { PageHeading, Skeleton, EmptyState, ErrorState, Status } from '@/components/shared';
import {
  useCourses,
  useCourseAssessments,
  useStartAttempt,
  useSaveAttemptAnswers,
  useSubmitAttemptAnswers,
  useCreateAssessment,
  useModuleAssessments,
  useModules,
  useAssessment,
  useCreateQuestion,
  useDeleteQuestion,
  useReorderQuestions,
  useUpdateAssessment,
  usePublishAssessment,
  useDiscardAssessmentDraft,
  useRecalculationStatus,
  useEnrolments,
  type Course,
  type CourseAssessment,
  type QuestionKind,
  type StartedAttempt,
  type AttemptSubmission,
} from '@/api/hooks';

type AnswerDraft = { optionIds?: string[]; text?: string };
const CHOICE_KINDS: QuestionKind[] = ['single_choice', 'multi_choice', 'true_false'];

const statusOf = (error: unknown) => (error as { status?: number })?.status;
const messageOf = (error: unknown) => (error as Error)?.message ?? 'Something went wrong';

type VersionState = 'live' | 'draft' | 'superseding' | 'superseded';

function versionStateOf(a: CourseAssessment): VersionState {
  if (a.supersededAt) return 'superseded';
  if (a.isPublished) return 'live';
  return a.supersedesId ? 'superseding' : 'draft';
}

function versionLabelOf(a: CourseAssessment, versions: CourseAssessment[]) {
  const state = versionStateOf(a);
  const detail = state === 'live' ? 'live'
    : state === 'superseded' ? 'superseded'
    : state === 'superseding' ? `draft superseding v${versions.find((v) => v.id === a.supersedesId)?.version ?? '?'}`
    : 'draft';
  return `v${a.version ?? 1} — ${a.title || `${a.type} assessment`} (${detail})`;
}

function formatRemaining(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * One question, rendered by kind. The server only sends `kind` and the option text to a learner,
 * so the answer key can never be rendered here even by accident.
 */
function QuestionField({ question, value, disabled, onChange }: {
  question: StartedAttempt['questions'][number];
  value: AnswerDraft;
  disabled: boolean;
  onChange: (next: AnswerDraft) => void;
}) {
  const single = question.kind === 'single_choice' || question.kind === 'true_false';
  const multi = question.kind === 'multi_choice';
  const optionIds = value.optionIds ?? [];
  const toggle = (optionId: string) => {
    if (single) return onChange({ ...value, optionIds: [optionId] });
    onChange({ ...value, optionIds: optionIds.includes(optionId) ? optionIds.filter((id) => id !== optionId) : [...optionIds, optionId] });
  };
  return <div className="rounded-lg bg-primary-foreground/10 p-3">
    {question.scenarioContext && <p className="mb-1 rounded bg-primary-foreground/10 p-2 text-xs italic text-primary-foreground/80">{question.scenarioContext}</p>}
    <p className="text-sm font-semibold">{question.prompt} <span className="ml-1 text-[10px] font-normal text-primary-foreground/60">({question.points} pt{question.points === 1 ? '' : 's'})</span></p>
    {(single || multi) && <div className="mt-2 space-y-1">{question.options.map((o) => <label key={o.id} className="flex items-center gap-2 text-xs">
      <input type={single ? 'radio' : 'checkbox'} name={question.id} checked={optionIds.includes(o.id)} disabled={disabled} onChange={() => toggle(o.id)} />{o.text}
    </label>)}</div>}
    {!single && !multi && <Textarea className="mt-2 min-h-20 bg-background text-foreground" placeholder={question.kind === 'scenario' ? 'Describe what you would do…' : 'Your answer'} value={value.text ?? ''} disabled={disabled} onChange={(e) => onChange({ ...value, text: e.target.value })} />}
  </div>;
}

function AttemptResult({ result, onClose }: { result: AttemptSubmission; onClose: () => void }) {
  if (result.status === 'grading') {
    return <div className="mt-4 rounded-lg bg-primary-foreground/10 p-4 text-sm">
      <p className="font-bold">Submitted — waiting for marking</p>
      <p className="mt-1 text-xs text-primary-foreground/70">{result.awaitingGrading ?? 1} answer(s) need a person to mark them. The score, pass mark and result appear once marking is complete.</p>
      <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>Close</Button>
    </div>;
  }
  return <div className="mt-4 rounded-lg bg-primary-foreground/10 p-4 text-sm">
    <p className="font-bold">{result.passed ? 'Passed' : 'Not passed'} — {result.score}%</p>
    <p className="mt-1 text-xs text-primary-foreground/70">{result.earnedPoints}/{result.totalPoints} points · pass mark {result.passMark}% · {result.competenceMet ? 'competence met' : 'competence not yet met'}</p>
    {!!result.results?.length && <ul className="mt-3 space-y-1 text-xs">
      {result.results.map((r, i) => <li key={r.questionId} className="flex items-center justify-between gap-2">
        <span>Question {i + 1}{r.manual ? ' (marked)' : ''}</span>
        <span className={cn(r.correct === true && 'text-[hsl(var(--status-on-track))]', r.correct === false && 'text-[hsl(var(--status-off-track))]')}>
          {r.correct === true ? 'Correct' : r.correct === false ? 'Incorrect' : 'Awaiting mark'} · {r.points ?? 0} pt
        </span>
      </li>)}
    </ul>}
    <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>Close</Button>
  </div>;
}

export function Assessments() {
  const courses = useCourses();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: Course | null = courses.data?.find((c) => c.id === selectedId) || null;
  const assessments = useCourseAssessments(selected?.id || '', !!selected);
  const startAttempt = useStartAttempt(selected?.id);
  const saveAnswers = useSaveAttemptAnswers();
  const submitAttempt = useSubmitAttemptAnswers(selected?.id || '');
  const [attempt, setAttempt] = useState<StartedAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [result, setResult] = useState<AttemptSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const sessionUser = getSessionUser();
  const enrolments = useEnrolments();
  const canAuthor = ['admin', 'owner', 'trainer'].includes(sessionUser?.role ?? '');
  const pendingScoreNotice = !!selected && !!sessionUser?.id && (enrolments.data ?? []).some((e) => e.learnerId === sessionUser.id && e.courseId === selected.id && e.pendingAssessmentScore != null);

  const begin = (data: StartedAttempt) => {
    setAttempt(data);
    setResult(null);
    setError(null);
    setSaveState('idle');
    const restored: Record<string, AnswerDraft> = {};
    for (const a of data.answers ?? []) restored[a.questionId] = { optionIds: a.optionIds, text: a.text ?? '' };
    setAnswers(restored);
  };

  // Autosave: debounced so typing does not send a request per keystroke. The server enforces the
  // time limit, so a 409 here means the clock ran out and the learner must submit what is stored.
  useEffect(() => {
    if (!attempt || result) return;
    const payload = Object.entries(answers).map(([questionId, v]) => ({ questionId, optionIds: v.optionIds, text: v.text || undefined }));
    if (!payload.length) return;
    setSaveState('saving');
    const timer = setTimeout(() => {
      saveAnswers.mutate({ attemptId: attempt.attemptId, answers: payload }, {
        onSuccess: () => setSaveState('saved'),
        onError: (e) => {
          setSaveState('error');
          if (statusOf(e) === 409) setError('Time is up. Submit to have what you entered graded.');
          else setError(messageOf(e));
        },
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [answers, attempt, result]);

  useEffect(() => {
    if (!attempt?.expiresAt) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(attempt.expiresAt!).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [attempt?.expiresAt]);

  const expired = secondsLeft === 0;
  const submit = () => {
    if (!attempt) return;
    submitAttempt.mutate({
      attemptId: attempt.attemptId,
      answers: Object.entries(answers).map(([questionId, v]) => ({ questionId, optionIds: v.optionIds, text: v.text || undefined })),
    }, {
      onSuccess: (data) => { setResult(data); setAttempt(null); setAnswers({}); },
      onError: (e) => setError(messageOf(e)),
    });
  };

  return <div className="page-in">
    <PageHeading eyebrow="Competence assurance" title="Assessments with evidence." detail="A passing completion is not the same as competence. Scores come from stored answers and a person marks what a key cannot."
      action={canAuthor ? <Link href="/assessments/grading"><Button variant="outline" size="sm">Grading queue</Button></Link> : undefined} />
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5">
        <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Assessment queue</p><h2 className="mt-1 text-base font-bold">Courses ready for review</h2></div><Status tone="warn">{courses.data?.length || 0} courses</Status></div>
        {courses.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        : courses.isError ? <div className="mt-4"><ErrorState retry={() => courses.refetch()} /></div>
        : <div className="mt-4 space-y-2">{courses.data?.map((course) => <button key={course.id} onClick={() => { setSelectedId(course.id); setResult(null); setAttempt(null); setAnswers({}); setError(null); }} className={cn('w-full rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/35', selected?.id === course.id ? 'border-primary/50 bg-primary/5' : 'border-border/70')}><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-accent/25 text-primary"><Target className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{course.title}</p><p className="mt-1 text-xs text-muted-foreground">{course.programmeName} · pass mark from assessment or course threshold</p></div></div></button>)}</div>}
        {!courses.data?.length && !courses.isLoading && !courses.isError && <div className="mt-4"><EmptyState title="Assessment queue is clear" detail="New courses will appear here when ready for evidence." /></div>}
      </section>
      <section className="rounded-lg border border-primary/20 bg-primary p-5 text-primary-foreground">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Submission panel</p>
        <h2 className="mt-1 text-base font-bold">{selected ? selected.title : 'Select a course'}</h2>
        {!selected ? <p className="mt-3 text-sm text-primary-foreground/70">Choose a course from the queue to start an assessment.</p>
        : <>
          {pendingScoreNotice && <p data-testid="pending-score-notice" className="mt-2 rounded bg-primary-foreground/10 p-2 text-xs">A new assessment result is waiting for staff review. Your current score has not changed.</p>}
          {result ? <AttemptResult result={result} onClose={() => { setResult(null); setAttempt(null); }} />
          : attempt ? <>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-primary-foreground/65">
              <span>Attempt {attempt.attemptNumber}{attempt.version ? ` · version ${attempt.version}` : ''}{attempt.resumed ? ' · resumed' : ''}</span>
              {secondsLeft !== null && <span className={cn('flex items-center gap-1 font-mono', expired && 'text-[hsl(var(--status-off-track))]')}><Clock3 className="size-3" />{formatRemaining(secondsLeft)}</span>}
            </div>
            {expired && <p className="mt-2 rounded bg-primary-foreground/10 p-2 text-xs">Time is up. Submit to have what you entered graded.</p>}
            <div className="mt-4 max-h-[420px] space-y-4 overflow-y-auto">
              {attempt.questions.map((q) => <QuestionField key={q.id} question={q} value={answers[q.id] ?? {}} disabled={expired} onChange={(next) => setAnswers((prev) => ({ ...prev, [q.id]: next }))} />)}
            </div>
            <p className="mt-2 text-[11px] text-primary-foreground/60">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Answers saved' : saveState === 'error' ? 'Could not save answers' : 'Answers save as you go'}</p>
            <Button variant="secondary" className="mt-3 w-full" disabled={submitAttempt.isPending} onClick={submit}>{submitAttempt.isPending ? 'Submitting…' : expired ? 'Submit what was saved' : 'Submit answers'}</Button>
          </> : <>
            <p className="mt-1 text-xs text-primary-foreground/65">{selected.programmeName}</p>
            <div className="mt-4 space-y-2">
              {assessments.isLoading ? <p className="text-xs text-primary-foreground/70">Loading assessments…</p>
              : assessments.isError ? <p className="text-xs text-primary-foreground/80">{messageOf(assessments.error)}</p>
              : !assessments.data?.length ? <p className="text-xs text-primary-foreground/70">No published assessments for this course yet.</p>
              : assessments.data.map((a) => <div key={a.id} data-testid={`assessment-row-${a.id}`} className="rounded-lg bg-primary-foreground/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{a.title || `${a.type} assessment`}</p>
                    <p className="text-xs text-primary-foreground/70">{a.type}{a.version ? ` · v${a.version}` : ''} · pass {a.passMark}% · best {a.bestScore == null ? '—' : `${a.bestScore}%`}</p>
                    <p className="text-[11px] text-primary-foreground/55">{a.attemptCount} used{a.remainingAttempts !== null && a.remainingAttempts !== undefined ? ` · ${a.remainingAttempts} left` : ' · unlimited'}{a.timeLimitMinutes ? ` · ${a.timeLimitMinutes} min` : ''}</p>
                    {a.changeKind === 'new_paper' && <p data-testid={`new-paper-note-${a.id}`} className="mt-1 text-[11px] text-primary-foreground/90">This paper replaced an earlier version — please retake it.</p>}
                    {a.supersededAt && <p data-testid={`superseded-note-${a.id}`} className="mt-1 text-[11px] text-primary-foreground/70">Superseded — no new attempts on this version.</p>}
                  </div>
                  <Button size="sm" variant="secondary" disabled={!!a.supersededAt || a.locked || !a.isPublished || startAttempt.isPending} onClick={() => startAttempt.mutate(a.id, { onSuccess: begin, onError: (e) => setError(messageOf(e)) })}>
                    {a.supersededAt ? 'Superseded' : a.locked ? 'Locked' : a.attemptCount ? 'Resume / retry' : 'Start'}
                  </Button>
                </div>
              </div>)}
            </div>
          </>}
        </>}
        {error && <p className="mt-3 text-xs text-primary-foreground/80">{error}</p>}
      </section>
    </div>
    {canAuthor && selected && <AssessmentBuilder courseId={selected.id} programmeId={selected.programmeId} />}
  </div>;
}

const KIND_LABELS: Array<{ value: QuestionKind; label: string; hint: string }> = [
  { value: 'single_choice', label: 'Single choice', hint: 'One correct option (radio).' },
  { value: 'multi_choice', label: 'Multiple choice', hint: 'One or more correct options (checkboxes).' },
  { value: 'true_false', label: 'True / false', hint: 'Exactly two options.' },
  { value: 'short_answer', label: 'Short answer', hint: 'Accepted forms mark it automatically; leave them empty to mark by hand.' },
  { value: 'scenario', label: 'Scenario', hint: 'Context plus a rubric for a person to mark against.' },
];

function AssessmentBuilder({ courseId, programmeId }: { courseId: string; programmeId: string }) {
  const modules = useModules(programmeId);
  const courseModules = (modules.data || []).filter((m) => m.courseId === courseId);
  const [moduleId, setModuleId] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const createAssessment = useCreateAssessment(moduleId, courseId);
  const moduleAssessments = useModuleAssessments(moduleId, !!moduleId);
  const detail = useAssessment(assessmentId, !!assessmentId);
  const createQuestion = useCreateQuestion(assessmentId);
  const deleteQuestion = useDeleteQuestion(assessmentId);
  const reorderQuestions = useReorderQuestions(assessmentId);
  const updateAssessment = useUpdateAssessment(assessmentId);
  const publish = usePublishAssessment(assessmentId);
  const discardDraft = useDiscardAssessmentDraft();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'recall' | 'applied'>('recall');
  const [passMark, setPassMark] = useState('70');
  const [maxAttempts, setMaxAttempts] = useState('');
  const [timeLimit, setTimeLimit] = useState('');
  const [kind, setKind] = useState<QuestionKind>('single_choice');
  const [points, setPoints] = useState('1');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState([{ text: '', isCorrect: false }, { text: '', isCorrect: false }]);
  const [scenarioContext, setScenarioContext] = useState('');
  const [rubric, setRubric] = useState('');
  const [acceptedAnswers, setAcceptedAnswers] = useState('');
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [publishProblems, setPublishProblems] = useState<string[]>([]);
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [changeKind, setChangeKind] = useState<'minor' | 'new_paper'>('minor');
  const [recalcActive, setRecalcActive] = useState(false);
  const [discardNotice, setDiscardNotice] = useState<string | null>(null);
  const recalculation = useRecalculationStatus(courseId, recalcActive, 2000);

  const isPublished = !!detail.data?.isPublished;
  const supersededSelected = !!detail.data && versionStateOf(detail.data) === 'superseded';
  const editable = !!detail.data && !isPublished && !supersededSelected;
  const superseded = (moduleAssessments.data ?? []).filter((a) => a.supersededAt);
  const choiceKind = CHOICE_KINDS.includes(kind);

  const resetDraft = () => {
    setPrompt(''); setScenarioContext(''); setRubric(''); setAcceptedAnswers('');
    setOptions([{ text: '', isCorrect: false }, { text: '', isCorrect: false }]);
    setPoints('1');
  };

  const addAssessment = () => {
    if (!moduleId) { setBuilderError('Choose a module first.'); return; }
    createAssessment.mutate({ title: title || undefined, type, passMark: Number(passMark), maxAttempts: maxAttempts ? Number(maxAttempts) : undefined, timeLimitMinutes: timeLimit ? Number(timeLimit) : undefined }, {
      onSuccess: (a) => { setAssessmentId(a.id); setBuilderError(null); },
      onError: (e) => setBuilderError(messageOf(e)),
    });
  };

  const addQuestion = () => {
    if (!assessmentId || !prompt.trim()) return;
    const input = {
      kind,
      prompt: prompt.trim(),
      points: Number(points) > 0 ? Number(points) : 1,
      ...(choiceKind ? { options: options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) } : {}),
      ...(kind === 'scenario' ? { scenarioContext: scenarioContext || null, rubric: rubric || null } : {}),
      ...(kind === 'short_answer' ? { acceptedAnswers: acceptedAnswers.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    };
    createQuestion.mutate(input, {
      onSuccess: (q) => {
        // Editing a published paper continues on a new version; follow the edit to where it landed.
        if (q.versionCreated && q.assessmentId) setAssessmentId(q.assessmentId);
        resetDraft(); setBuilderError(null);
      },
      onError: (e) => setBuilderError(messageOf(e)),
    });
  };

  const move = (index: number, delta: number) => {
    const ids = (detail.data?.questions ?? []).map((q) => q.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderQuestions.mutate(ids, { onError: (e) => setBuilderError(messageOf(e)) });
  };

  const saveDetails = (confirmNewVersion: boolean) => {
    updateAssessment.mutate({ title: title || detail.data?.title || undefined, passMark: Number(passMark), maxAttempts: maxAttempts ? Number(maxAttempts) : null, timeLimitMinutes: timeLimit ? Number(timeLimit) : null, confirmNewVersion }, {
      onSuccess: (updated) => { if (updated.id && updated.id !== assessmentId) setAssessmentId(updated.id); setConfirmVersion(false); setBuilderError(null); },
      onError: (e) => {
        const body = (e as { body?: { requiresNewVersion?: boolean } }).body;
        if (statusOf(e) === 409 && body?.requiresNewVersion) { setConfirmVersion(true); return; }
        setBuilderError(messageOf(e));
      },
    });
  };

  const doPublish = () => publish.mutate(detail.data?.supersedesId ? { changeKind } : undefined, {
    onSuccess: () => {
      setPublishProblems([]); setBuilderError(null); setRecalcActive(true);
    },
    onError: (e) => {
      const problems = (e as { body?: { problems?: string[] } }).body?.problems;
      setPublishProblems(problems?.length ? problems : [messageOf(e)]);
    },
  });

  const doDiscard = () => {
    if (!detail.data) return;
    discardDraft.mutate(detail.data.id, {
      onSuccess: () => {
        setAssessmentId(''); setConfirmVersion(false); setDiscardNotice('Draft discarded — the live paper was not changed.'); setBuilderError(null);
      },
      onError: (e) => setBuilderError(messageOf(e)),
    });
  };

  return <section className="mt-5 rounded-lg border border-border/80 bg-card p-5">
    <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Assessment builder</p>
    <h2 className="mt-1 text-base font-bold">Draft questions, then publish</h2>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="block text-xs font-semibold">Module<select data-testid="module-select" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={moduleId} onChange={(e) => { setModuleId(e.target.value); setAssessmentId(''); }}>
        <option value="">Select module</option>{courseModules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select></label>
      <label className="block text-xs font-semibold">Title<Input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Applied scenario test" /></label>
      <label className="block text-xs font-semibold">Type<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={type} onChange={(e) => setType(e.target.value as 'recall' | 'applied')}><option value="recall">Recall</option><option value="applied">Applied</option></select></label>
      <label className="block text-xs font-semibold">Pass mark %<Input className="mt-2" type="number" value={passMark} onChange={(e) => setPassMark(e.target.value)} /></label>
      <label className="block text-xs font-semibold">Max attempts<Input className="mt-2" type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} placeholder="Unlimited" /></label>
      <label className="block text-xs font-semibold">Time limit (min)<Input className="mt-2" type="number" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} placeholder="Untimed" /></label>
    </div>
    <Button className="mt-3" onClick={addAssessment} disabled={!moduleId || createAssessment.isPending}>{createAssessment.isPending ? 'Creating…' : 'Create assessment'}</Button>
    {!!moduleAssessments.data?.length && <label className="mt-3 block text-xs font-semibold">Assessment<select data-testid="assessment-version-select" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={assessmentId} onChange={(e) => {
      setAssessmentId(e.target.value);
      setPublishProblems([]); setConfirmVersion(false); setDiscardNotice(null);
      const found = moduleAssessments.data?.find((a) => a.id === e.target.value);
      if (found) {
        setType(found.type); if (found.passMark) setPassMark(String(found.passMark)); setTitle(found.title ?? '');
        setChangeKind(found.changeKind === 'new_paper' ? 'new_paper' : 'minor');
      }
    }}>
      <option value="">Select assessment</option>{moduleAssessments.data.map((a) => <option key={a.id} value={a.id}>{versionLabelOf(a, moduleAssessments.data ?? [])}</option>)}
    </select></label>}

    {assessmentId && detail.data && <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="builder-version-state" className="text-sm font-semibold">
          {supersededSelected ? `Superseded — version ${detail.data.version ?? 1}; no new attempts` : isPublished ? `Published — live version ${detail.data.version ?? 1}, questions locked` : 'Draft — add your questions'}
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">{versionStateOf(detail.data)} v{detail.data.version ?? 1}</Badge>
          {isPublished && !supersededSelected && <Button size="sm" variant="outline" onClick={() => setConfirmVersion(true)} disabled={updateAssessment.isPending}>Create draft from live</Button>}
          {editable && <Button size="sm" variant="outline" onClick={() => saveDetails(false)} disabled={updateAssessment.isPending}>Save draft details</Button>}
          {editable && !!detail.data.supersedesId && <Button size="sm" variant="ghost" onClick={doDiscard} disabled={discardDraft.isPending}>{discardDraft.isPending ? 'Discarding…' : 'Discard draft'}</Button>}
          {editable && <Button size="sm" variant="secondary" onClick={doPublish} disabled={publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish'}</Button>}
        </div>
      </div>

      {editable && !!detail.data.supersedesId && <label className="block text-xs font-semibold">Publish as<select data-testid="publish-change-kind" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={changeKind} onChange={(e) => setChangeKind(e.target.value as 'minor' | 'new_paper')}>
        <option value="minor">Minor change — carry results forward</option>
        <option value="new_paper">New paper — learners retake</option>
      </select></label>}

      {recalcActive && <div data-testid="recalculation-status" className="rounded-lg border border-border/60 bg-secondary/40 p-3 text-xs">
        {recalculation.isError ? `Could not check recalculation: ${messageOf(recalculation.error)}`
          : recalculation.data?.stale || recalculation.data?.job?.status === 'failed'
            ? `Recalculation stalled${recalculation.data?.lastError ? `: ${recalculation.data.lastError}` : ''}. Check the evaluation queue.`
            : recalculation.data?.pending === false
              ? 'Recalculation complete — scores are up to date.'
              : `Recalculating… ${recalculation.data?.job?.status ?? 'queued'} · ${recalculation.data?.attempts ?? 0} attempt(s)`}
      </div>}
      {!!publishProblems.length && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
        <p className="flex items-center gap-1 font-semibold text-destructive"><TriangleAlert className="size-3.5" />Fix these before publishing</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-destructive/90">{publishProblems.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>}

      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <label className="block text-xs font-semibold">Kind<select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal" value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
          {KIND_LABELS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select></label>
        <label className="block text-xs font-semibold">Points<Input className="mt-2 w-24" type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">{KIND_LABELS.find((k) => k.value === kind)?.hint}</p>
      <label className="block text-xs font-semibold">Prompt<Textarea className="mt-2" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>

      {kind === 'scenario' && <>
        <label className="block text-xs font-semibold">Scenario context<Textarea className="mt-2" value={scenarioContext} onChange={(e) => setScenarioContext(e.target.value)} /></label>
        <label className="block text-xs font-semibold">Rubric (shown only to the marker)<Textarea className="mt-2" value={rubric} onChange={(e) => setRubric(e.target.value)} /></label>
      </>}
      {kind === 'short_answer' && <label className="block text-xs font-semibold">Accepted answers (comma separated; empty means mark by hand)<Input className="mt-2" value={acceptedAnswers} onChange={(e) => setAcceptedAnswers(e.target.value)} placeholder="because, as a result" /></label>}

      {(kind === 'single_choice' || kind === 'multi_choice' || kind === 'true_false') && <div className="space-y-2">{options.map((o, i) => <div key={i} className="flex items-center gap-2">
        <Input value={o.text} placeholder={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
        <label className="flex items-center gap-1 text-xs"><input type={kind === 'multi_choice' ? 'checkbox' : 'radio'} name="correct-option" checked={o.isCorrect} onChange={(e) => setOptions(options.map((x, j) => ({ ...x, isCorrect: kind === 'multi_choice' ? (j === i ? e.target.checked : x.isCorrect) : j === i })))} />correct</label>
        {options.length > 2 && <Button size="sm" variant="outline" onClick={() => setOptions(options.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>}
      </div>)}</div>}

      <div className="flex flex-wrap gap-2">
        {(kind === 'single_choice' || kind === 'multi_choice') && <Button size="sm" variant="outline" onClick={() => setOptions([...options, { text: '', isCorrect: false }])}><Plus className="size-3.5" />Option</Button>}
        <Button size="sm" onClick={addQuestion} disabled={!editable || !prompt.trim() || createQuestion.isPending}>{createQuestion.isPending ? 'Adding…' : 'Add question'}</Button>
      </div>

      <div className="space-y-2">
        {(detail.data.questions ?? []).map((q, i) => <div key={q.id} className="flex items-start gap-2 rounded-md border border-border/60 p-2">
          <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{q.prompt}</p>
            <p className="text-[11px] text-muted-foreground">{q.kind.replace('_', ' ')} · {q.points} pt{q.points === 1 ? '' : 's'}{q.options?.length ? ` · ${q.options.length} options` : ''}</p>
          </div>
          {editable && <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={i === 0 || reorderQuestions.isPending} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={i === (detail.data?.questions.length ?? 0) - 1 || reorderQuestions.isPending} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={deleteQuestion.isPending} onClick={() => deleteQuestion.mutate(q.id, { onError: (e) => setBuilderError(messageOf(e)) })} aria-label="Delete question"><Trash2 className="size-3.5" /></Button>
          </div>}
        </div>)}
        {!detail.data.questions.length && <p className="text-xs text-muted-foreground">No questions yet.</p>}
      </div>

      {isPublished && !supersededSelected && <div className="rounded-lg border border-border/60 p-3">
        <p className="text-xs font-semibold">Change this paper</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Saving an edit opens draft version {(detail.data.version ?? 1) + 1}. Learners stay on this live paper until the draft is published.</p>
        <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => setConfirmVersion(true)} disabled={updateAssessment.isPending}>Open draft with these details</Button></div>
      </div>}

      {!!superseded.length && <div className="rounded-lg border border-border/60 p-3">
        <p className="text-xs font-semibold">Earlier versions</p>
        <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">{superseded.map((a) => <li key={a.id}>v{a.version ?? 1} — {a.title || 'untitled'} (superseded)</li>)}</ul>
      </div>}
    </div>}
    {discardNotice && <p data-testid="discard-notice" className="mt-2 text-xs text-muted-foreground">{discardNotice}</p>}
    {builderError && <p className="mt-2 text-xs text-destructive">{builderError}</p>}

    <Dialog open={confirmVersion} onOpenChange={setConfirmVersion}>
      <DialogContent data-testid="version-confirm-dialog">
        <DialogHeader><DialogTitle>Create version {(detail.data?.version ?? 1) + 1}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This opens draft version {(detail.data?.version ?? 1) + 1}. Learners stay on the live paper until you publish the draft, and attempts already in progress can still be submitted.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmVersion(false)}>Cancel</Button>
          <Button onClick={() => saveDetails(true)} disabled={updateAssessment.isPending}>{updateAssessment.isPending ? 'Creating…' : `Create v${(detail.data?.version ?? 1) + 1}`}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
