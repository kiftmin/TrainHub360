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
  useUpdateOrganization,
  useDashboardSummary,
  useKpiSummary,
  useProgrammes,
  useCourses,
  useCreateCourse,
  useSubmitAttempt,
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
  useCertificates,
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
  CircleAlert, Clock3, Download, FileCheck2, Gauge, GraduationCap, KeyRound, LayoutDashboard,
  Menu, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search, Send, Settings2,
  ShieldCheck, SlidersHorizontal, Target, Users, X, Zap,
} from 'lucide-react';

import { fmtDate, pct, initials, Skeleton, EmptyState, ErrorState, Status, ProgressLine, PageHeading, KpiCard } from '@/components/shared';
export function SettingsPage() {
  const workspace = useWorkspace();
  const updateOrg = useUpdateOrganization();
  const sqc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; plan: string; domain: string } | null>(null);
  const [samlForm, setSamlForm] = useState<{ samlEnabled: boolean; samlIdpIssuer: string; samlEntityId: string; samlIdpCert: string } | null>(null);
  const [samlSaved, setSamlSaved] = useState(false);
  const user = workspace.data?.user;
  const org = workspace.data?.organization;
  const canEditOrg = ['admin', 'owner'].includes(user?.role ?? '');
  const values = form ?? { name: org?.name || '', plan: org?.plan || '', domain: (org as { domain?: string })?.domain || '' };
  const samlValues = samlForm ?? {
    samlEnabled: (org as { samlEnabled?: boolean })?.samlEnabled ?? false,
    samlIdpIssuer: (org as { samlIdpIssuer?: string })?.samlIdpIssuer ?? '',
    samlEntityId: (org as { samlEntityId?: string })?.samlEntityId ?? 'trainhub360',
    samlIdpCert: '',
  };
  const save = () => {
    if (!org || !form) return;
    setSaveError(null);
    updateOrg.mutate({ id: org.id, patch: { name: form.name, plan: form.plan, domain: form.domain || undefined } }, {
      onSuccess: () => { sqc.invalidateQueries({ queryKey: ['workspace'] }); setForm(null); setSaved(true); window.setTimeout(() => setSaved(false), 2200); },
      onError: (e) => setSaveError((e as Error).message),
    });
  };
  const saveSaml = () => {
    if (!org) return;
    setSaveError(null);
    updateOrg.mutate({ id: org.id, patch: {
      samlEnabled: samlValues.samlEnabled,
      samlIdpIssuer: samlValues.samlIdpIssuer || undefined,
      samlEntityId: samlValues.samlEntityId || undefined,
      samlIdpCert: samlValues.samlIdpCert || undefined,
    } }, {
      onSuccess: () => { sqc.invalidateQueries({ queryKey: ['workspace'] }); setSamlSaved(true); window.setTimeout(() => setSamlSaved(false), 2200); },
      onError: (e) => setSaveError((e as Error).message),
    });
  };
  return <div className="page-in">
    <PageHeading eyebrow="Workspace administration" title="A calm control room." detail="Keep roles, identity, and governance details aligned with how work actually runs." action={canEditOrg ? <Button onClick={save} disabled={!form || updateOrg.isPending}>{saved ? <><Check className="size-4" />Saved</> : updateOrg.isPending ? 'Saving…' : 'Save changes'}</Button> : undefined} />
    {workspace.isLoading ? <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
    : workspace.isError ? <ErrorState retry={() => workspace.refetch()} />
    : <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-lg border border-border/80 bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Identity</p><h2 className="mt-1 text-base font-bold">Workspace details</h2>
        {saveError && <p className="mt-2 text-sm text-destructive">Save failed ({saveError})</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Organisation<Input className="mt-2" value={values.name} readOnly={!canEditOrg} onChange={(e) => setForm({ ...values, name: e.target.value })} /></label><label className="text-xs font-semibold">Plan<Input className="mt-2" value={values.plan} readOnly={!canEditOrg} onChange={(e) => setForm({ ...values, plan: e.target.value })} /></label><label className="text-xs font-semibold">Domain<Input className="mt-2" value={values.domain} readOnly={!canEditOrg} placeholder="company.com" onChange={(e) => setForm({ ...values, domain: e.target.value })} /></label><label className="text-xs font-semibold">Workspace ID<Input className="mt-2 font-mono text-xs" value={org?.id || ''} readOnly /></label></div>
        <div className="mt-4 rounded-lg bg-secondary/55 p-3"><div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{user?.initials}</div><div><p className="text-sm font-semibold">{user?.name}</p><p className="text-xs text-muted-foreground">{user?.email}</p></div><Status tone="good">{user?.role}</Status></div></div>
      </section>
      <div className="space-y-4">
        <section className="rounded-lg border border-border/80 bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Governance</p><h2 className="mt-1 text-base font-bold">Data source</h2><p className="mt-2 text-sm text-muted-foreground">Backend API at <span className="font-mono">/api</span> proxied to <span className="font-mono">localhost:4000</span>. Source: <span className="font-mono">{workspace.data?.dataSource}</span>.</p><div className="mt-3 flex items-center gap-2 text-sm"><Gauge className="size-4 text-primary" />JWT session via localStorage <span className="font-mono text-xs">th360_token</span></div></section>
        <section className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Single sign-on</p><h2 className="mt-1 text-base font-bold">SAML configuration</h2></div><KeyRound className="size-4 text-muted-foreground" /></div>
          <p className="mt-2 text-xs text-muted-foreground">Configure a SAML identity provider (Okta, Azure AD, OneLogin, etc.) to let users authenticate via your corporate directory.</p>
          <div className="mt-4 space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm"><span>Enable SSO</span><Toggle checked={samlValues.samlEnabled} onCheckedChange={(checked) => setSamlForm({ ...samlValues, samlEnabled: checked })} /></label>
            <label className="text-xs font-semibold">IdP Entity ID / Issuer<Input className="mt-2 font-mono text-xs" value={samlValues.samlIdpIssuer} placeholder="https://idp.company.com" onChange={(e) => setSamlForm({ ...samlValues, samlIdpIssuer: e.target.value })} /></label>
            <label className="text-xs font-semibold">SP Entity ID<Input className="mt-2 font-mono text-xs" value={samlValues.samlEntityId} placeholder="trainhub360" onChange={(e) => setSamlForm({ ...samlValues, samlEntityId: e.target.value })} /></label>
            <label className="text-xs font-semibold">IdP X.509 certificate<textarea className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" rows={4} value={samlValues.samlIdpCert} placeholder={"-----BEGIN CERTIFICATE-----\nMIIDpDCCAoygAwIBAgIG..."} onChange={(e) => setSamlForm({ ...samlValues, samlIdpCert: e.target.value })} /></label>
            {canEditOrg && <Button size="sm" onClick={saveSaml} disabled={updateOrg.isPending}>{samlSaved ? <><Check className="size-3.5" />Saved</> : 'Save SAML config'}</Button>}
          </div>
        </section>
      </div>
    </div>}
  </div>;
}
