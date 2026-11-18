import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Search, Users, UserCheck, ShieldCheck } from 'lucide-react';
import { useUserDirectory, useCreateOrgUser, useUpdateOrgUser, useSetOrgRole, type DirectoryUser } from '@/api/hooks';
import { getSessionUser } from '@/api/client';
import { BulkImportButton } from '@/components/BulkImport';
import { initials, Skeleton, EmptyState, Status, PageHeading, KpiCard } from '@/components/shared';

const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-xs font-normal';

export function People() {
  const session = getSessionUser();
  const isOrgStaff = !!session?.isOrgStaff;
  const isOrgOwner = session?.role === 'owner';
  const [search, setSearch] = useState('');
  const directory = useUserDirectory(search);
  const createUser = useCreateOrgUser();
  const updateUser = useUpdateOrgUser();
  const setOrgRole = useSetOrgRole();

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', department: '', jobFunction: '' });
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | { id: string; name: string; email: string; department: string; jobFunction: string }>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<DirectoryUser | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = directory.data || [];
  const orgRoleOf = (u: DirectoryUser) => u.roles.find((r) => r.programmeId === null)?.role ?? '';
  const activeCount = rows.filter((u) => u.isActive).length;
  const staffCount = rows.filter((u) => ['owner', 'admin'].includes(orgRoleOf(u))).length;

  const submitAdd = () => {
    if (!addForm.name.trim() || !addForm.email.trim()) return;
    setAddError(null);
    createUser.mutate(
      { name: addForm.name.trim(), email: addForm.email.trim(), department: addForm.department.trim() || undefined, jobFunction: addForm.jobFunction.trim() || undefined },
      {
        onSuccess: () => { setAddOpen(false); setAddForm({ name: '', email: '', department: '', jobFunction: '' }); },
        onError: (e) => setAddError((e as Error).message),
      },
    );
  };
  const submitEdit = () => {
    if (!editing || !editing.name.trim()) return;
    setEditError(null);
    updateUser.mutate(
      { id: editing.id, patch: { name: editing.name.trim(), department: editing.department.trim(), jobFunction: editing.jobFunction.trim() } },
      { onSuccess: () => setEditing(null), onError: (e) => setEditError((e as Error).message) },
    );
  };
  const confirmToggle = () => {
    if (!toggling) return;
    setToggleError(null);
    updateUser.mutate(
      { id: toggling.id, patch: { isActive: !toggling.isActive } },
      { onSuccess: () => setToggling(null), onError: (e) => setToggleError((e as Error).message) },
    );
  };
  const changeOrgRole = (u: DirectoryUser, role: string) => {
    setActionError(null);
    setOrgRole.mutate({ userId: u.id, role }, { onError: (e) => setActionError((e as Error).message) });
  };

  return <div className="page-in">
    <PageHeading
      eyebrow="People"
      title="The organization directory."
      detail="Provision people here once; programme managers grant programme roles from the directory."
      action={isOrgStaff ? <div className="flex items-center gap-2">
        <BulkImportButton />
        <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) setAddError(null); }}>
          <DialogTrigger asChild><Button data-testid="button-add-user"><Plus className="size-4" />Add user</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add a user to the organization</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <label className="block text-xs font-semibold">Full name<Input className="mt-2" placeholder="e.g. Thandi Mokoena" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} data-testid="input-user-name" /></label>
              <label className="block text-xs font-semibold">Work email<Input className="mt-2" type="email" placeholder="person@company.com" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} data-testid="input-user-email" /></label>
              <label className="block text-xs font-semibold">Department (optional)<Input className="mt-2" placeholder="e.g. Operations" value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })} /></label>
              <label className="block text-xs font-semibold">Job function (optional)<Input className="mt-2" placeholder="e.g. Site supervisor" value={addForm.jobFunction} onChange={(e) => setAddForm({ ...addForm, jobFunction: e.target.value })} /></label>
              {addError && <p className="text-xs text-destructive" data-testid="text-add-user-error">{addError}</p>}
              <Button className="w-full" disabled={createUser.isPending || !addForm.name.trim() || !addForm.email.trim()} onClick={submitAdd} data-testid="button-submit-user">{createUser.isPending ? 'Adding…' : 'Add user'}</Button>
              <p className="text-xs text-muted-foreground">Programme roles are granted by programme managers under Programmes → Members. New users set their password via “Forgot password” on the sign-in screen.</p>
            </div>
          </DialogContent>
        </Dialog>
      </div> : undefined}
    />
    <div className="grid gap-3 md:grid-cols-3">
      <KpiCard label="People" value={`${rows.length}`} detail={search.trim() ? 'Matching your search' : 'In the organization directory'} icon={Users} />
      <KpiCard label="Active" value={`${activeCount}`} detail="Can sign in and learn" icon={UserCheck} tone="good" />
      <KpiCard label="Org staff" value={`${staffCount}`} detail="Owners and administrators" icon={ShieldCheck} tone="accent" />
    </div>
    <section className="mt-4 overflow-hidden rounded-lg border border-border/80 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
        <div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Directory</p><h2 className="mt-1 text-base font-bold">Everyone in the organization</h2></div>
        <div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="w-64 pl-8" placeholder="Search name, email, department…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-directory-search" /></div>
      </div>
      {actionError && <p className="border-b border-border/70 bg-destructive/5 px-4 py-2 text-xs text-destructive" data-testid="text-directory-error">{actionError}</p>}
      {directory.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      : directory.isError ? <div className="p-4"><EmptyState title="Directory unavailable" detail={(directory.error as Error)?.message ?? 'Could not load the directory.'} /></div>
      : !rows.length ? <div className="p-4"><EmptyState title={search.trim() ? 'No matching people' : 'No people yet'} detail={search.trim() ? 'Try a different name, email or department.' : 'Add users here, then programme managers can grant them roles.'} /></div>
      : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2.5">Person</th><th className="px-4 py-2.5">Department</th><th className="px-4 py-2.5">Org role</th><th className="px-4 py-2.5">Programme roles</th><th className="px-4 py-2.5">Status</th>{isOrgStaff && <th className="px-4 py-2.5 text-right">Actions</th>}</tr></thead>
        <tbody className="divide-y divide-border/70">{rows.map((u) => {
          const isSelf = u.id === session?.id;
          const programmeRoles = u.roles.filter((r) => r.programmeId !== null);
          return <tr key={u.id} className={u.isActive ? undefined : 'opacity-60'} data-testid={`row-user-${u.id}`}>
            <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(u.name)}</div><div className="min-w-0"><p className="truncate font-semibold">{u.name}{isSelf && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(you)</span>}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div></div></td>
            <td className="px-4 py-2.5 text-muted-foreground">{u.department || '—'}{u.jobFunction ? <span className="block text-xs">{u.jobFunction}</span> : null}</td>
            <td className="px-4 py-2.5">{isOrgStaff && !isSelf
              ? <select className={selectClass} value={orgRoleOf(u)} disabled={!u.isActive || setOrgRole.isPending} onChange={(e) => changeOrgRole(u, e.target.value)} data-testid={`select-org-role-${u.id}`}>
                  <option value="">No org role</option>
                  <option value="admin">admin</option>
                  {isOrgOwner && <option value="owner">owner</option>}
                </select>
              : orgRoleOf(u) ? <Status tone="good">{orgRoleOf(u)}</Status> : <span className="text-xs text-muted-foreground">—</span>}</td>
            <td className="px-4 py-2.5">{programmeRoles.length
              ? <div className="flex max-w-64 flex-wrap gap-1">{programmeRoles.map((r, i) => <span key={i} className="rounded-md bg-secondary/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">{r.programmeName ?? 'Programme'} · {r.role}</span>)}</div>
              : <span className="text-xs text-muted-foreground">None</span>}</td>
            <td className="px-4 py-2.5"><Status tone={u.isActive ? 'good' : 'bad'}>{u.isActive ? 'active' : 'deactivated'}</Status></td>
            {isOrgStaff && <td className="px-4 py-2.5"><div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditError(null); setEditing({ id: u.id, name: u.name, email: u.email, department: u.department ?? '', jobFunction: u.jobFunction ?? '' }); }} data-testid={`button-edit-user-${u.id}`}>Edit</Button>
              <Button size="sm" variant="outline" disabled={isSelf} title={isSelf ? 'You cannot deactivate your own account' : undefined} onClick={() => { setToggleError(null); setToggling(u); }} data-testid={`button-toggle-user-${u.id}`}>{u.isActive ? 'Deactivate' : 'Reactivate'}</Button>
            </div></td>}
          </tr>;
        })}</tbody>
      </table></div>}
    </section>

    <Dialog open={!!editing} onOpenChange={(v) => { if (!v) { setEditing(null); setEditError(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit user</DialogTitle></DialogHeader>
        {editing && <div className="space-y-4 pt-2">
          <label className="block text-xs font-semibold">Email<Input className="mt-2" value={editing.email} disabled /></label>
          <label className="block text-xs font-semibold">Full name<Input className="mt-2" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="input-edit-user-name" /></label>
          <label className="block text-xs font-semibold">Department<Input className="mt-2" value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })} /></label>
          <label className="block text-xs font-semibold">Job function<Input className="mt-2" value={editing.jobFunction} onChange={(e) => setEditing({ ...editing, jobFunction: e.target.value })} /></label>
          {editError && <p className="text-xs text-destructive">{editError}</p>}
          <Button className="w-full" disabled={updateUser.isPending || !editing.name.trim()} onClick={submitEdit} data-testid="button-save-user">{updateUser.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!toggling} onOpenChange={(v) => { if (!v) { setToggling(null); setToggleError(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{toggling?.isActive ? 'Deactivate user' : 'Reactivate user'}</DialogTitle></DialogHeader>
        {toggling && <div className="space-y-4 pt-2">
          {toggling.isActive
            ? <p className="text-sm text-muted-foreground">Deactivate <span className="font-semibold text-foreground">{toggling.name}</span> ({toggling.email})? They are signed out immediately and can no longer sign in. Programme memberships and enrolment history are kept.</p>
            : <p className="text-sm text-muted-foreground">Reactivate <span className="font-semibold text-foreground">{toggling.name}</span> ({toggling.email})? They regain access with their existing programme roles.</p>}
          {toggleError && <p className="text-xs text-destructive">{toggleError}</p>}
          <Button className="w-full" disabled={updateUser.isPending} onClick={confirmToggle} data-testid="button-confirm-toggle-user">{updateUser.isPending ? 'Saving…' : toggling.isActive ? 'Deactivate' : 'Reactivate'}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}