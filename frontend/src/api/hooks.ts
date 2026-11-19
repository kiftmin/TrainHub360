import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './client';

export interface Organization {
  id: string;
  name: string;
  plan: string;
  learnerCount: number;
  programmeCount: number;
  samlEnabled?: boolean;
  samlIdpIssuer?: string;
  samlEntityId?: string;
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
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; plan?: string; domain?: string; webhookUrls?: string[]; samlEnabled?: boolean; samlIdpCert?: string; samlIdpIssuer?: string; samlEntityId?: string } }) =>
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useUploadContent(moduleId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await fileToBase64(file);
      return api<{ storageKey: string; fileName: string; mimeType: string; sizeBytes: number; checksum: string }>(`/modules/${moduleId}/content/upload`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 }),
      });
    },
  });
}

export function useContentProgress(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, evidenceNote, evidenceFileKey }: { id: string; status: 'in_progress' | 'completed'; evidenceNote?: string; evidenceFileKey?: string }) =>
      api(`/content/${id}/progress`, { method: 'POST', body: JSON.stringify({ status, evidenceNote, evidenceFileKey }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-content', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export function useVerifyContent(moduleId: string, courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verified, note }: { id: string; verified: boolean; note?: string }) =>
      api(`/content-progress/${id}/verify`, { method: 'POST', body: JSON.stringify({ verified, note }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module-content', moduleId] });
      if (courseId) qc.invalidateQueries({ queryKey: ['course-content', courseId] });
    },
  });
}

export interface AssessmentQuestion {
  id: string;
  kind: string;
  prompt: string;
  points: number;
  order: number;
  options?: Array<{ id: string; text: string; isCorrect?: boolean; order: number }>;
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
  questions: AssessmentQuestion[];
  module?: { id: string; title: string };
  attemptCount: number;
  bestScore: number | null;
  remainingAttempts: number | null;
  locked: boolean;
}

export function useCourseAssessments(courseId: string, enabled = true) {
  return useQuery(queryOpts(['course-assessments', courseId] as const, () => api<CourseAssessment[]>(`/courses/${courseId}/assessments`), enabled && !!courseId));
}

export function useAssessment(id: string, enabled = true) {
  return useQuery(queryOpts(['assessment', id] as const, () => api<CourseAssessment & { questions: AssessmentQuestion[] }>(`/assessments/${id}`), enabled && !!id));
}

export function useCreateQuestion(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { prompt: string; type: 'recall' | 'applied'; points?: number; options: Array<{ text: string; isCorrect: boolean }> }) =>
      api<AssessmentQuestion>(`/assessments/${assessmentId}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', assessmentId] }),
  });
}

export function usePublishAssessment(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/assessments/${assessmentId}/publish`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      qc.invalidateQueries({ queryKey: ['course-assessments'] });
    },
  });
}

export interface StartedAttempt {
  attemptId: string;
  attemptNumber: number;
  startedAt: string;
  expiresAt: string | null;
  timeLimitMinutes: number | null;
  assessmentId: string;
  questions: Array<{ id: string; type: string; prompt: string; points: number; order: number; options: Array<{ id: string; text: string; order: number }> }>;
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

export interface AttemptSubmission {
  attemptId: string;
  attemptNumber: number;
  score: number;
  earnedPoints: number;
  totalPoints: number;
  passMark: number;
  passed: boolean;
  competenceMet: boolean;
  results: Array<{ questionId: string; correct: boolean; points: number }>;
}

export function useSubmitAttemptAnswers(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, answers }: { attemptId: string; answers: Array<{ questionId: string; optionIds: string[] }> }) =>
      api<AttemptSubmission>(`/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-assessments', courseId] });
      qc.invalidateQueries({ queryKey: ['course-attempts', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
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

export function useInviteSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (learnerIds: string[]) => api<{ invited: number; skipped: string[] }>(`/sessions/${sessionId}/invite`, { method: 'POST', body: JSON.stringify({ learnerIds }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
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
      api<{ removed: number; withdrawn: number; coursesUnassigned: number; requiresApproval?: boolean; deleteRequestId?: string }>(`/programmes/${programmeId}/members/bulk-remove`, { method: 'POST', body: JSON.stringify({ userIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programme-members', programmeId] });
      qc.invalidateQueries({ queryKey: ['delete-requests'] });
      qc.invalidateQueries({ queryKey: ['enrolments'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

export function useIcalToken() {
  return useQuery(queryOpts(['ical-token'] as const, () => api<{ token: string | null; url: string | null }>('/me/ical-token')));
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
