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
  type SessionInvitableLearner,
  type SessionInviteResult,
} from '@/api/hooks';

export function canManageSessionRoster(user: { role?: string; isOrgStaff?: boolean } | null): boolean {
  if (!user) return false;
  if (user.isOrgStaff) return true;
  return ['owner', 'admin', 'trainer'].includes(user.role ?? '');
}

const statuses: SessionAttendee['status'][] = ['confirmed', 'waitlisted', 'invited', 'declined', 'removed'];

function toneFor(status: SessionAttendee['status']): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'confirmed') return 'good';
  if (status === 'waitlisted') return 'warn';
  if (status === 'declined' || status === 'removed') return 'bad';
  return 'neutral';
}

export function SessionRosterPanel({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const attendees = useSessionAttendees(sessionId);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [learners, setLearners] = useState<SessionInvitableLearner[]>([]);
  const [skipped, setSkipped] = useState<Array<{ learnerId: string; name: string; email: string; reason: string }>>([]);
  const [total, setTotal] = useState(0);
  const invitable = useSessionInvitable(sessionId, { q: debouncedSearch, cursor });
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setDebouncedSearch(next.length >= 2 ? next : '');
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setLearners([]);
    setSkipped([]);
    setSelected([]);
    setTotal(0);
  }, [sessionId, debouncedSearch]);

  useEffect(() => {
    if (!invitable.data) return;
    const incoming = invitable.data.learners;
    setTotal(invitable.data.total);
    setLearners((current) => {
      if (!cursor) return incoming;
      const known = new Set(current.map((row) => row.learnerId));
      return [...current, ...incoming.filter((row) => !known.has(row.learnerId))];
    });
    setSkipped((current) => {
      if (!cursor) return invitable.data.skipped;
      const known = new Set(current.map((row) => row.learnerId));
      return [...current, ...invitable.data.skipped.filter((row) => !known.has(row.learnerId))];
    });
  }, [invitable.data, cursor]);

  const summary = attendees.data?.summary;
  const grouped = useMemo(
    () => statuses.map((status) => ({ status, rows: (attendees.data?.attendees ?? []).filter((row) => row.status === status) })),
    [attendees.data],
  );

  const inviteMessage = (result: SessionInviteResult) => {
    const reasons = Object.entries(result.skippedReasons).map(([id, value]) => `${id}: ${value}`).join(', ');
    return `${result.newlyInvited} invited, ${result.skipped.length} skipped${reasons ? ` (${reasons})` : ''}.`;
  };

  const onInviteSuccess = (result: SessionInviteResult) => {
    setMessage(inviteMessage(result));
    setSelected([]);
  };

  const inviteSelected = () => {
    if (!selected.length) {
      setError('Choose at least one learner to invite.');
      return;
    }
    setError(null);
    setMessage(null);
    invite.mutate(selected, {
      onSuccess: onInviteSuccess,
      onError: (cause) => setError((cause as Error).message),
    });
  };

  const inviteAll = () => {
    setError(null);
    setMessage(null);
    invite.mutate({ allEnrolled: true }, {
      onSuccess: onInviteSuccess,
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

  return <section className="mt-5 rounded-xl border border-border/70 bg-card p-5" data-testid="session-roster-panel">
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

    <div className="mt-5 rounded-xl border border-border/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-bold">Invite learners</h3><p className="text-[11px] text-muted-foreground" data-testid="invitable-total">{total} eligible</p></div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground" data-testid="invitable-selected-count">{selected.length} selected</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={inviteAll} data-testid="button-invite-all">Invite all eligible</Button>
          <Button size="sm" disabled={busy || !selected.length} onClick={inviteSelected} data-testid="button-invite-selected">Invite selected</Button>
        </div>
      </div>
      <Input className="mt-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email (2+ characters)" data-testid="input-invitable-search" />
      {invitable.isError ? <div className="mt-3"><ErrorState retry={() => invitable.refetch()} /></div>
        : invitable.isLoading && !learners.length ? <p className="mt-3 text-xs text-muted-foreground">Loading learners…</p>
          : <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {learners.map((learner) => <label key={learner.learnerId} className="flex items-center gap-2 rounded-md bg-secondary/40 p-2 text-xs" data-testid={`invitable-${learner.learnerId}`}>
              <input type="checkbox" checked={selected.includes(learner.learnerId)} onChange={(event) => setSelected(event.target.checked ? [...selected, learner.learnerId] : selected.filter((id) => id !== learner.learnerId))} />
              <span className="min-w-0"><span className="block truncate font-semibold">{learner.name}</span><span className="block truncate text-muted-foreground">{learner.email}</span></span>
            </label>)}
            {!learners.length && <p className="text-xs text-muted-foreground">No eligible learners are left to invite.</p>}
          </div>}
      {invitable.data?.nextCursor && <div className="mt-3"><Button size="sm" variant="ghost" disabled={invitable.isFetching || busy} onClick={() => setCursor(invitable.data?.nextCursor ?? null)} data-testid="button-invitable-more">Load more</Button></div>}
      {!!skipped.length && <div className="mt-3 space-y-1" data-testid="invitable-skipped">
        {skipped.map((row) => <p key={row.learnerId} className="text-[11px] text-muted-foreground">{row.name}: {row.reason.replace(/_/g, ' ')}</p>)}
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
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.name}</p><p className="truncate text-[11px] text-muted-foreground">{row.email}</p>{row.status === 'removed' && row.removalReason && <p className="truncate text-[11px] text-destructive" data-testid={`attendee-removal-reason-${row.learnerId}`}>{row.removalReason}</p>}</div>
                <Status tone={toneFor(row.status)}>{row.status}</Status>
                {['invited', 'confirmed', 'waitlisted'].includes(row.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => removeAttendee(row)} data-testid={`remove-attendee-${row.learnerId}`}>Remove</Button>}
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
