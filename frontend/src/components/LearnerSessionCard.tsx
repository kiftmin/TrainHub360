import { Button } from '@/components/ui/button';
import { fmtDate, Status } from '@/components/shared';
import { downloadSessionIcs } from '@/api/client';
import type { TrainingSession } from '@/api/hooks';

type RsvpStatus = 'confirmed' | 'declined';

export function LearnerSessionCard({ session, onRsvp, pending }: {
  session: TrainingSession;
  onRsvp: (status: RsvpStatus) => void;
  pending: boolean;
}) {
  const cancelled = session.status === 'cancelled';
  const tone = cancelled ? 'bad' : session.myRsvpStatus === 'waitlisted' ? 'warn' : 'good';
  return <article data-testid={`learner-session-${session.id}`} className="rounded-lg border border-border/70 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{session.title}</p>
        <p className="text-xs text-muted-foreground">{session.programme} · {fmtDate(session.date)} · {session.time} · {session.attendees} attending</p>
      </div>
      <Status tone={tone}>{cancelled ? 'cancelled' : session.status}</Status>
    </div>
    <p data-testid={`rsvp-status-${session.id}`} className="mt-2 text-xs">
      RSVP: {session.myRsvpStatus ?? (session.enrolled ? 'enrolled — no reply yet' : 'not replied')}
    </p>
    {session.myRsvpStatus === 'waitlisted' && <p data-testid={`waitlist-position-${session.id}`} className="mt-1 text-xs text-muted-foreground">
      Waitlist position #{session.myWaitlistPosition ?? '—'}
    </p>}
    {cancelled && <p data-testid={`cancel-reason-${session.id}`} className="mt-1 text-xs text-destructive">
      Cancelled{session.cancellationReason ? `: ${session.cancellationReason}` : ''}
    </p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" data-testid={`confirm-${session.id}`} disabled={cancelled || pending} onClick={() => onRsvp('confirmed')}>Confirm</Button>
      <Button size="sm" variant="outline" data-testid={`decline-${session.id}`} disabled={cancelled || pending} onClick={() => onRsvp('declined')}>Decline</Button>
      <Button size="sm" variant="ghost" data-testid={`ics-${session.id}`} onClick={() => void downloadSessionIcs(session.id).catch(() => undefined)}>Add to calendar (.ics)</Button>
    </div>
    {session.canJoin && session.joinUrl && <a data-testid={`join-link-${session.id}`} className="mt-2 block text-xs text-primary underline" href={session.joinUrl} target="_blank" rel="noreferrer">Join session</a>}
    {session.canJoin && session.location && <p data-testid={`location-${session.id}`} className="mt-1 text-xs text-muted-foreground">Location: {session.location}</p>}
  </article>;
}
