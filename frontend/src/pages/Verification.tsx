import { useState } from 'react';
import { FileSearch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PageHeading, Skeleton, EmptyState, ErrorState, Status } from '@/components/shared';
import { getToken } from '@/api/client';
import { usePendingVerification, useVerifyContent } from '@/api/hooks';

const messageOf = (error: unknown) => (error as Error)?.message ?? 'Something went wrong';

async function openEvidence(id: string) {
  const token = getToken();
  const res = await fetch(`/api/content-progress/${id}/evidence`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Could not open the evidence (API ${res.status}).`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function VerificationPage() {
  const queue = usePendingVerification();
  const verify = useVerifyContent();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const decide = (id: string, verified: boolean) => {
    setError(null);
    const note = (notes[id] ?? '').trim();
    if (!verified && !note) {
      setError('A rejection needs a note so the learner knows what to change.');
      return;
    }
    verify.mutate({ id, verified, note: note || undefined }, {
      onSuccess: () => setNotes((current) => { const next = { ...current }; delete next[id]; return next; }),
      onError: (e) => setError(messageOf(e)),
    });
  };

  return <div className="page-in">
    <PageHeading eyebrow="Content evidence" title="Verification queue." detail="External-link proof from your programmes waits here. Confirm it, or send it back with what needs to change."
      action={<Button variant="outline" size="sm" onClick={() => queue.refetch()} disabled={queue.isFetching}><RefreshCw className={cn('size-3.5', queue.isFetching && 'animate-spin')} />Refresh</Button>} />
    <section className="rounded-xl border border-border/70 bg-card p-5">
      {error && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="verification-error">{error}</p>}
      {queue.isLoading ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      : queue.isError ? <ErrorState retry={() => queue.refetch()} />
      : !queue.data?.length ? <EmptyState title="Nothing to verify" detail="Evidence submitted against trainer-verified content will appear here." />
      : <div className="space-y-4">
        {queue.data.map((row) => <div key={row.id} className="rounded-xl border border-border/70 p-4" data-testid={`verification-row-${row.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{row.contentItem.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.enrolment.learner.name} - {row.enrolment.learner.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.contentItem.module.course.title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Status tone="warn">awaiting verification</Status>
              {row.startedAt && <span className="font-mono text-[10px] text-muted-foreground">since {new Date(row.startedAt).toLocaleDateString('en-GB')}</span>}
            </div>
          </div>
          {row.evidenceNote && <p className="mt-3 rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">{row.evidenceNote}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {row.evidenceFileId && <Button size="sm" variant="outline" onClick={() => openEvidence(row.id).catch((e) => setError(messageOf(e)))} data-testid={`button-evidence-${row.id}`}><FileSearch className="size-3.5" />View evidence</Button>}
            <Input className="h-9 min-w-[220px] flex-1" placeholder="Note for a rejection (required to reject)" value={notes[row.id] ?? ''} onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })} data-testid={`input-verification-note-${row.id}`} />
            <Button size="sm" disabled={verify.isPending} onClick={() => decide(row.id, true)} data-testid={`button-verify-${row.id}`}>Verify</Button>
            <Button size="sm" variant="outline" disabled={verify.isPending} onClick={() => decide(row.id, false)} data-testid={`button-reject-${row.id}`}>Reject</Button>
          </div>
        </div>)}
      </div>}
    </section>
  </div>;
}
