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

export function fmtDate(date?: string | null) {
  if (!date) return '—';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function pct(value?: number | null) { return `${Math.round(value ?? 0)}%`; }

export function initials(name?: string) { return name?.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'TH'; }

export function Skeleton({ className }: { className?: string }) { return <div className={cn('skeleton rounded-lg', className)} />; }

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/55 p-6 text-center">
    <div className="mb-3 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground"><FileCheck2 className="size-5" /></div>
    <p className="font-semibold text-foreground">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}
  </div>;
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center">
    <CircleAlert className="mb-3 size-6 text-destructive" /><p className="font-semibold">Could not load this view</p><p className="mt-1 text-sm text-muted-foreground">The workspace service did not respond. Try again.</p>
    {retry && <Button variant="outline" size="sm" className="mt-4" onClick={retry}>Retry</Button>}
  </div>;
}

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <Badge variant="outline" className={cn('font-mono text-[10px] uppercase tracking-[.12em]', tone === 'good' && 'border-emerald-600/25 bg-emerald-50 text-emerald-700', tone === 'warn' && 'border-amber-600/25 bg-amber-50 text-amber-700', tone === 'bad' && 'border-destructive/25 bg-destructive/5 text-destructive')}>{children}</Badge>;
}

export function ProgressLine({ value, color = 'bg-primary' }: { value: number; color?: string }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

export function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[.22em] text-primary">{eyebrow}</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-foreground md:text-[2.45rem]">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{detail}</p></div>{action}</div>;
}

export function KpiCard({ label, value, detail, icon: Icon, tone = 'primary' }: { label: string; value: string; detail: string; icon: typeof Gauge; tone?: 'primary' | 'accent' | 'good' | 'warn' }) {
  return <div className="group rounded-xl border border-border/80 bg-card p-4 shadow-[0_7px_24px_rgba(25,51,57,.035)] transition-transform duration-200 hover:-translate-y-0.5"><div className="flex items-start justify-between"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</p><div className={cn('grid size-8 place-items-center rounded-lg', tone === 'accent' ? 'bg-accent/20 text-foreground' : tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-primary/10 text-primary')}><Icon className="size-4" /></div></div><p className="mt-4 text-2xl font-extrabold tracking-[-.04em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

