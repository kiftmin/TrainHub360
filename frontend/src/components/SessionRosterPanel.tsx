import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, Status } from '@/components/shared';
import {
  useCancelSession,
  useInviteSession,
  useRemoveSessionAttendee,
  useSessionAttendees,
  useSessionInvitable,
  useUpdateSession,
  type SessionAttendee,
  type SessionInviteResult,
} from '@/api/hooks';

export function canManageSessionRoster(user: { role?: string; isOrgStaff?: boolean } | null): boolean {
  if (!user) return false;
  if (user.isOrgStaff) return true;
  return ['owner', 'admin', 'trainer'].includes(user.role ?? '');
}

const statuses: SessionAttendee['status'][] = ['confirmed', 'waitlisted', 'invited', 'declined'];

function toneFor(status: SessionAttendee['status']): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'confirmed') return 'good';
  if (status === 'waitlisted') return 'warn';
  if (status === 'declined') return 'bad';
  return 'neutral';
}

export function SessionRosterPanel({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const attendees = useSessionAttendees(sessionId);
  const invitable = useSessionInvitable(sessionId);
  const invite = useInviteSession(sessionId);
  const remove = useRemoveSessionAttendee(sessionId);
  const update = useUpdateSession();
  const cancel = useCancelSession();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [title, setTitle] = useState(sessionTitle);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTitle(sessionTitle), [sessionTitle]);

  const summary = attendees.data?.summary;
  const grouped = useMemo(
    () => statuses.map((status) => ({ status, rows: (attendees.data?.attendees ?? []).filter((row) => row.status === status) })),
    [attendees.data],
  );

  const inviteSelected = () => {
    if (!selected.length) {
      setError('Choose at least one learner to invite.');
      return;
    }
    setError(null);
    setMessage(null);
    invite.mutate(selected, {
      onSuccess: (result: SessionInviteResult) => {
        const reasons = Object.entries(result.skippedReasons).map(([id, value]) => `${id}: ${value}`).join(', ');
        setMessage(`${result.newlyInvited} invited, ${result.skipped.length} skipped${reasons ? ` (${reasons})` : ''}.`);
        setSelected([]);
      },
      onError: (cause) => setError((cause as Error).message),
    });
  };

  const removeAttendee = (row: SessionAttendee) => {
    const priorWaitlisted = summary?.waitlisted ?? 0;
    setError(null);
    setMessage(null);
    remove.mutate(
      { learnerId: row.learnerId, reason: reason.trim() || undefined },
      {
        onSuccess: (result) => {
          const promoted = result.summary.waitlisted < priorWaitlisted;
          setMessage(`Removed ${row.name}${promoted ? '; waitlist promotion completed' : ''}.`);
        },
        onError: (cause) => setError((cause as Error).message),
      },
    );
  };

  const saveTitle = () => {
    if (!title.trim()) {
      setError('A session title is required.');
      return;
    }
    setError(null);
    setMessage(null);
    update.mutate(
      { sessionId, input: { title: title.trim(), reason: reason.trim() || undefined } },
      {
        onSuccess: () => setMessage('Session details updated.'),
        onError: (cause) => setError((cause as Error).message),
      },
    );
  };

  const cancelSession = () => {
    setError(null);
    setMessage(null);
    cancel.mutate(
      { sessionId, reason: reason.trim() || undefined },
      {
        onSuccess: () => setMessage('Session cancelled and attendees notified.'),
        onError: (cause) => setError((cause as Error).message),
      },
    );
  };

  const busy = invite.isPending || remove.isPending || update.isPending || cancel.isPending;

  return <section className="mt-5 rounded-lg border border-border/80 bg-card p-5" data-testid="session-roster-panel">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Trainer tools</p>
        <h2 className="mt-1 text-base font-bold">Session roster</h2>
      </div>
      {summary && <div data-testid="roster-capacity"><Status tone={summary.seatsRemaining === 0 ? 'warn' : 'good'}>
        {summary.capacity === null ? `${summary.attendeeCount} attending` : `${summary.attendeeCount}/${summary.capacity} seats`}
      </Status></div>}
    </div>

    {summary && <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-testid="roster-summary">
      {(['invited', 'confirmed', 'waitlisted', 'declined'] as const).map((key) => (
        <div key={key} className="rounded-md bg-secondary/50 p-3"><p className="text-muted-foreground">{key}</p><p className="mt-1 text-lg font-bold">{summary[key]}</p></div>
      ))}
    </div>}

    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
      <label className="block text-xs font-semibold">Session title<Input className="mt-2" value={title} onChange={(event) => setTitle(event.target.value)} data-testid="input-session-roster-title" /></label>
      <label className="block text-xs font-semibold">Reason (optional)<Input className="mt-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Added to notices and audit" data-testid="input-session-reason" /></label>
      <div className="flex items-end"><Button variant="outline" disabled={busy} onClick={saveTitle} data-testid="button-update-session">Save title</Button></div>
      <div className="flex items-end"><Button variant="outline" disabled={busy} onClick={cancelSession} data-testid="button-cancel-session">Cancel session</Button></div>
    </div>

    <div className="mt-5 rounded-lg border border-border/70 p-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold">Invite learners</h3><Button size="sm" disabled={busy || !selected.length} onClick={inviteSelected} data-testid="button-invite-selected">Invite selected</Button></div>
      {invitable.isLoading ? <p className="mt-3 text-xs text-muted-foreground">Loading learners…</p>
        : <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(invitable.data?.learners ?? []).map((learner) => <label key={learner.learnerId} className="flex items-center gap-2 rounded-md bg-secondary/40 p-2 text-xs" data-testid={`invitable-${learner.learnerId}`}>
            <input type="checkbox" checked={selected.includes(learner.learnerId)} onChange={(event) => setSelected(event.target.checked ? [...selected, learner.learnerId] : selected.filter((id) => id !== learner.learnerId))} />
            <span className="min-w-0"><span className="block truncate font-semibold">{learner.name}</span><span className="block truncate text-muted-foreground">{learner.email}</span></span>
          </label>)}
          {!(invitable.data?.learners ?? []).length && <p className="text-xs text-muted-foreground">No eligible learners are left to invite.</p>}
        </div>}
      {!!invitable.data?.skipped.length && <div className="mt-3 space-y-1" data-testid="invitable-skipped">
        {invitable.data.skipped.map((row) => <p key={row.learnerId} className="text-[11px] text-muted-foreground">{row.name}: {row.reason.replace(/_/g, ' ')}</p>)}
      </div>}
    </div>

    <div className="mt-5 space-y-3" data-testid="roster-attendees">
      <h3 className="text-sm font-bold">Attendees</h3>
      {attendees.isLoading ? <p className="text-xs text-muted-foreground">Loading roster…</p>
        : attendees.isError ? <ErrorState retry={() => attendees.refetch()} />
          : grouped.map((group) => <div key={group.status}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.status} ({group.rows.length})</p>
            <div className="space-y-1">
              {group.rows.map((row) => <div key={row.rsvpId} className="flex items-center gap-3 rounded-md border border-border/60 p-2" data-testid={`attendee-${row.learnerId}`}>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.name}</p><p className="truncate text-[11px] text-muted-foreground">{row.email}</p></div>
                <Status tone={toneFor(row.status)}>{row.status}</Status>
                {row.status !== 'declined' && <Button size="sm" variant="outline" disabled={busy} onClick={() => removeAttendee(row)} data-testid={`remove-attendee-${row.learnerId}`}>Remove</Button>}
              </div>)}
              {!group.rows.length && <p className="text-[11px] text-muted-foreground">None</p>}
            </div>
          </div>)}
      {!attendees.isLoading && !(attendees.data?.attendees ?? []).length && <EmptyState title="No attendees yet" detail="Invite eligible learners to start the roster." />}
    </div>

    {message && <p className="mt-4 text-xs font-semibold text-emerald-600" data-testid="roster-message">{message}</p>}
    {error && <p className="mt-4 text-xs text-destructive" data-testid="roster-error">{error}</p>}
  </section>;
}
