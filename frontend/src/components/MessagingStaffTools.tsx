import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Status } from '@/components/shared';
import { useRunSla, useUpdateThreadSla, type MessageThread } from '@/api/hooks';

export function canManageMessaging(user: { role?: string; isOrgStaff?: boolean } | null): boolean {
  if (!user) return false;
  if (user.isOrgStaff) return true;
  return ['owner', 'admin', 'trainer'].includes(user.role ?? '');
}

export function canEditThreadSla(user: { id?: string; role?: string; isOrgStaff?: boolean } | null, thread: MessageThread | null): boolean {
  if (!user || !thread) return false;
  if (user.isOrgStaff || ['owner', 'admin'].includes(user.role ?? '')) return true;
  const mine = thread.participants?.find((p) => p.userId === user.id);
  return ['owner', 'admin'].includes(mine?.role ?? '');
}

export function ThreadSlaControl({ thread }: { thread: MessageThread }) {
  const update = useUpdateThreadSla();
  const [hours, setHours] = useState(String(thread.slaHours ?? 24));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setHours(String(thread.slaHours ?? 24)), [thread.slaHours]);

  const save = () => {
    const value = Number(hours);
    if (!Number.isInteger(value) || value < 1 || value > 720) {
      setError('Response window must be between 1 and 720 hours.');
      return;
    }
    setError(null);
    setMessage(null);
    update.mutate({ threadId: thread.id, slaHours: value }, {
      onSuccess: () => setMessage(`Response window updated to ${value} hours.`),
      onError: (e: Error) => setError(e.message),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-secondary/30 p-2" data-testid="sla-editor">
      <span className="text-xs font-semibold">Response window (hours)</span>
      <Input type="number" min={1} max={720} className="h-8 w-24" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Response window hours" data-testid="input-thread-sla-hours" />
      <Button size="sm" onClick={save} disabled={update.isPending} data-testid="button-save-thread-sla">Save SLA</Button>
      {thread.slaState && <Status tone={thread.slaState === 'escalated' ? 'bad' : thread.slaState === 'reply_pending' ? 'warn' : 'good'}>{thread.slaState}</Status>}
      {message && <span className="text-xs text-emerald-700" data-testid="sla-editor-message">{message}</span>}
      {error && <span className="text-xs text-destructive" data-testid="sla-editor-error">{error}</span>}
    </div>
  );
}

export function ManualSlaRunButton() {
  const run = useRunSla();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => {
        setError(null);
        setMessage(null);
        run.mutate(undefined, {
          onSuccess: (result) => setMessage(`${result.escalated} thread(s) escalated.`),
          onError: (e: Error) => setError(e.message),
        });
      }} disabled={run.isPending} data-testid="button-run-sla">Run SLA check</Button>
      {message && <span className="text-xs text-emerald-700" data-testid="sla-run-message">{message}</span>}
      {error && <span className="text-xs text-destructive" data-testid="sla-run-error">{error}</span>}
    </div>
  );
}
