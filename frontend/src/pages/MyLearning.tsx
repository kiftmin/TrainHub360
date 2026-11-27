import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetCourseContentQueryKey,
  getGetLearnerDashboardQueryKey,
  useGetCourseContent,
  useGetLearnerDashboard,
  useMarkContentProgress,
  useUploadEvidence,
} from '@api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtDate, pct, EmptyState, ErrorState, ProgressLine, PageHeading, Skeleton, Status } from '@/components/shared';
import { downloadContent } from '@/api/client';
import { BookOpen, CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, MessageSquare, Target } from 'lucide-react';

type Tab = 'overview' | 'progress' | 'results' | 'certificates';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'progress', label: 'Progress' },
  { id: 'results', label: 'Results' },
  { id: 'certificates', label: 'Certificates' },
];

function actionIcon(type: string) {
  if (type === 'book_session') return CalendarDays;
  if (type === 'reply_message') return MessageSquare;
  if (type === 'download_certificate') return Download;
  return Target;
}

export function MyLearning() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [contentCourseId, setContentCourseId] = useState('');
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [evidenceFile, setEvidenceFile] = useState<Record<string, { id: string; name: string }>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const dashboard = useGetLearnerDashboard({ query: { queryKey: getGetLearnerDashboardQueryKey(), retry: false } });
  const courses = dashboard.data?.courses ?? [];
  const activeCourseId = contentCourseId || courses[0]?.courseId || '';
  const content = useGetCourseContent(activeCourseId, { query: { queryKey: getGetCourseContentQueryKey(activeCourseId), enabled: !!activeCourseId, retry: false } });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetLearnerDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetCourseContentQueryKey(activeCourseId) });
  };
  const progress = useMarkContentProgress({ mutation: { onSuccess: refresh } });
  const upload = useUploadEvidence({ mutation: { onSuccess: refresh } });

  if (dashboard.isLoading) {
    return <div className="page-in"><PageHeading eyebrow="My learning" title="Your path, in order." detail="Loading your learning path." /><div className="mt-5 space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div></div>;
  }
  if (dashboard.isError) {
    return <div className="page-in"><PageHeading eyebrow="My learning" title="Your path, in order." detail="We could not load your learning path." /><div className="mt-5"><ErrorState retry={() => dashboard.refetch()} /></div></div>;
  }
  const data = dashboard.data!;

  return <div className="page-in">
    <PageHeading eyebrow="My learning" title="Your path, in order." detail={`Welcome back, ${data.learner.name}.`} />
    <div className="mt-4 grid gap-2 sm:grid-cols-4" data-testid="learner-summary">
      <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Assigned</p><p className="text-xl font-bold">{data.summary.assignedCourses}</p></div>
      <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Completed</p><p className="text-xl font-bold">{data.summary.completedCourses}</p></div>
      <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Overall</p><p className="text-xl font-bold">{pct(data.summary.overallProgress)}</p></div>
      <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-xl font-bold">{data.summary.outstandingActivities}</p></div>
    </div>

    <div className="mt-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="My learning sections">
      {tabs.map((item) => <Button key={item.id} size="sm" variant={tab === item.id ? 'default' : 'outline'} role="tab" aria-selected={tab === item.id} data-testid={`tab-${item.id}`} onClick={() => setTab(item.id)}>{item.label}</Button>)}
    </div>

    {tab === 'overview' && <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_.6fr]">
      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-base font-bold" data-testid="next-actions-heading">What's next</h2>
        {!data.nextActions.length ? <div className="mt-4"><EmptyState title="You're up to date" detail="No next action is waiting for you." /></div>
          : <div className="mt-4 space-y-2">{data.nextActions.map((action) => {
            const Icon = actionIcon(action.type);
            const inner = <><Icon className="size-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{action.title}</span><span className="block truncate text-xs text-muted-foreground">{action.detail}</span></span></>;
            return action.href.startsWith('/api/')
              ? <a key={action.id} href={action.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border p-3 hover:bg-secondary/50" data-testid="next-action">{inner}</a>
              : <Link key={action.id} href={action.href} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-secondary/50" data-testid="next-action">{inner}</Link>;
          })}</div>}
      </section>
      <div className="space-y-5">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-bold">Coming up</h2>
          <div className="mt-4 space-y-2">{data.upcomingSessions.map((session) => <div key={session.id} className="flex items-center gap-3 rounded-lg bg-secondary/55 p-3"><CalendarDays className="size-4 text-primary" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.title}</p><p className="text-xs text-muted-foreground">{fmtDate(session.startsAt)} - {session.mode}</p></div></div>)}
            {!data.upcomingSessions.length && <EmptyState title="No sessions scheduled" detail="Book a trainer when you are ready." />}</div>
        </section>
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-bold">Messages</h2>
          <div className="mt-4 space-y-2">{data.messages.map((message) => <div key={message.id} className="rounded-lg bg-secondary/55 p-3"><p className="truncate text-sm font-semibold">{message.subject}</p><p className="text-xs text-muted-foreground">{message.slaState.replace('_', ' ')}</p></div>)}
            {!data.messages.length && <EmptyState title="No messages" detail="Trainer conversations appear here." />}</div>
        </section>
      </div>
    </div>}

    {tab === 'progress' && <section className="mt-5 rounded-lg border bg-card p-5" data-testid="progress-panel">
      <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-base font-bold">Course content</h2>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={activeCourseId} onChange={(e) => setContentCourseId(e.target.value)} data-testid="select-content-course">
          {courses.map((course) => <option key={course.courseId} value={course.courseId}>{course.title}</option>)}
        </select>
        <Status>{content.data?.progress ?? 0}%</Status>
      </div>
      {!activeCourseId ? <div className="mt-4"><EmptyState title="No course selected" detail="Pick a course to start learning." /></div>
        : content.isLoading ? <div className="mt-4"><Skeleton className="h-24" /></div>
          : content.isError ? <div className="mt-4"><ErrorState retry={() => content.refetch()} /></div>
            : !content.data?.modules.length ? <div className="mt-4"><EmptyState title="No content yet" detail="Your trainer has not added content for this course." /></div>
              : <div className="mt-4 space-y-4">{content.data.modules.map((module) => <div key={module.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between"><p className="text-sm font-semibold">{module.title}</p><Badge variant="outline">{module.contentItems.length} items</Badge></div>
                <div className="mt-2 space-y-2">{module.contentItems.map((item) => <div key={item.id} className="rounded-md bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}{item.required ? ' *' : ''}</p><p className="text-xs text-muted-foreground">{item.type.replace('_', ' ')} - {item.progress.status.replace('_', ' ')}</p></div>
                    <Button size="sm" variant="outline" disabled={progress.isPending || upload.isPending || item.progress.status === 'completed' || item.progress.status === 'pending_verification' || (item.completionMode === 'trainer_verified' && !evidence[item.id]?.trim() && !evidenceFile[item.id])} onClick={() => {
                      setActionError(null);
                      progress.mutate({ contentId: item.id, data: { status: 'completed', evidenceNote: evidence[item.id], evidenceFileId: evidenceFile[item.id]?.id } }, { onError: (e) => setActionError((e as Error).message) });
                    }}>{item.progress.status === 'pending_verification' ? 'Awaiting verification' : 'Mark complete'}</Button>
                  </div>
                  {item.progress.status === 'pending_verification' && <p className="mt-2 flex items-center gap-1 text-xs text-amber-700"><Clock3 className="size-3" /> Submitted for trainer verification</p>}
                  {item.type === 'external_link' && item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-primary underline">Open link</a>}
                  {item.type === 'file' && <button type="button" onClick={() => void downloadContent(item.id)} className="mt-2 inline-block text-xs font-semibold text-primary underline">Download</button>}
                  {item.type === 'native' && item.body && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>}
                  {item.completionMode === 'trainer_verified' && item.progress.status !== 'completed' && item.progress.status !== 'pending_verification' && <div className="mt-2 space-y-1">
                    <Input placeholder="Evidence note for trainer verification" value={evidence[item.id] ?? ''} onChange={(e) => setEvidence({ ...evidence, [item.id]: e.target.value })} />
                    <input className="block w-full text-xs" type="file" data-testid="input-evidence-file" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setActionError(null);
                      upload.mutate({ data: { file } }, { onSuccess: (saved) => setEvidenceFile((current) => ({ ...current, [item.id]: { id: saved.storedFileId, name: saved.fileName } })), onError: (err) => setActionError((err as Error).message) });
                    }} />
                    {evidenceFile[item.id] && <p className="text-xs text-emerald-700">Attached {evidenceFile[item.id].name}</p>}
                    {upload.isPending && <p className="text-xs text-muted-foreground">Uploading…</p>}
                  </div>}
                  </div>)}
                </div>
              </div>)}
          </div>}
      {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}
    </section>}

    {tab === 'results' && <section className="mt-5 rounded-lg border bg-card p-5" data-testid="results-panel">
      <h2 className="text-base font-bold">Latest results</h2>
      {!data.latestResults.length ? <div className="mt-4"><EmptyState title="No results yet" detail="Submitted assessments appear here." /></div>
        : <div className="mt-4 space-y-2">{data.latestResults.map((result) => <div key={result.attemptId} className="flex items-center gap-3 rounded-lg border p-3"><FileCheck2 className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{result.assessmentTitle}</p><p className="text-xs text-muted-foreground">{result.courseTitle} - {result.status}</p></div>{result.awaitingGrading ? <Badge variant="outline">Awaiting grading</Badge> : <Status>{pct(result.percent ?? 0)}</Status>}{result.passed && <CheckCircle2 className="size-4 text-emerald-600" />}</div>)}</div>}
    </section>}

    {tab === 'certificates' && <section className="mt-5 rounded-lg border bg-card p-5" data-testid="certificates-panel">
      <h2 className="text-base font-bold">Certificates</h2>
      {!data.certificates.length ? <div className="mt-4"><EmptyState title="No certificates yet" detail="Certificates are issued after competence is confirmed." /></div>
        : <div className="mt-4 space-y-2">{data.certificates.map((certificate) => <div key={certificate.id} className="flex items-center gap-3 rounded-lg border p-3"><BookOpen className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{certificate.courseTitle}</p><p className="text-xs text-muted-foreground">Issued {fmtDate(certificate.issuedAt)}{certificate.expiresAt ? ` - expires ${fmtDate(certificate.expiresAt)}` : ''}</p></div><Badge variant={certificate.active ? 'default' : 'secondary'}>{certificate.status}</Badge><a href={certificate.printUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline" data-testid="certificate-print">Print</a></div>)}</div>}
    </section>}
  </div>;
}
