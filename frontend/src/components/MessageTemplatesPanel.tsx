import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorState, Skeleton, Status } from '@/components/shared';
import {
  useCreateMessageTemplate,
  useDeactivateMessageTemplate,
  useMessageTemplates,
  useUpdateMessageTemplate,
} from '@/api/hooks';

export function MessageTemplatesPanel({ onInsert }: { onInsert?: (body: string) => void }) {
  const templates = useMessageTemplates();
  const create = useCreateMessageTemplate();
  const update = useUpdateMessageTemplate();
  const deactivate = useDeactivateMessageTemplate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setBody('');
    setEditingId(null);
  };

  const save = () => {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }
    setError(null);
    setMessage(null);
    const input = { title: title.trim(), body: body.trim() };
    const options = {
      onSuccess: () => {
        setMessage(editingId ? 'Canned response updated.' : 'Canned response created.');
        reset();
      },
      onError: (e: Error) => setError(e.message),
    };
    if (editingId) update.mutate({ id: editingId, patch: input }, options);
    else create.mutate(input, options);
  };

  const remove = (id: string) => {
    setError(null);
    setMessage(null);
    deactivate.mutate(id, {
      onSuccess: () => {
        setMessage('Canned response deactivated.');
        if (editingId === id) reset();
      },
      onError: (e: Error) => setError(e.message),
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-secondary/30 p-3" data-testid="message-templates-panel">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">Canned responses</p>
          <p className="text-xs text-muted-foreground">Reusable answers for this organization.</p>
        </div>
        <Status tone="neutral">{templates.data?.length ?? 0} active</Status>
      </div>
      {templates.isLoading ? <Skeleton className="h-16" />
        : templates.isError ? <ErrorState retry={() => templates.refetch()} />
        : !(templates.data?.length) ? <EmptyState title="No canned responses" detail="Add a reusable reply below." />
        : <div className="space-y-2">{templates.data.map((template) => (
          <div key={template.id} className="flex items-start gap-2 rounded-md border border-border/70 bg-background p-2" data-testid={`template-row-${template.id}`}>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">{template.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.body}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setEditingId(template.id); setTitle(template.title); setBody(template.body); }} data-testid={`edit-template-${template.id}`}>Edit</Button>
              {onInsert && <Button size="sm" variant="ghost" onClick={() => onInsert(template.body)} data-testid={`insert-template-${template.id}`}>Insert</Button>}
              <Button size="sm" variant="ghost" onClick={() => remove(template.id)} disabled={deactivate.isPending} data-testid={`remove-template-${template.id}`}>Remove</Button>
            </div>
          </div>
        ))}</div>}
      <div className="space-y-2 border-t border-border/70 pt-3">
        <Input placeholder="Response title" aria-label="Response title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-template-title" />
        <Textarea placeholder="Response body" aria-label="Response body" value={body} onChange={(e) => setBody(e.target.value)} data-testid="input-template-body" />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={create.isPending || update.isPending} data-testid="button-save-template">{editingId ? 'Update response' : 'Add response'}</Button>
          {editingId && <Button size="sm" variant="ghost" onClick={reset}>Cancel edit</Button>}
        </div>
      </div>
      {message && <p className="text-xs text-emerald-700" data-testid="templates-message">{message}</p>}
      {error && <p className="text-xs text-destructive" data-testid="templates-error">{error}</p>}
    </div>
  );
}
