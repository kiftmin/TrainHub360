import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Clock3, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PageHeading, Skeleton, EmptyState, ErrorState, Status } from '@/components/shared';
import { useGradingQueue, useGradingAttempt, useGradeAttempt, type AttemptSubmission } from '@/api/hooks';

const statusOf = (error: unknown) => (error as { status?: number })?.status;
const messageOf = (error: unknown) => (error as Error)?.message ?? 'Something went wrong';

function waitingLabel(submittedAt: string | null) {
  if (!submittedAt) return '—';
  const hours = (Date.now() - new Date(submittedAt).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

const MANUAL_KINDS = new Set(['scenario', 'short_answer']);

export function GradingQueuePage() {
  const queue = useGradingQueue();
  return <div className="page-in">
    <PageHeading eyebrow="Marking" title="Grading queue." detail="Attempts with a scenario or short answer wait here until a person marks them. A learner never sees a score before that."
      action={<Button variant="outline" size="sm" onClick={() => queue.refetch()} disabled={queue.isFetching}><RefreshCw className={cn('size-3.5', queue.isFetching && 'animate-spin')} />Refresh</Button>} />
    <section className="rounded-xl border border-border/70 bg-card p-5">
      {queue.isLoading ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      : queue.isError ? <ErrorState retry={() => queue.refetch()} />
      : !queue.data?.length ? <EmptyState title="Nothing waiting" detail="Every submitted attempt has been marked. New submissions appear here." />
      : <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border/70 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
            <th className="py-2 pr-3">Learner</th><th className="py-2 pr-3">Assessment</th><th className="py-2 pr-3">Course</th>
            <th className="py-2 pr-3">Submitted</th><th className="py-2 pr-3">Waiting</th><th className="py-2 pr-3">Answers</th><th className="py-2" />
          </tr></thead>
          <tbody>{queue.data.map((row) => <tr key={row.id} className="border-b border-border/40 last:border-0">
            <td className="py-3 pr-3"><p className="font-semibold">{row.learner.name}</p><p className="text-xs text-muted-foreground">{row.learner.email}</p></td>
            <td className="py-3 pr-3"><p>{row.assessment.title || `${row.assessment.type} assessment`}</p><Status tone="warn">attempt {row.attemptNumber}</Status></td>
            <td className="py-3 pr-3 text-muted-foreground">{row.course?.title}</td>
            <td className="py-3 pr-3 text-muted-foreground">{row.submittedAt ? new Date(row.submittedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
            <td className="py-3 pr-3"><span className="flex items-center gap-1 text-muted-foreground"><Clock3 className="size-3" />{waitingLabel(row.submittedAt)}</span></td>
            <td className="py-3 pr-3 text-muted-foreground">{row.answered}/{row.answersStored}</td>
            <td className="py-3 text-right"><Link href={`/assessments/grading/${row.attemptId}`}><Button size="sm">Mark</Button></Link></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </div>;
}

type Mark = { points: string; comment: string };

export function GradingAttemptPage({ attemptId }: { attemptId: string }) {
  const attempt = useGradingAttempt(attemptId, !!attemptId);
  const grade = useGradeAttempt();
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptSubmission | null>(null);

  const data = attempt.data;
  // Seed the inputs from what is stored (normally nothing) whenever a different attempt loads.
  useEffect(() => {
    if (!data) return;
    const seeded: Record<string, Mark> = {};
    for (const q of data.questions) {
      if (!MANUAL_KINDS.has(q.kind)) continue;
      seeded[q.id] = { points: q.answer?.pointsAwarded != null ? String(q.answer.pointsAwarded) : '', comment: q.answer?.graderComment ?? '' };
    }
    setMarks(seeded);
    setError(null);
    setResult(null);
  }, [data?.attemptId]);

  const manual = (data?.questions ?? []).filter((q) => MANUAL_KINDS.has(q.kind));

  const submit = () => {
    if (!data) return;
    const missing = manual.filter((q) => marks[q.id]?.points === '' || marks[q.id]?.points === undefined);
    if (missing.length) { setError('Enter points for every manual question before finishing.'); return; }
    grade.mutate({ attemptId, answers: manual.map((q) => ({ questionId: q.id, pointsAwarded: Number(marks[q.id].points), comment: marks[q.id].comment || undefined })) }, {
      onSuccess: (r) => { setResult(r); setError(null); },
      onError: (e) => {
        const status = statusOf(e);
        setError(status === 403 ? 'You cannot grade your own attempt.' : status === 404 ? 'This attempt belongs to another organization.' : status === 409 ? 'This attempt was already graded.' : messageOf(e));
      },
    });
  };

  if (attempt.isLoading) return <div className="page-in space-y-2"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (attempt.isError) return <div className="page-in"><ErrorState retry={() => attempt.refetch()} /></div>;
  if (!data) return null;

  if (result) return <div className="page-in">
    <PageHeading eyebrow="Marking" title="Attempt marked." detail="The learner has been notified. A certificate is issued automatically if this result completes the course." />
    <section className="max-w-xl rounded-xl border border-border/70 bg-card p-5">
      <p className="text-lg font-bold">{result.passed ? 'Passed' : 'Not passed'} — {result.score}%</p>
      <p className="mt-1 text-sm text-muted-foreground">{result.earnedPoints}/{result.totalPoints} points · pass mark {result.passMark}% · {result.competenceMet ? 'competence met' : 'competence not yet met'}</p>
      <p className="mt-1 text-sm text-muted-foreground">{result.certificateIssued ? 'A certificate was issued.' : 'No certificate was issued by this result.'}</p>
      <Link href="/assessments/grading"><Button className="mt-4" variant="outline"><ArrowLeft className="size-4" />Back to the queue</Button></Link>
    </section>
  </div>;

  return <div className="page-in">
    <PageHeading eyebrow="Marking" title={data.learner.name} detail={`${data.assessment.title || `${data.assessment.type} assessment`} · version ${data.assessment.version} · submitted ${data.submittedAt ? new Date(data.submittedAt).toLocaleString('en-GB') : '—'}`}
      action={<Link href="/assessments/grading"><Button variant="outline" size="sm"><ArrowLeft className="size-3.5" />Queue</Button></Link>} />
    <div className="space-y-3">
      {data.questions.map((q, i) => {
        const isManual = MANUAL_KINDS.has(q.kind);
        const mark = marks[q.id] ?? { points: '', comment: '' };
        return <section key={q.id} className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Question {i + 1} · {q.kind.replace('_', ' ')}</p>
              {q.scenarioContext && <p className="mt-1 rounded bg-secondary/50 p-2 text-xs italic">{q.scenarioContext}</p>}
              <p className="mt-1 text-sm font-semibold">{q.prompt}</p>
            </div>
            <Status tone="neutral">{q.points} pt{q.points === 1 ? '' : 's'}</Status>
          </div>

          {!!q.options.length && <ul className="mt-2 space-y-1 text-xs">{q.options.map((o) => <li key={o.id} className={cn('flex items-center gap-2', o.isCorrect && 'font-semibold')}>
            <span className={cn('size-1.5 rounded-full', q.answer?.optionIds.includes(o.id) ? 'bg-primary' : 'bg-border')} />{o.text}{o.isCorrect && <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--status-on-track))]">key</span>}
          </li>)}</ul>}

          {q.answer?.text && <div className="mt-2 rounded bg-secondary/40 p-2 text-sm"><p className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Learner answer</p><p className="mt-1 whitespace-pre-wrap">{q.answer.text}</p></div>}
          {!q.answer && <p className="mt-2 text-xs text-muted-foreground">No answer stored for this question.</p>}

          {q.rubric && <p className="mt-2 rounded border border-border/60 p-2 text-xs"><span className="font-semibold">Rubric:</span> {q.rubric}</p>}

          {isManual ? <div className="mt-3 grid gap-2 md:grid-cols-[8rem_1fr]">
            <label className="block text-xs font-semibold">Points (max {q.points})<Input className="mt-1" type="number" min={0} max={q.points} value={mark.points} onChange={(e) => setMarks((prev) => ({ ...prev, [q.id]: { ...mark, points: e.target.value } }))} /></label>
            <label className="block text-xs font-semibold">Comment<Textarea className="mt-1 min-h-10" value={mark.comment} onChange={(e) => setMarks((prev) => ({ ...prev, [q.id]: { ...mark, comment: e.target.value } }))} /></label>
          </div>
          : <p className="mt-3 text-xs text-muted-foreground">Marked automatically{q.answer?.pointsAwarded != null ? `: ${q.answer.pointsAwarded}/${q.points}` : ''}.</p>}
        </section>;
      })}
    </div>
    {error && <p className="mt-3 flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="size-3.5" />{error}</p>}
    <div className="mt-4 flex gap-2">
      <Button onClick={submit} disabled={grade.isPending || !manual.length}>{grade.isPending ? 'Saving mark…' : 'Finish marking'}</Button>
      <Link href="/assessments/grading"><Button variant="outline">Cancel</Button></Link>
    </div>
  </div>;
}
