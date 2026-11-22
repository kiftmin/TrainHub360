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
  useCertificates, useRecognitions,
  useCourseContent,
  useContentProgress,
  useUploadEvidence,
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
export function MyLearning() {
  const courses = useCourses();
  const events = useCalendarEvents();
  const certs = useCertificates();
  const recognitions = useRecognitions();
  const active = (courses.data || []).filter((c) => c.status !== 'archived').slice(0, 4);
  const done = (courses.data || []).filter((c) => c.progress >= 100);
  const [contentCourseId, setContentCourseId] = useState<string>('');
  const contentCourse = contentCourseId || active[0]?.id || '';
  const content = useCourseContent(contentCourse, !!contentCourse);
  const progress = useContentProgress(contentCourse);
  // A.3: proof is uploaded through /uploads/evidence and referenced by id, so the learner is
  // not limited to a text note and the API can bind the file to the organization.
  const evidenceUpload = useUploadEvidence();
  const [evidenceFile, setEvidenceFile] = useState<Record<string, { id: string; name: string }>>({});
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  return <div className="page-in">
    <PageHeading eyebrow="My learning" title="Your path, in order." detail="Active courses, upcoming schedule, and earned certificates." />
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-lg border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Active path</p><h2 className="mt-1 text-base font-bold">Up next</h2>
        {courses.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : courses.isError ? <div className="mt-4"><ErrorState retry={() => courses.refetch()} /></div>
        : !active.length ? <div className="mt-4"><EmptyState title="Nothing assigned" detail="New courses will appear here." /></div>
        : <div className="mt-4 space-y-3">{active.map((c) => <div key={c.id} className="rounded-lg border border-border/70 p-4"><div className="flex justify-between gap-3"><p className="truncate text-sm font-semibold">{c.title}</p><span className="font-mono text-xs">{pct(c.progress)}</span></div><p className="mt-1 text-xs text-muted-foreground">{c.programmeName} - due {fmtDate(c.dueDate)}</p><div className="mt-3"><ProgressLine value={c.progress} /></div></div>)}</div>}
      </section>
      <section className="mt-5 rounded-lg border border-border/80 bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Course content</p>
        <div className="mt-2 flex items-center gap-2">
          <select className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={contentCourse} onChange={(e) => setContentCourseId(e.target.value)} data-testid="select-content-course">
            {(courses.data || []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <Status>{content.data?.progress ?? 0}%</Status>
        </div>
        {!contentCourse ? <div className="mt-4"><EmptyState title="No course selected" detail="Pick a course to start learning." /></div>
        : content.isLoading ? <div className="mt-4"><Skeleton className="h-24" /></div>
        : content.isError ? <div className="mt-4"><ErrorState retry={() => content.refetch()} /></div>
        : !content.data?.modules.length ? <div className="mt-4"><EmptyState title="No content yet" detail="Your trainer has not added content for this course." /></div>
        : <div className="mt-4 space-y-4">{content.data.modules.map((m) => <div key={m.id} className="rounded-lg border border-border/70 p-4">
          <p className="text-sm font-semibold">{m.title}</p>
          <div className="mt-2 space-y-2">{m.contentItems.map((item) => <div key={item.id} className="rounded-md bg-secondary/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}{item.required ? ' *' : ''}</p><p className="text-xs text-muted-foreground">{item.type.replace('_', ' ')}{item.estimatedMinutes ? ` - ${item.estimatedMinutes} min` : ''} - {item.progress?.status?.replace('_', ' ') ?? 'not started'}</p></div>
              <div className="flex shrink-0 gap-2">
                {item.type === 'external_link' && item.url && <a href={item.url} target="_blank" rel="noreferrer noopener" className="text-xs font-semibold text-primary underline">Open link</a>}
                {item.type === 'file' && <a href={`/api/content/${item.id}/download`} className="text-xs font-semibold text-primary underline">Download</a>}
                <Button size="sm" variant="outline" disabled={progress.isPending || evidenceUpload.isPending || item.progress?.status === 'completed'} onClick={() => progress.mutate({ id: item.id, status: 'completed', evidenceNote: evidence[item.id], evidenceFileId: evidenceFile[item.id]?.id }, { onError: (e) => setEvidenceError((e as Error).message) })}>Mark complete</Button>
              </div>
            </div>
            {item.type === 'native' && item.body && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>}
            {item.type === 'external_link' && item.completionMode === 'trainer_verified' && item.progress?.status !== 'completed' && <div className="mt-2 space-y-1">
              <Input placeholder="Evidence note for trainer verification" value={evidence[item.id] ?? ''} onChange={(e) => setEvidence({ ...evidence, [item.id]: e.target.value })} />
              <label className="block text-xs text-muted-foreground">Or attach proof (pdf, office, image, zip)
                <input className="mt-1 block w-full text-xs" type="file" disabled={evidenceUpload.isPending} data-testid="input-evidence-file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setEvidenceError(null);
                    evidenceUpload.mutate(file, {
                      onSuccess: (saved) => setEvidenceFile((current) => ({ ...current, [item.id]: { id: saved.storedFileId, name: saved.fileName } })),
                      onError: (err) => setEvidenceError((err as Error).message),
                    });
                  }} />
              </label>
              {evidenceUpload.isPending && <p className="text-xs text-muted-foreground">Uploading…</p>}
              {evidenceFile[item.id] && <p className="text-xs text-emerald-700">Attached {evidenceFile[item.id].name}</p>}
              {evidenceError && <p className="text-xs text-destructive">{evidenceError}</p>}
            </div>}
          </div>)}</div>
        </div>)}</div>}
      </section>
      <div className="space-y-5">
        <section className="rounded-lg border border-border/80 bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Schedule</p><h2 className="mt-1 text-base font-bold">Coming up</h2>
          {events.isLoading ? <div className="mt-4"><Skeleton className="h-24" /></div>
          : events.isError ? <div className="mt-4"><ErrorState retry={() => events.refetch()} /></div>
          : <div className="mt-4 space-y-2">{(events.data || []).slice(0, 4).map((e) => <div key={e.id} className="flex items-center gap-3 rounded-lg bg-secondary/55 p-3"><div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{e.title}</p><p className="text-xs text-muted-foreground">{fmtDate(e.date)} - {e.time}</p></div></div>)}
          {!events.data?.length && <EmptyState title="No sessions scheduled" detail="Book coaching from the calendar." />}</div>}
        </section>
        <section className="rounded-lg border border-border/80 bg-primary p-5 text-primary-foreground"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/60">Certificates</p><h2 className="mt-1 text-base font-bold">{certs.data?.length ?? done.length} earned</h2><p className="mt-1 text-xs text-primary-foreground/65">Completed courses issue a verifiable certificate.</p>
          {recognitions.data && recognitions.data.length > 0 && <div className="mt-3 space-y-2">{recognitions.data.slice(0, 3).map((r) => <div key={r.id} className="rounded-lg bg-accent/20 p-2.5 text-xs"><p className="font-semibold">- {r.type.replace(/_/g, ' ')}</p><p className="opacity-70">{fmtDate(r.awardedAt)}</p></div>)}</div>}
          {certs.data && certs.data.length > 0 && <div className="mt-3 space-y-2">{certs.data.slice(0, 4).map((c) => <div key={c.id} className="rounded-lg bg-primary-foreground/10 p-2.5 text-xs"><p className="font-semibold">{c.course?.title ?? 'Course'}</p><p className="opacity-70">Issued {fmtDate(c.issuedAt)}{c.expiresAt ? ` - expires ${fmtDate(c.expiresAt)}` : ''} - {c.status}</p></div>)}</div>}
        </section>
      </div>
    </div>
  </div>;
}



