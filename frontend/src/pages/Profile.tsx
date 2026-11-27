import { Link } from 'wouter';
import { getGetLearnerDashboardQueryKey, useGetLearnerDashboard, useGetWorkspace } from '@api-client';
import { getSessionUser } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { PageHeading, Skeleton, Status, initials, pct } from '@/components/shared';
import { Bell, CalendarDays, Mail, MessageSquare, ShieldCheck, Target } from 'lucide-react';

export function ProfilePage() {
  const session = getSessionUser();
  const isLearner = session?.role === 'learner';
  const workspace = useGetWorkspace();
  const dashboard = useGetLearnerDashboard({
    query: { queryKey: getGetLearnerDashboardQueryKey(), enabled: isLearner, retry: false },
  });
  const user = workspace.data?.user;
  const learner = dashboard.data?.learner;
  const summary = dashboard.data?.summary;
  const name = learner?.name || user?.name || session?.name || 'Workspace user';
  const email = learner?.email || user?.email || session?.email || '';
  const role = user?.role || session?.role || 'member';

  return <div className="page-in" data-testid="profile-page">
    <PageHeading eyebrow="Your account" title="Know where you stand." detail="Your profile, learning snapshot and the fastest routes back to what matters." />

    <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-xl border border-border/70 bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground" data-testid="profile-initials">{initials(name)}</div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold" data-testid="profile-name">{name}</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground" data-testid="profile-email"><Mail className="size-4" />{email || 'No email on file'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" data-testid="profile-role">{role}</Badge>
              {user?.isOrgStaff && <Status>staff access</Status>}
              <span className="text-xs text-muted-foreground" data-testid="profile-org">{workspace.data?.organization.name || 'Workspace'}</span>
            </div>
          </div>
        </div>
        {learner?.department || learner?.jobFunction ? <dl className="mt-6 grid gap-3 border-t border-border/70 pt-5 text-sm sm:grid-cols-2">
          {learner.department && <div><dt className="text-xs text-muted-foreground">Department</dt><dd className="mt-1 font-semibold">{learner.department}</dd></div>}
          {learner.jobFunction && <div><dt className="text-xs text-muted-foreground">Job function</dt><dd className="mt-1 font-semibold">{learner.jobFunction}</dd></div>}
        </dl> : null}
        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          <Link href="/my-learning" className="flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold hover:bg-secondary/50" data-testid="profile-link-learning"><Target className="size-4 text-primary" />My learning</Link>
          <Link href="/calendar" className="flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold hover:bg-secondary/50" data-testid="profile-link-calendar"><CalendarDays className="size-4 text-primary" />Calendar</Link>
          <Link href="/messages" className="flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold hover:bg-secondary/50" data-testid="profile-link-messages"><MessageSquare className="size-4 text-primary" />Messages</Link>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-5" data-testid="profile-summary">
        <div className="flex items-center justify-between gap-2"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Learning snapshot</p><h2 className="mt-1 text-base font-bold">At a glance</h2></div><ShieldCheck className="size-5 text-primary" /></div>
        {isLearner && dashboard.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          : isLearner && summary ? <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-secondary/55 p-3"><p className="text-xs text-muted-foreground">Assigned</p><p className="mt-1 text-xl font-bold" data-testid="profile-assigned">{summary.assignedCourses}</p></div>
            <div className="rounded-xl bg-secondary/55 p-3"><p className="text-xs text-muted-foreground">Completed</p><p className="mt-1 text-xl font-bold" data-testid="profile-completed">{summary.completedCourses}</p></div>
            <div className="rounded-xl bg-secondary/55 p-3"><p className="text-xs text-muted-foreground">Overall</p><p className="mt-1 text-xl font-bold" data-testid="profile-progress">{pct(summary.overallProgress)}</p></div>
            <div className="rounded-xl bg-secondary/55 p-3"><p className="text-xs text-muted-foreground">Outstanding</p><p className="mt-1 text-xl font-bold" data-testid="profile-outstanding">{summary.outstandingActivities}</p></div>
            <div className="col-span-2 rounded-xl bg-secondary/55 p-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Bell className="size-3.5" />Unread notifications</p><p className="mt-1 text-sm font-semibold">{summary.unreadNotifications} unread</p></div>
            <div className="col-span-2 rounded-xl bg-secondary/55 p-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><MessageSquare className="size-3.5" />Message replies</p><p className="mt-1 text-sm font-semibold">{summary.awaitingTrainerReplies} awaiting trainer - {summary.awaitingLearnerReplies} awaiting you</p></div>
          </div>
            : <p className="mt-4 text-sm text-muted-foreground">Your learning summary is available from the learner view.</p>}
      </section>
    </div>
  </div>;
}
