import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './client';

export interface Organization {
  id: string;
  name: string;
  plan: string;
  learnerCount: number;
  programmeCount: number;
  defaultSlaHours?: number;
  samlEnabled?: boolean;
  samlIdpIssuer?: string;
  samlEntityId?: string;
  /** Round 8 / D.1: `{"unansweredHours":[…],"confirmedBeforeStartHours":[…],"maxUnanswered":n}`. */
  reminderCadenceJson?: string;
}

export interface ReminderCadence {
  unansweredHours: number[];
  confirmedBeforeStartHours: number[];
  maxUnanswered: number;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  isOrgStaff?: boolean;
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
  slaHours?: number | null;
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
  trainerId?: string | null;
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
  joinUrl?: string | null;
  videoLink?: string | null;
  attendees: number;
  capacity?: number | null;
  sequence?: number;
  canJoin?: boolean;
  status: string;
  myRsvpStatus?: 'invited' | 'confirmed' | 'waitlisted' | 'declined' | 'removed' | null;
  myWaitlistPosition?: number | null;
  icsUrl?: string;
  cancellationReason?: string | null;
  enrolled?: boolean;
}

export interface SessionRosterSummary {
  sessionId: string;
  capacity: number | null;
  attendeeCount: number;
  seatsTaken: number;
  seatsRemaining: number | null;
  invited: number;
  confirmed: number;
  waitlisted: number;
  declined: number;
  removed: number;
}

export interface SessionAttendee {
  id: string;
  rsvpId: string;
  learnerId: string;
  name: string;
  email: string;
  isActive: boolean;
  status: 'invited' | 'confirmed' | 'waitlisted' | 'declined' | 'removed';
  respondedAt: string | null;
  waitlistedAt: string | null;
  removalReason: string | null;
  removedAt: string | null;
  removedBy: string | null;
  createdAt: string;
}

export interface SessionAttendeesResponse extends SessionRosterSummary {
  attendees: SessionAttendee[];
  summary: SessionRosterSummary;
}

export interface SessionInvitableLearner {
  learnerId: string;
  id: string;
  name: string;
  email: string;
  eligible: true;
  reason: null;
}

export interface SessionInvitableResponse {
  sessionId: string;
  q: string;
  limit: number;
  total: number;
  nextCursor: string | null;
  learners: SessionInvitableLearner[];
  invitable: SessionInvitableLearner[];
  invitableLearners: SessionInvitableLearner[];
  skipped: { learnerId: string; name: string; email: string; reason: string }[];
}

export interface SessionInvitableOptions {
  q?: string;
  cursor?: string | null;
  enabled?: boolean;
}

export interface SessionInviteResultRow {
  learnerId: string;
  outcome: 'invited' | 'already_invited' | 'skipped';
  reason: string | null;
}

export interface SessionInviteResult {
  sessionId: string;
  allEnrolled: boolean;
  selectedCount: number;
  invited: number;
  newlyInvited: number;
  skipped: string[];
  skippedCount: number;
  skippedReasons: Record<string, string>;
  rejected: SessionInviteResultRow[];
  results: SessionInviteResultRow[];
}

export interface SessionRemoveAttendeeResult extends Omit<SessionAttendeesResponse, 'removed'> {
  removed: number;
  learnerId: string;
  previousStatus: string;
  reason: string | null;
  rsvp: Record<string, unknown>;
}

export type ThreadSlaState = 'ok' | 'reply_pending' | 'escalated';

export interface MessageThread {
  id: string;
  subject: string;
  context: string;
  participant: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  urgent: boolean;
  orgId?: string;
  programmeId?: string | null;
  courseId?: string | null;
  course?: { id: string; title: string } | null;
  slaHours?: number;
  participants?: Array<{ userId: string; role: string }>;
  isEscalated?: boolean;
  escalatedAt?: string | null;
  lastLearnerMessageAt?: string | null;
  lastTrainerResponseAt?: string | null;
  metadataOnly?: boolean;
  averageResponseTimeHours?: number | null;
  slaStatus?: string;
  slaState?: ThreadSlaState;
}

export interface ThreadFilters {
  programmeId?: string;
  courseId?: string;
  slaStatus?: ThreadSlaState;
}

export interface MessageTemplate {
  id: string;
  orgId: string;
  title: string;
  body: string;
  createdBy: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplateInput {
  title: string;
  body: string;
  isActive?: boolean;
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
  trainerId: string;
  courseId?: string;
  date: string;
  time: string;
}

export interface BookableTrainer {
  id: string;
  name: string;
  email: string;
}

export function useBookableTrainers() {
  return useQuery(queryOpts(['bookings', 'trainers'] as const, () => api<BookableTrainer[]>('/bookings/trainers')));
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

export interface Enrolment {
  id: string;
  learnerId: string;
  courseId: string;
  programmeId?: string;
  status: string;
  enrolmentScore?: number | null;
  managerSignOff?: boolean | null;
  // Round 8 / 1.3: where the applied score came from, and a result held back by an override.
  appliedAssessmentScore?: number | null;
  appliedScoreSource?: string | null;
  appliedScoreOverrideReason?: string | null;
  pendingAssessmentScore?: number | null;
  pendingAssessmentScoreAt?: string | null;
  contentCompletedAt?: string | null;
  completionDate?: string | null;
  reviewCreditLockedAt?: string | null;
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
  sessionAttendees: (sessionId: string) => ['sessions', sessionId, 'attendees'] as const,
  sessionInvitable: (sessionId: string, options?: { q?: string; cursor?: string | null }) => ['sessions', sessionId, 'invitable', options?.q ?? '', options?.cursor ?? null] as const,
  threads: ['threads'] as const,
  threadList: (filters: ThreadFilters = {}) => ['threads', 'list', filters.programmeId ?? null, filters.courseId ?? null, filters.slaStatus ?? null] as const,
  threadMessages: (threadId: string) => ['threads', threadId, 'messages'] as const,
  messageTemplates: ['message-templates'] as const,
  bookings: ['bookings'] as const,
  calendar: ['calendar'] as const,
  reviewCreditSettings: ['review-credit', 'settings'] as const,
  auditLogs: ['audit', 'logs'] as const,
  emailFailures: ['email-failures'] as const,
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
  slaHours?: number | null;
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
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; plan?: string; domain?: string; defaultSlaHours?: number; webhookUrls?: string[]; samlEnabled?: boolean; samlIdpCert?: string; samlIdpIssuer?: string; samlEntityId?: string; reminderCadence?: ReminderCadence } }) =>
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
      qc.invalidateQueries({ queryKey: ['course-content'] });
    },
  });
}


export function useCourses(programmeId?: string, enabled = true) {
  const qs = programmeId ? `?programmeId=${encodeURIComponent(programmeId)}` : '';
  return useQuery(queryOpts(qk.courses(programmeId), () => api<Course[]>(`/courses${qs}`), enabled));
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

export interface Module {
  id: string;
  courseId: string;
  title: string;
  order?: number;
}

export function useModules(programmeId: string, enabled = true) {
  return useQuery(queryOpts(qk.modules(programmeId), () => api<Module[]>(`/programmes/${programmeId}/modules`), enabled));
}

export function useCreateModule(programmeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { courseId: string; title: string }) =>
      api<Module>(`/programmes/${programmeId}/modules`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.modules(programmeId) });
      qc.invalidateQueries({ queryKey: ['programmes'] });
    },
  });
}

export interface ProgrammeMember {
  userId: string;
  name: string;
  email: string;
  department?: string | null;
  jobFunction?: string | null;
  role: string;
}

export type ProgrammeMemberRole = 'admin' | 'trainer' | 'learner' | 'stakeholder';

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  department?: string | null;
  jobFunction?: string | null;
  isActive: boolean;
  /** Round 7 gap 5: null until the person has opened their activation link (org staff only). */
  activatedAt?: string | null;
  roles: Array<{ role: string; programmeId: string | null; programmeName: string | null }>;
}

export function useUserDirectory(search = '', enabled = true) {
  return useQuery(
    queryOpts(
      ['users', search],
      () => api<DirectoryUser[]>(`/users${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`),
      enabled,
    ),
  );
}

export function useCreateOrgUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; department?: string; jobFunction?: string }) =>
      api<DirectoryUser>('/users', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['programmes'] });
    },
  });
}

export function useUpdateOrgUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; department?: string; jobFunction?: string; isActive?: boolean } }) =>
      api<DirectoryUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: qk.programmes });
    },
  });
}

/**
 * Round 7 gap 5: the resend-activation route existed but nothing called it, and nothing
 * showed who had not activated yet. Both live here now.
 */
export function useResendActivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean; emailSent?: boolean }>(`/users/${id}/resend-activation`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/**
 * Round 8 / 3.3: failed sends are written to `email_failures`, but until now nothing in the
 * product ever read them — a broken SMTP relay looked like a quiet one. Org staff see the
 * most recent failures and can dismiss one once it has been dealt with.
 */
export interface EmailFailure {
  id: string;
  to: string;
  subject: string;
  kind: string;
  error: string;
  createdAt: string;
  userId: string | null;
}

export function useEmailFailures(limit = 20) {
  return useQuery(
    queryOpts(
      [...qk.emailFailures, limit],
      () => api<{ items: EmailFailure[]; limit: number; offset: number }>(`/email-failures?limit=${limit}`),
    ),
  );
}

export function useDismissEmailFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/email-failures/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.emailFailures }),
  });
}

export function useSetOrgRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api<{ userId: string; orgRole: string | null }>(`/users/${userId}/org-role`, { method: 'POST', body: JSON.stringify({ role }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useProgrammeMembers(programmeId: string, enabled = true) {
  return useQuery(
    queryOpts(['programme-members', programmeId], () => api<ProgrammeMember[]>(`/programmes/${programmeId}/members`), enabled && !!programmeId),
  );
}

export function useAddProgrammeMember(programmeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role?: ProgrammeMemberRole; roles?: ProgrammeMemberRole[]; enrol?: boolean }) =>
      api<ProgrammeMember>(`/programmes/${programmeId}/members`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programme-members', programmeId] });
      qc.invalidateQueries({ queryKey: ['enrolments'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: qk.programmes });
    },
  });
}

export function useUpdateProgrammeMember(programmeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role, roles, name }: { userId: string; role?: ProgrammeMemberRole; roles?: ProgrammeMemberRole[]; name?: string }) =>
      api<ProgrammeMember>(`/programmes/${programmeId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role, roles, name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programme-members', programmeId] });
      qc.invalidateQueries({ queryKey: ['enrolments'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: qk.programmes });
    },
  });
}

export function useRemoveProgrammeMember(programmeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ userId: string; removed: number; coursesUnassigned: number }>(`/programmes/${programmeId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programme-members', programmeId] });
      qc.invalidateQueries({ queryKey: ['enrolments'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: qk.programmes });
    },
  });
}

export function useSessions() {
  return useQuery(queryOpts(qk.sessions, () => api<TrainingSession[]>('/sessions')));
}

export function useThreads(filters: ThreadFilters = {}) {
  const params = new URLSearchParams();
  if (filters.programmeId) params.set('programmeId', filters.programmeId);
  if (filters.courseId) params.set('courseId', filters.courseId);
  if (filters.slaStatus) params.set('slaStatus', filters.slaStatus);
  const qs = params.toString();
  return useQuery(queryOpts(qk.threadList(filters), () => api<MessageThread[]>(`/threads${qs ? `?${qs}` : ''}`)));
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

export function useUpdateThreadSla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, slaHours }: { threadId: string; slaHours: number }) =>
      api<MessageThread>(`/threads/${threadId}/sla`, { method: 'PATCH', body: JSON.stringify({ slaHours }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads }),
  });
}

export function useRunSla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ escalated: number }>('/sla/run', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads }),
  });
}

export function useMessageTemplates(enabled = true) {
  return useQuery(queryOpts(qk.messageTemplates, () => api<MessageTemplate[]>('/message-templates'), enabled));
}

export function useCreateMessageTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MessageTemplateInput) =>
      api<MessageTemplate>('/message-templates', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.messageTemplates }),
  });
}

export function useUpdateMessageTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<MessageTemplateInput> }) =>
      api<MessageTemplate>(`/message-templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.messageTemplates }),
  });
}

export function useDeactivateMessageTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/message-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.messageTemplates }),
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

// Round 8 / 1.3: a manual override holds a later automatic result until staff decide.
export function useAcceptAssessmentScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrolmentId: string) =>
      api<{ enrolmentId: string }>(`/enrolments/${enrolmentId}/accept-assessment-score`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.enrolments });
    },
  });
}

export function useRejectAssessmentScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrolmentId: string) =>
      api<{ ok: boolean }>(`/enrolments/${enrolmentId}/reject-assessment-score`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.enrolments });
    },
  });
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

// ---------------------------------------------------------------------------
// Phase 2-5: threads, content, assessments, sessions and calendar feed
// ---------------------------------------------------------------------------

export interface NewThreadInput {
  subject: string;
  programmeId: string;
  courseId?: string;
  participantIds: string[];
  body: string;
  urgent?: boolean;
  slaHours?: number;
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewThreadInput) => api<MessageThread>('/threads', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads }),
  });
}

export type ContentType = 'native' | 'file' | 'external_link';

export interface ContentItem {
  id: string;
  moduleId?: string;
  type: ContentType;
  title: string;
  description?: string | null;
  order: number;
  required: boolean;
  estimatedMinutes?: number | null;
  body?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  url?: string | null;
  provider?: string | null;
  completionMode?: 'trainer_verified' | 'self_report' | null;
  isArchived?: boolean;
  progress?: { status: string; completedAt?: string | null; verifiedAt?: string | null };
}

export interface CourseContent {
  courseId: string;
  progress: number;
  modules: Array<{ id: string; title: string; order: number; contentItems: ContentItem[] }>;
}

export function useCourseContent(courseId: string, enabled = true) {
  return useQuery(queryOpts(['course-content', courseId] as const, () => api<CourseContent>(`/courses/${courseId}/content`), enabled && !!courseId));
}

export function useModuleContent(moduleId: string, enabled = true) {
  return useQuery(queryOpts(['module-content', moduleId] as const, () => api<ContentItem[]>(`/modules/${moduleId}/content`), enabled && !!moduleId));
}

export type ContentInput = Partial<Omit<ContentItem, 'id' | 'progress'>> & { type: ContentType; title: string };

export function useCreateContent(moduleId: string, courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContentInput) => api<ContentItem>(`/modules/${moduleId}/content`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module-content', moduleId] });
      if (courseId) qc.invalidateQueries({ queryKey: ['course-content', courseId] });
    },
  });
}

export function useUpdateContent(moduleId: string, courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ContentInput> }) => api<ContentItem>(`/content/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module-content', moduleId] });
      if (courseId) qc.invalidateQueries({ queryKey: ['course-content', courseId] });
    },
  });
}

export function useArchiveContent(moduleId: string, courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ContentItem>(`/content/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module-content', moduleId] });
      if (courseId) qc.invalidateQueries({ queryKey: ['course-content', courseId] });
    },
  });
}

/** An upload the API has stored and bound to this organization (A.3). */
export type UploadedFile = {
  storedFileId: string;
  storageKey?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  purpose?: string;
};

// A.3: multipart, not base64 in JSON. The JSON body parser caps a body at 100 KB, so anything
// larger than a small image used to fail with 413 before the request reached the route.
async function postFile(path: string, file: File, extraFields?: Record<string, string>): Promise<UploadedFile> {
  const body = new FormData();
  body.append('file', file, file.name);
  for (const [key, value] of Object.entries(extraFields ?? {})) body.append(key, value);
  return api<UploadedFile>(path, { method: 'POST', body, headers: {} });
}

export function useUploadContent(moduleId: string) {
  return useMutation({
    mutationFn: (file: File) => postFile(`/modules/${moduleId}/content/upload`, file),
  });
}

export function useUploadEvidence() {
  return useMutation({
    mutationFn: (file: File) => postFile('/uploads/evidence', file),
  });
}

export function useContentProgress(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, evidenceNote, evidenceFileId }: { id: string; status: 'in_progress' | 'completed'; evidenceNote?: string; evidenceFileId?: string }) =>
      api(`/content/${id}/progress`, { method: 'POST', body: JSON.stringify({ status, evidenceNote, evidenceFileId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-content', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export interface PendingVerification {
  id: string;
  evidenceNote?: string | null;
  evidenceFileId?: string | null;
  startedAt?: string | null;
  contentItem: { id: string; title: string; type: string; module: { id: string; courseId: string; course: { title: string; programmeId: string } } };
  enrolment: { id: string; learnerId: string; learner: { name: string; email: string } };
}

export function usePendingVerification(enabled = true) {
  return useQuery(queryOpts(['content-progress', 'pending'] as const, () => api<PendingVerification[]>('/content-progress/pending'), enabled));
}

export function useVerifyContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verified, note }: { id: string; verified: boolean; note?: string }) =>
      api(`/content-progress/${id}/verify`, { method: 'POST', body: JSON.stringify({ verified, note }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-progress', 'pending'] });
      qc.invalidateQueries({ queryKey: ['module-content'] });
      qc.invalidateQueries({ queryKey: ['course-content'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export type QuestionKind = 'single_choice' | 'multi_choice' | 'true_false' | 'short_answer' | 'scenario';

export interface AssessmentQuestion {
  id: string;
  kind: QuestionKind | string;
  prompt: string;
  points: number;
  order: number;
  scenarioContext?: string | null;
  rubric?: string | null;
  acceptedAnswers?: string | null;
  options?: Array<{ id: string; text: string; isCorrect?: boolean; order: number }>;
  // Present on create: when a published assessment is edited the question lands on a new version.
  assessmentId?: string;
  version?: number;
  versionCreated?: boolean;
}

export interface CourseAssessment {
  id: string;
  moduleId: string;
  type: 'recall' | 'applied';
  title: string;
  passMark: number;
  maxAttempts?: number | null;
  timeLimitMinutes?: number | null;
  isPublished: boolean;
  version?: number;
  publishedAt?: string | null;
  supersededAt?: string | null;
  supersedesId?: string | null;
  changeKind?: 'minor' | 'new_paper' | null;
  questions: AssessmentQuestion[];
  module?: { id: string; title: string };
  attemptCount: number;
  bestScore: number | null;
  remainingAttempts: number | null;
  locked: boolean;
}

export interface PublishImpact {
  enrolled: number;
  completed: number;
  notCompleted: number;
  withAttempts: number;
}

export function usePublishImpact(assessmentId: string, enabled = true) {
  return useQuery(queryOpts(['publish-impact', assessmentId] as const, () => api<PublishImpact>(`/assessments/${assessmentId}/publish-impact`), enabled && !!assessmentId));
}

export interface EvaluationStatus {
  pending: boolean;
  job: { id?: string; status?: string; attempts?: number; lastError?: string | null } | null;
  attempts: number;
  stale: boolean;
  lastError: string | null;
}

export function useEvaluationStatus(courseId: string, enabled = true) {
  return useQuery(queryOpts(['evaluation-status', courseId] as const, () => api<EvaluationStatus>(`/courses/${courseId}/evaluation-status`), enabled && !!courseId));
}

export function useRecalculationStatus(courseId: string, active: boolean, intervalMs = 2000) {
  const status = useEvaluationStatus(courseId, active);
  const pending = status.data?.pending;
  const stale = status.data?.stale;
  const jobStatus = status.data?.job?.status;

  useEffect(() => {
    if (!active || status.isError || pending !== true || stale || jobStatus === 'failed') return;
    const timer = setTimeout(() => { void status.refetch(); }, intervalMs);
    return () => clearTimeout(timer);
  }, [active, intervalMs, jobStatus, pending, stale, status.dataUpdatedAt, status.isError, status.refetch]);

  return status;
}

export function useCourseAssessments(courseId: string, enabled = true) {
  return useQuery(queryOpts(['course-assessments', courseId] as const, () => api<CourseAssessment[]>(`/courses/${courseId}/assessments`), enabled && !!courseId));
}

export function useAssessment(id: string, enabled = true) {
  return useQuery(queryOpts(['assessment', id] as const, () => api<CourseAssessment & { questions: AssessmentQuestion[] }>(`/assessments/${id}`), enabled && !!id));
}

export interface QuestionInput {
  kind: QuestionKind;
  prompt: string;
  points?: number;
  order?: number;
  scenarioContext?: string | null;
  rubric?: string | null;
  acceptedAnswers?: string[];
  options?: Array<{ text: string; isCorrect: boolean }>;
}

export function useCreateQuestion(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuestionInput) =>
      api<AssessmentQuestion>(`/assessments/${assessmentId}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      qc.invalidateQueries({ queryKey: ['module-assessments'] });
    },
  });
}

export function useUpdateQuestion(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<QuestionInput> }) =>
      api<AssessmentQuestion>(`/questions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', assessmentId] }),
  });
}

export function useDeleteQuestion(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ deleted: string }>(`/questions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', assessmentId] }),
  });
}

export function useReorderQuestions(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<{ assessmentId: string; order: string[] }>(`/assessments/${assessmentId}/questions/order`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', assessmentId] }),
  });
}

export function useUpdateAssessment(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; type?: 'recall' | 'applied'; passMark?: number; maxAttempts?: number | null; timeLimitMinutes?: number | null; confirmNewVersion?: boolean }) =>
      api<CourseAssessment & { supersededId?: string; redirectedTo?: string }>(`/assessments/${assessmentId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      qc.invalidateQueries({ queryKey: ['module-assessments'] });
      qc.invalidateQueries({ queryKey: ['course-assessments'] });
      if (data.id && data.id !== assessmentId) qc.invalidateQueries({ queryKey: ['assessment', data.id] });
      if (data.redirectedTo) qc.invalidateQueries({ queryKey: ['assessment', data.redirectedTo] });
    },
  });
}

export function usePublishAssessment(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: { changeKind?: 'minor' | 'new_paper' }) => api(`/assessments/${assessmentId}/publish`, { method: 'POST', body: JSON.stringify(input ?? {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      qc.invalidateQueries({ queryKey: ['module-assessments'] });
      qc.invalidateQueries({ queryKey: ['course-assessments'] });
    },
  });
}

export function useDiscardAssessmentDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assessmentId: string) => api<{ discarded: string; liveVersion: string }>(`/assessments/${assessmentId}/discard-draft`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['assessment', data.discarded] });
      qc.invalidateQueries({ queryKey: ['module-assessments'] });
      qc.invalidateQueries({ queryKey: ['course-assessments'] });
    },
  });
}

export interface LearnerQuestion {
  id: string;
  kind: string;
  type: string;
  prompt: string;
  points: number;
  order: number;
  scenarioContext?: string | null;
  options: Array<{ id: string; text: string; order: number }>;
}

export interface StartedAttempt {
  attemptId: string;
  attemptNumber: number;
  startedAt: string;
  expiresAt: string | null;
  timeLimitMinutes: number | null;
  assessmentId: string;
  version?: number;
  resumed?: boolean;
  questions: LearnerQuestion[];
  answers?: Array<{ questionId: string; optionIds: string[]; text: string | null }>;
  maxAttempts?: number | null;
  attemptsUsed?: number;
}

export function useStartAttempt(courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assessmentId: string) => api<StartedAttempt>(`/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-assessments', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export function useAttempt(attemptId: string, enabled = true) {
  return useQuery(queryOpts(['attempt', attemptId] as const, () => api<StartedAttempt & { status: string; percent: number | null }>(`/attempts/${attemptId}`), enabled && !!attemptId));
}

export function useSaveAttemptAnswers() {
  return useMutation({
    mutationFn: ({ attemptId, answers }: { attemptId: string; answers: Array<{ questionId: string; optionIds?: string[]; text?: string }> }) =>
      api<{ attemptId: string; saved: number; expiresAt: string | null }>(`/attempts/${attemptId}/answers`, { method: 'PUT', body: JSON.stringify({ answers }) }),
  });
}

export interface AttemptSubmission {
  attemptId: string;
  attemptNumber: number;
  status: 'graded' | 'grading';
  score: number | null;
  percent: number | null;
  passed: boolean | null;
  earnedPoints?: number;
  totalPoints?: number;
  passMark?: number;
  competenceMet?: boolean;
  message?: string;
  awaitingGrading?: number;
  graded?: boolean;
  results?: Array<{ questionId: string; kind?: string; correct: boolean | null; points: number | null; manual?: boolean }>;
  appliedScore?: number | null;
  certificateIssued?: boolean;
}

export function useSubmitAttemptAnswers(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, answers }: { attemptId: string; answers: Array<{ questionId: string; optionIds?: string[]; text?: string }> }) =>
      api<AttemptSubmission>(`/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-assessments', courseId] });
      qc.invalidateQueries({ queryKey: ['course-attempts', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: ['grading-queue'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export interface GradingQueueItem {
  id: string;
  attemptId: string;
  attemptNumber: number;
  submittedAt: string | null;
  learner: { id: string; name: string; email: string };
  assessment: { id: string; title: string | null; type: string };
  course: { id: string; title: string; programmeId: string };
  answered: number;
  answersStored: number;
}

export function useGradingQueue(enabled = true) {
  return useQuery(queryOpts(['grading-queue'] as const, () => api<GradingQueueItem[]>('/assessments/grading/queue'), enabled));
}

export interface GradingAttempt {
  attemptId: string;
  status: string;
  submittedAt: string | null;
  learner: { id: string; name: string; email: string };
  assessment: { id: string; title: string | null; type: string; version: number };
  score: number | null;
  percent: number | null;
  passed: boolean | null;
  questions: Array<{
    id: string;
    questionId: string;
    kind: string;
    prompt: string;
    points: number;
    scenarioContext: string | null;
    rubric: string | null;
    options: Array<{ id: string; text: string; isCorrect: boolean }>;
    answer: { id: string; optionIds: string[]; text: string | null; pointsAwarded: number | null; autoGraded: boolean; graderComment: string | null } | null;
  }>;
}

export function useGradingAttempt(attemptId: string, enabled = true) {
  return useQuery(queryOpts(['grading-attempt', attemptId] as const, () => api<GradingAttempt>(`/attempts/${attemptId}/answers`), enabled && !!attemptId));
}

export function useGradeAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, answers }: { attemptId: string; answers: Array<{ questionId: string; pointsAwarded: number; comment?: string }> }) =>
      api<AttemptSubmission>(`/attempts/${attemptId}/grade`, { method: 'POST', body: JSON.stringify({ answers }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grading-queue'] });
      qc.invalidateQueries({ queryKey: ['grading-attempt'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export interface SessionInput {
  title: string;
  programmeId?: string;
  courseId?: string;
  trainerId?: string;
  trainer?: string;
  date: string;
  time: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  mode?: 'online' | 'offline';
  joinUrl?: string;
  location?: string;
  capacity?: number | null;
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionInput) => api('/sessions', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sessions });
      qc.invalidateQueries({ queryKey: qk.calendar });
    },
  });
}

export function useSessionAttendees(sessionId: string, enabled = true) {
  return useQuery(queryOpts(qk.sessionAttendees(sessionId), () => api<SessionAttendeesResponse>(`/sessions/${sessionId}/attendees`), enabled));
}

export function useSessionInvitable(sessionId: string, options: SessionInvitableOptions = {}) {
  const { q = '', cursor = null, enabled = true } = options;
  const search = new URLSearchParams();
  if (q) search.set('q', q);
  if (cursor) search.set('cursor', cursor);
  const query = search.toString();
  return useQuery(queryOpts(qk.sessionInvitable(sessionId, { q, cursor }), () => api<SessionInvitableResponse>(`/sessions/${sessionId}/invitable${query ? `?${query}` : ''}`), enabled));
}

export function useInviteSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { learnerIds?: string[]; allEnrolled?: boolean } | string[]) => {
      const body = Array.isArray(input) ? { learnerIds: input } : input;
      return api<SessionInviteResult>(`/sessions/${sessionId}/invite`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sessionAttendees(sessionId) });
      qc.invalidateQueries({ queryKey: qk.sessionInvitable(sessionId) });
      qc.invalidateQueries({ queryKey: qk.sessions });
      qc.invalidateQueries({ queryKey: qk.calendar });
    },
  });
}

export function useRemoveSessionAttendee(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ learnerId, reason }: { learnerId: string; reason?: string }) =>
      api<SessionRemoveAttendeeResult>(`/sessions/${sessionId}/remove`, {
        method: 'POST',
        body: JSON.stringify({ learnerId, ...(reason ? { reason } : {}) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sessionAttendees(sessionId) });
      qc.invalidateQueries({ queryKey: qk.sessionInvitable(sessionId) });
      qc.invalidateQueries({ queryKey: qk.sessions });
      qc.invalidateQueries({ queryKey: qk.calendar });
    },
  });
}

export interface SessionUpdateInput extends Partial<SessionInput> {
  reason?: string;
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: SessionUpdateInput }) =>
      api(`/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.sessionAttendees(variables.sessionId) });
      qc.invalidateQueries({ queryKey: qk.sessions });
      qc.invalidateQueries({ queryKey: qk.calendar });
    },
  });
}

export function useCancelSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: string; reason?: string }) =>
      api(`/sessions/${sessionId}/cancel`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.sessionAttendees(variables.sessionId) });
      qc.invalidateQueries({ queryKey: qk.sessions });
      qc.invalidateQueries({ queryKey: qk.calendar });
    },
  });
}

export function useRsvpSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: string; status: 'confirmed' | 'declined' }) =>
      api(`/sessions/${sessionId}/rsvp`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export function useBulkRemoveProgrammeMembers(programmeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<{
        pendingApproval: boolean;
        removed?: number;
        withdrawn?: number;
        coursesUnassigned?: number;
        request?: { id: string };
      }>(`/programmes/${programmeId}/members/bulk-remove`, { method: 'POST', body: JSON.stringify({ userIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programme-members', programmeId] });
      qc.invalidateQueries({ queryKey: ['delete-requests'] });
      qc.invalidateQueries({ queryKey: ['enrolments'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export function useIcalToken() {
  // Round 8 / D.2: only the hash is stored, so the API can no longer return the token. A usable
  // URL comes from rotating it; this query only says whether a feed already exists.
  return useQuery(queryOpts(['ical-token'] as const, () => api<{ configured: boolean }>('/me/ical-token')));
}

export function useGenerateIcalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<{ token: string; url: string }>(`/users/${userId}/ical-token`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ical-token'] }),
  });
}

export function useCreateAssessment(moduleId: string, courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; type: 'recall' | 'applied'; passMark?: number; maxAttempts?: number; timeLimitMinutes?: number }) =>
      api<CourseAssessment>(`/modules/${moduleId}/assessments`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      if (courseId) qc.invalidateQueries({ queryKey: ['course-assessments', courseId] });
      qc.invalidateQueries({ queryKey: ['module-assessments', moduleId] });
    },
  });
}

export function useModuleAssessments(moduleId: string, enabled = true) {
  return useQuery(queryOpts(['module-assessments', moduleId] as const, () => api<CourseAssessment[]>(`/modules/${moduleId}/assessments`), enabled && !!moduleId));
}

export interface Notification {
  id: string;
  userId: string;
  orgId: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
}

/**
 * Round 7 gap 6: the badge needs the unread count on load, not only once the panel opens.
 * This is the cheap request — `unread=true&limit=1` returns one row plus the count — and it
 * refreshes on a slow interval, so a notification that arrives later appears without a page
 * reload. The full list is still fetched only when the panel is opened.
 */
export function useUnreadNotificationCount(enabled = true) {
  return useQuery({
    ...queryOpts(['notifications', 'unread-count'] as const, () => api<NotificationList>('/notifications?unread=true&limit=1'), enabled),
    refetchInterval: 60_000,
  });
}

export function useNotifications(enabled = true) {
  return useQuery(
    queryOpts(['notifications'] as const, () => api<NotificationList>('/notifications?limit=20'), enabled),
  );
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean; updated: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
