import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Status, ErrorState, Skeleton } from '@/components/shared';
import { useEnrolments, useAcceptAssessmentScore, useRejectAssessmentScore, useProgrammes, useCourses, type Enrolment } from '@/api/hooks';

// Round 8 / 1.3: when the applied score came from a manual override, a later automatic result
// is held in `pendingAssessmentScore` instead of silently replacing it. Staff decide here, and
// the decision is audited by the API. The flag is shown wherever staff look at enrolments.

function pending(rows: Enrolment[]): Enrolment[] {
  return rows.filter((e) => e.pendingAssessmentScore !== null && e.pendingAssessmentScore !== undefined);
}

export function PendingAssessmentResultsPanel() {
  const enrolments = useEnrolments();
  const programmes = useProgrammes();
  const courses = useCourses();
  const accept = useAcceptAssessmentScore();
  const reject = useRejectAssessmentScore();

  const programmeName = useMemo(() => new Map((programmes.data ?? []).map((p) => [p.id, p.name])), [programmes.data]);
  const courseName = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, c.title])), [courses.data]);

  const rows = pending(enrolments.data ?? []);
  const busy = accept.isPending || reject.isPending;

  return <section className="rounded-lg border border-border/80 bg-card p-4">
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Score source</p>
        <h2 className="mt-1 text-base font-bold">Assessment results pending review</h2>
        <p className="mt-1 text-sm text-muted-foreground">The score on these enrolments was set by hand, so a new result is held until you decide.</p>
      </div>
      <Status tone={rows.length ? 'warn' : 'good'}>{rows.length ? `${rows.length} waiting` : 'none waiting'}</Status>
    </div>
    {enrolments.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
    : enrolments.isError ? <ErrorState retry={() => enrolments.refetch()} />
    : !rows.length ? <p className="mt-4 text-sm text-muted-foreground">No override is holding a result back.</p>
    : <ul className="mt-3 space-y-2">
      {rows.map((e) => <li key={e.id} className="flex flex-col gap-2 rounded-md bg-secondary/55 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{courseName.get(e.courseId) ?? 'Course'}{e.programmeId ? ` · ${programmeName.get(e.programmeId) ?? 'Programme'}` : ''}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Override holds <span className="font-mono">{e.appliedAssessmentScore ?? '—'}</span>
            {e.appliedScoreOverrideReason ? ` — “${e.appliedScoreOverrideReason}”` : ''}
            {' · '}new result <span className="font-mono text-foreground">{e.pendingAssessmentScore}</span>
            {e.pendingAssessmentScoreAt ? ` from ${new Date(e.pendingAssessmentScoreAt).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => accept.mutate(e.id)}>Accept result</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => reject.mutate(e.id)}>Keep override</Button>
        </div>
      </li>)}
    </ul>}
    {(accept.isError || reject.isError) && <p className="mt-3 text-xs text-destructive">That decision did not save — try again.</p>}
  </section>;
}

/**
 * A row of everything an enrolment says about its score: where it came from, whether a period
 * lock is holding it and whether a result is waiting. Used from the staff profiles.
 */
export function EnrolmentScoreCell({ enrolment }: { enrolment: Enrolment }) {
  const source = enrolment.appliedScoreSource === 'manual' ? 'manual override' : 'assessment';
  const isPending = enrolment.pendingAssessmentScore !== null && enrolment.pendingAssessmentScore !== undefined;
  return <div className="flex flex-wrap items-center gap-1.5">
    <span className="font-mono text-sm">{enrolment.enrolmentScore ?? '—'}</span>
    <Status tone={enrolment.appliedScoreSource === 'manual' ? 'warn' : 'neutral'}>{source}</Status>
    {enrolment.reviewCreditLockedAt && <Status tone="bad">locked</Status>}
    {isPending && <Status tone="warn">new result pending</Status>}
  </div>;
}

/** The same list behind a trigger, for a toolbar that has no room for a panel. */
export function PendingAssessmentResultsButton() {
  const enrolments = useEnrolments();
  const rows = pending(enrolments.data ?? []);
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm">Pending results <span className="ml-1.5 font-mono">{rows.length}</span></Button>
    </DialogTrigger>
    <DialogContent className="max-h-[85vh] w-full overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Assessment results pending review</DialogTitle></DialogHeader>
      <div className="mt-2"><PendingAssessmentResultsPanel /></div>
    </DialogContent>
  </Dialog>;
}
