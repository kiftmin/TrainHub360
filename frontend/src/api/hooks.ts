import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './client';

export interface Organization {
  id: string;
  name: string;
  plan: string;
  learnerCount: number;
  programmeCount: number;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
}

export interface Workspace {
  organization: Organization;
  activeProgramme: Programme;
  user: CurrentUser;
  dataSource: string;
}

export interface Programme {
  id: string;
  name: string;
  type: string;
  status: string;
  learnerCount: number;
  courseCount: number;
  progress: number;
  owner: string;
}

export interface Course {
  id: string;
  title: string;
  programmeId: string;
  programmeName: string;
  category: string;
  progress: number;
  status: string;
  appliedThreshold: number;
  appliedScore: number | null;
  dueDate: string | null;
  trainer: string;
  duration?: string | null;
}

export interface CourseInput {
  title: string;
  programmeId: string;
  category: string;
  appliedThreshold?: number;
  dueDate?: string | null;
}

export interface ActivityPoint {
  label: string;
  active: number;
  completed: number;
}

export interface ExpiringCredential {
  name: string;
  course: string;
  expires: string;
  status: string;
}

export interface DashboardSummary {
  complianceHealth: number;
  completionRate: number;
  competencyRate: number;
  expiringCredentials: number;
  dropOffRate: number;
  timeToCompetency: number;
  trainerUtilization: number;
  weeklyActivity: ActivityPoint[];
  dropOffHeatmap: { label: string; value: number }[];
  expiringItems: ExpiringCredential[];
}

export interface KpiSummary {
  complianceHealth: number;
  completionRate: number;
  competencyRate: number;
  expiringCredentials: number;
  dropOffRate: number;
  timeToCompetency: number;
  trainerUtilization: number;
}

export interface TrainingSession {
  id: string;
  title: string;
  programme: string;
  date: string;
  time: string;
  mode: string;
  location?: string | null;
  videoLink?: string | null;
  attendees: number;
  status: string;
}

export interface MessageThread {
  id: string;
  subject: string;
  context: string;
  participant: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  urgent: boolean;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  author: string;
  body: string;
  createdAt: string;
  urgent: boolean;
}

export interface Booking {
  id: string;
  trainer: string;
  course: string;
  date: string;
  time: string;
  duration: string;
  status: string;
  meetingLink?: string | null;
}

export interface BookingInput {
  trainer: string;
  course?: string;
  date: string;
  time: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  type: string;
  accent: string;
  location?: string | null;
  meetingLink?: string | null;
}

export interface ReviewCreditSettings {
  enabled: boolean;
  maxWeighting: number;
  assessmentWeight: number;
  timelinessWeight: number;
  applicationWeight: number;
  requireManagerSignoff: boolean;
  collectApplicationScores: boolean;
  eligibleProgrammeTypes: string[];
}

export interface AssessmentResult {
  appliedScore: number;
  recallScore: number;
  passed: boolean;
  competenceMet: boolean;
  message: string;
}

export interface Enrolment {
  id: string;
  learnerId: string;
  courseId: string;
  status: string;
  enrolmentScore?: number | null;
  managerSignOff?: boolean | null;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  timestamp: string;
}

export const qk = {
  workspace: ['workspace'] as const,
  dashboardSummary: ['dashboard', 'summary'] as const,
  kpiSummary: ['kpi', 'summary'] as const,
  programmes: ['programmes'] as const,
  courses: (programmeId?: string) => ['courses', programmeId ?? 'all'] as const,
  sessions: ['sessions'] as const,
  threads: ['threads'] as const,
  threadMessages: (threadId: string) => ['threads', threadId, 'messages'] as const,
  bookings: ['bookings'] as const,
  calendar: ['calendar'] as const,
  reviewCreditSettings: ['review-credit', 'settings'] as const,
  auditLogs: ['audit', 'logs'] as const,
  enrolments: ['enrolments'] as const,
  modules: (programmeId: string) => ['programmes', programmeId, 'modules'] as const,
};

function queryOpts<T>(queryKey: readonly unknown[], fn: () => Promise<T>, enabled = true): UseQueryOptions<T> {
  return { queryKey, queryFn: fn, enabled, retry: 1, refetchOnWindowFocus: false };
}

export function useWorkspace() {
  return useQuery(queryOpts(qk.workspace, () => api<Workspace>('/workspace')));
}

export function useDashboardSummary() {
  return useQuery(queryOpts(qk.dashboardSummary, () => api<DashboardSummary>('/dashboard/summary')));
}

export function useKpiSummary() {
  return useQuery(
    queryOpts(qk.kpiSummary, async () => {
      try {
        return await api<KpiSummary>('/kpi/summary');
      } catch {
        const d = await api<DashboardSummary>('/dashboard/summary');
        return {
          complianceHealth: d.complianceHealth,
          completionRate: d.completionRate,
          competencyRate: d.competencyRate,
          expiringCredentials: d.expiringCredentials,
          dropOffRate: d.dropOffRate,
          timeToCompetency: d.timeToCompetency,
          trainerUtilization: d.trainerUtilization,
        } satisfies KpiSummary;
      }
    }),
  );
}

export function useProgrammes() {
  return useQuery(queryOpts(qk.programmes, () => api<Programme[]>('/programmes')));
}

export interface ProgrammeInput {
  name: string;
  type?: string;
  owner?: string;
}

export function useCreateProgramme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProgrammeInput) =>
      api<Programme>('/programmes', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.programmes });
    },
  });
}

export function useUpdateProgramme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProgrammeInput & { status: string; budget: number; progress: number }> }) =>
      api<Programme>(`/programmes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.programmes });
    },
  });
}

export function useUpdateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CourseInput & { status: string; trainer: string; duration: string; dueDate: string | null; progress: number }> }) =>
      api<Course>(`/courses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export type DeletionTarget = 'courses' | 'modules' | 'assessments';

export function useRequestContentDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, id, reason }: { target: DeletionTarget; id: string; reason?: string }) =>
      api<DeleteRequest>(`/${target}/${id}/delete-requests`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delete-requests'] });
      qc.invalidateQueries({ queryKey: ['programmes'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; plan?: string; domain?: string; webhookUrls?: string[] } }) =>
      api<Organization>(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workspace });
    },
  });
}

export function useUpdateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { title?: string; order?: number } }) =>
      api<Module>(`/modules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programmes'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}


export function useCourses(programmeId?: string) {
  const qs = programmeId ? `?programmeId=${encodeURIComponent(programmeId)}` : '';
  return useQuery(queryOpts(qk.courses(programmeId), () => api<Course[]>(`/courses${qs}`)));
}

export function useCreateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CourseInput) =>
      api<Course>('/courses', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export function useSubmitAttempt(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { appliedScore: number; recallScore: number }) =>
      api<AssessmentResult>(`/courses/${courseId}/attempts`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export interface Module {
  id: string;
  courseId: string;
  title: string;
}

export function useModules(programmeId: string, enabled = true) {
  return useQuery(queryOpts(qk.modules(programmeId), () => api<Module[]>(`/programmes/${programmeId}/modules`), enabled));
}

export function useSessions() {
  return useQuery(queryOpts(qk.sessions, () => api<TrainingSession[]>('/sessions')));
}

export function useThreads() {
  return useQuery(queryOpts(qk.threads, () => api<MessageThread[]>('/threads')));
}

export function useThreadMessages(threadId: string, enabled = true) {
  return useQuery(
    queryOpts(qk.threadMessages(threadId), () => api<ThreadMessage[]>(`/threads/${threadId}/messages`), !!threadId && enabled),
  );
}

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; urgent?: boolean }) =>
      api<ThreadMessage>(`/threads/${threadId}/messages`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.threadMessages(threadId) });
      qc.invalidateQueries({ queryKey: qk.threads });
    },
  });
}

export function useBookings() {
  return useQuery(queryOpts(qk.bookings, () => api<Booking[]>('/bookings')));
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingInput) =>
      api<Booking>('/bookings', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.bookings });
    },
  });
}

export function useCalendarEvents() {
  return useQuery(queryOpts(qk.calendar, () => api<CalendarEvent[]>('/calendar')));
}

export function useReviewCreditSettings() {
  return useQuery(queryOpts(qk.reviewCreditSettings, () => api<ReviewCreditSettings>('/review-credit/settings')));
}

export function useUpdateReviewCreditSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ReviewCreditSettings>) =>
      api<ReviewCreditSettings>('/review-credit/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reviewCreditSettings });
    },
  });
}

export function useAuditLogs() {
  return useQuery(queryOpts(qk.auditLogs, () => api<AuditLog[]>('/audit/logs')));
}

export function useEnrolments() {
  return useQuery(queryOpts(qk.enrolments, () => api<Enrolment[]>('/enrolments')));
}

export interface Certificate {
  id: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  certificateNumber: string;
  course?: { title: string };
  learner?: { name: string; email: string };
}

export function useCertificates() {
  return useQuery(queryOpts(['certificates'] as const, () => api<Certificate[]>('/certificates')));
}

export interface Recognition {
  id: string;
  type: string;
  awardedAt: string;
  context: string | null;
}

export function useRecognitions() {
  return useQuery(queryOpts(['recognitions'] as const, () => api<Recognition[]>('/recognitions')));
}

export interface DeleteRequest {
  id: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
  requester?: { name: string; email: string };
  approver?: { name: string; email: string } | null;
}

export function useDeleteRequests() {
  return useQuery(queryOpts(['delete-requests'] as const, () => api<DeleteRequest[]>('/delete-requests')));
}

export function useRequestDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programmeId, reason }: { programmeId: string; reason?: string }) =>
      api<DeleteRequest>(`/programmes/${programmeId}/delete-requests`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delete-requests'] });
    },
  });
}

export function useDecideDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api<DeleteRequest>(`/delete-requests/${id}/${decision}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delete-requests'] });
      qc.invalidateQueries({ queryKey: qk.programmes });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export async function downloadReviewCreditCsv(): Promise<void> {
  const csv = await api<string>('/review-credit/export');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'trainhub360-review-credit.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
