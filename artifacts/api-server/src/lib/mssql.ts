import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | undefined;
let initialized = false;
let demoMode = false;

const plusDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

type DemoCourse = {
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
  duration: string | null;
};
type DemoBooking = {
  id: string;
  trainer: string;
  course: string;
  date: string;
  time: string;
  duration: string;
  status: string;
  meetingLink: string | null;
};

const demoData = {
  organization: { id: "org_acme", name: "Northstar Logistics", plan: "Enterprise", learnerCount: 246, programmeCount: 3 },
  user: { id: "usr_ava", name: "Ava Mokoena", email: "ava@northstar.co.za", role: "OrgOwner", initials: "AM" },
  programmes: [
    { id: "prog_leadership", name: "Leadership Accelerator", type: "Professional Development", status: "On track", learnerCount: 84, courseCount: 6, progress: 68, owner: "Ava Mokoena" },
    { id: "prog_compliance", name: "Safety & Compliance", type: "Compliance", status: "Needs attention", learnerCount: 246, courseCount: 4, progress: 82, owner: "David Pillay" },
    { id: "prog_onboarding", name: "Operations Onboarding", type: "Onboarding", status: "On track", learnerCount: 42, courseCount: 8, progress: 54, owner: "Nandi Dlamini" },
  ],
  courses: [
    { id: "course_coaching", title: "Coaching for performance", programmeId: "prog_leadership", programmeName: "Leadership Accelerator", category: "Leadership", progress: 74, status: "In progress", appliedThreshold: 70, appliedScore: 82, dueDate: plusDays(12), trainer: "Thabo Maseko", duration: "3h 20m" },
    { id: "course_feedback", title: "Feedback that moves work forward", programmeId: "prog_leadership", programmeName: "Leadership Accelerator", category: "Communication", progress: 100, status: "Competent", appliedThreshold: 70, appliedScore: 91, dueDate: plusDays(-8), trainer: "Thabo Maseko", duration: "2h 10m" },
    { id: "course_safety", title: "Incident prevention fundamentals", programmeId: "prog_compliance", programmeName: "Safety & Compliance", category: "Compliance", progress: 42, status: "At risk", appliedThreshold: 80, appliedScore: null, dueDate: plusDays(5), trainer: "Lerato Jacobs", duration: "1h 45m" },
    { id: "course_ops", title: "Warehouse operating rhythm", programmeId: "prog_onboarding", programmeName: "Operations Onboarding", category: "Operations", progress: 18, status: "Not started", appliedThreshold: 75, appliedScore: null, dueDate: plusDays(22), trainer: "Mpho Nkosi", duration: "4h 00m" },
  ] as DemoCourse[],
  sessions: [
    { id: "session_coaching", title: "Live coaching lab", programme: "Leadership Accelerator", date: plusDays(1), time: "09:00 – 10:30", mode: "Online", location: null, videoLink: "https://meet.google.com/trainhub-demo", attendees: 18, status: "Confirmed" },
    { id: "session_safety", title: "Safety walkthrough", programme: "Safety & Compliance", date: plusDays(3), time: "13:00 – 15:00", mode: "Offline", location: "Johannesburg DC · Floor 2", videoLink: null, attendees: 34, status: "RSVP open" },
    { id: "session_review", title: "Manager application clinic", programme: "Leadership Accelerator", date: plusDays(6), time: "15:30 – 16:15", mode: "Online", location: null, videoLink: "https://meet.google.com/trainhub-demo", attendees: 12, status: "RSVP open" },
  ],
  threads: [
    { id: "thread_coaching", subject: "Scenario assessment clarification", context: "Coaching for performance", participant: "Thabo Maseko", preview: "I have tried the scenario twice and the feedback is still unclear.", updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), unread: true, urgent: true },
    { id: "thread_safety", subject: "Safety walkthrough preparation", context: "Incident prevention fundamentals", participant: "Lerato Jacobs", preview: "The pre-read is ready for the DC team.", updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), unread: false, urgent: false },
    { id: "thread_ops", subject: "New starter cohort", context: "Warehouse operating rhythm", participant: "Mpho Nkosi", preview: "Three learners still need a start date.", updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), unread: false, urgent: false },
  ],
  messages: [
    { id: "msg_coaching_1", threadId: "thread_coaching", author: "Thabo Maseko", body: "Send me the scenario number and I will walk through the decision point with you.", createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), urgent: false },
    { id: "msg_coaching_2", threadId: "thread_coaching", author: "You", body: "I have tried the scenario twice and the feedback is still unclear.", createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), urgent: true },
  ],
  bookings: [{ id: "booking_ava", trainer: "Thabo Maseko", course: "Coaching for performance", date: plusDays(2), time: "11:00", duration: "30 min", status: "Confirmed", meetingLink: "https://meet.google.com/trainhub-demo" }] as DemoBooking[],
  events: [
    { id: "event_coaching", title: "Live coaching lab", date: plusDays(1), time: "09:00", type: "Live session", accent: "teal", location: null, meetingLink: "https://meet.google.com/trainhub-demo" },
    { id: "event_safety", title: "Safety walkthrough", date: plusDays(3), time: "13:00", type: "Physical session", accent: "orange", location: "Johannesburg DC · Floor 2", meetingLink: null },
    { id: "event_booking", title: "1:1 with Thabo", date: plusDays(2), time: "11:00", type: "1:1 coaching", accent: "violet", location: null, meetingLink: "https://meet.google.com/trainhub-demo" },
  ],
  review: { enabled: false, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: ["Professional Development", "Certification"] },
};

class DemoRequest {
  private params = new Map<string, unknown>();
  input(name: string, _type: unknown, value: unknown) {
    this.params.set(name, value);
    return this;
  }
  async batch() {
    return { recordset: [] };
  }
  async query(queryText: string) {
    const query = queryText.toLowerCase();
    const param = (name: string) => this.params.get(name);
    if (query.includes("from dbo.th_organizations")) return { recordset: [demoData.organization] };
    if (query.includes("top 1 id, name, email")) return { recordset: [demoData.user] };
    if (query.includes("from dbo.th_programmes")) return { recordset: demoData.programmes };
    if (query.includes("from dbo.th_courses") && query.includes("count(case")) return { recordset: [{ completionRate: 58, competencyRate: 47, expiringCredentials: 3, dropOffRate: 24, timeToCompetency: 11.5, trainerUtilization: 78 }] };
    if (query.includes("from dbo.th_courses") && query.includes("cross join")) return { recordset: [{ name: "Sibusiso Ndlovu", course: "Incident prevention fundamentals", expires: plusDays(5), status: "At risk" }, { name: "Aisha Patel", course: "Coaching for performance", expires: plusDays(12), status: "Due soon" }] };
    if (query.includes("from dbo.th_users")) return { recordset: [demoData.user] };
    if (query.includes("insert into dbo.th_courses")) {
      const created = { id: String(param("id")), title: String(param("title")), programmeId: String(param("programmeId")), programmeName: demoData.programmes.find((programme) => programme.id === param("programmeId"))?.name || "Programme", category: String(param("category")), progress: 0, status: "Not started", appliedThreshold: Number(param("threshold") || 70), appliedScore: null, dueDate: param("dueDate") ? String(param("dueDate")) : null, trainer: "Unassigned", duration: null };
      demoData.courses.push(created);
      return { recordset: [] };
    }
    if (query.includes("select applied_threshold")) return { recordset: demoData.courses.filter((course) => course.id === param("id")).map((course) => ({ appliedThreshold: course.appliedThreshold })) };
    if (query.includes("from dbo.th_courses") && query.includes("where c.id = @id")) return { recordset: demoData.courses.filter((course) => course.id === param("id")) };
    if (query.includes("from dbo.th_courses")) {
      const programmeId = param("programmeId");
      return { recordset: demoData.courses.filter((course) => !programmeId || course.programmeId === programmeId) };
    }
    if (query.includes("update dbo.th_courses")) {
      const course = demoData.courses.find((item) => item.id === param("id"));
      if (course) Object.assign(course, { appliedScore: Number(param("score")), progress: 100, status: "Competent" });
      return { recordset: [] };
    }
    if (query.includes("from dbo.th_sessions")) return { recordset: demoData.sessions };
    if (query.includes("from dbo.th_threads")) return { recordset: demoData.threads };
    if (query.includes("insert into dbo.th_messages")) {
      demoData.messages.push({ id: String(param("id")), threadId: String(param("threadId")), author: "You", body: String(param("body")), createdAt: new Date().toISOString(), urgent: Boolean(param("urgent")) });
      return { recordset: [] };
    }
    if (query.includes("update dbo.th_threads")) {
      const thread = demoData.threads.find((item) => item.id === param("id"));
      if (thread) Object.assign(thread, { preview: String(param("body")), updatedAt: new Date().toISOString(), urgent: Boolean(param("urgent")) });
      return { recordset: [] };
    }
    if (query.includes("from dbo.th_messages") && query.includes("where id = @id")) return { recordset: demoData.messages.filter((message) => message.id === param("id")) };
    if (query.includes("from dbo.th_messages")) return { recordset: demoData.messages.filter((message) => message.threadId === param("threadId")) };
    if (query.includes("from dbo.th_bookings") && query.includes("where id")) return { recordset: demoData.bookings.filter((booking) => booking.id === param("id")) };
    if (query.includes("insert into dbo.th_bookings")) {
      demoData.bookings.push({ id: String(param("id")), trainer: String(param("trainer")), course: String(param("course")), date: String(param("date")), time: String(param("time")), duration: "30 min", status: "Requested", meetingLink: null });
      return { recordset: [] };
    }
    if (query.includes("from dbo.th_bookings")) return { recordset: demoData.bookings };
    if (query.includes("from dbo.th_calendar_events")) return { recordset: demoData.events };
    if (query.includes("select * from dbo.th_review_settings")) return { recordset: [{ organization_id: "org_acme", enabled: demoData.review.enabled, max_weighting: demoData.review.maxWeighting, assessment_weight: demoData.review.assessmentWeight, timeliness_weight: demoData.review.timelinessWeight, application_weight: demoData.review.applicationWeight, require_manager_signoff: demoData.review.requireManagerSignoff, collect_application_scores: demoData.review.collectApplicationScores, eligible_programme_types: demoData.review.eligibleProgrammeTypes.join(",") }] };
    if (query.includes("from dbo.th_review_settings")) return { recordset: [{ ...demoData.review, eligibleProgrammeTypes: demoData.review.eligibleProgrammeTypes.join(",") }] };
    if (query.includes("update dbo.th_review_settings")) {
      Object.assign(demoData.review, { enabled: param("enabled"), maxWeighting: Number(param("maxWeighting")), assessmentWeight: Number(param("assessmentWeight")), timelinessWeight: Number(param("timelinessWeight")), applicationWeight: Number(param("applicationWeight")), collectApplicationScores: param("collectApplicationScores"), eligibleProgrammeTypes: String(param("eligibleProgrammeTypes")).split(",").map((value) => value.trim()) });
      return { recordset: [] };
    }
    if (query.includes("select u.name learner_name")) return { recordset: demoData.courses.map((course) => ({ learner_name: "Sibusiso Ndlovu", learner_email: "sibusiso@northstar.co.za", course: course.title, applied_assessment_score: course.appliedScore, completion_percent: course.progress, timeliness_score: course.status === "Competent" ? 100 : 0, application_score: null })) };
    return { recordset: [] };
  }
}

class DemoPool {
  request() {
    return new DemoRequest();
  }
}

const seedSql = `
IF OBJECT_ID('dbo.th_organizations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_organizations (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    name nvarchar(160) NOT NULL,
    plan nvarchar(80) NOT NULL,
    created_at datetime2 NOT NULL DEFAULT sysdatetime()
  );
END;
IF OBJECT_ID('dbo.th_users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_users (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    name nvarchar(160) NOT NULL,
    email nvarchar(240) NOT NULL,
    role nvarchar(40) NOT NULL,
    initials nvarchar(8) NOT NULL,
    created_at datetime2 NOT NULL DEFAULT sysdatetime()
  );
END;
IF OBJECT_ID('dbo.th_programmes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_programmes (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    name nvarchar(160) NOT NULL,
    type nvarchar(80) NOT NULL,
    status nvarchar(40) NOT NULL,
    learner_count int NOT NULL,
    course_count int NOT NULL,
    progress decimal(5,2) NOT NULL,
    owner_name nvarchar(160) NOT NULL
  );
END;
IF OBJECT_ID('dbo.th_courses', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_courses (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    programme_id nvarchar(64) NOT NULL,
    title nvarchar(240) NOT NULL,
    category nvarchar(100) NOT NULL,
    progress decimal(5,2) NOT NULL,
    status nvarchar(40) NOT NULL,
    applied_threshold decimal(5,2) NOT NULL,
    applied_score decimal(5,2) NULL,
    due_date date NULL,
    trainer nvarchar(160) NOT NULL,
    duration nvarchar(80) NULL
  );
END;
IF OBJECT_ID('dbo.th_sessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_sessions (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    title nvarchar(240) NOT NULL,
    programme nvarchar(160) NOT NULL,
    session_date date NOT NULL,
    session_time nvarchar(80) NOT NULL,
    mode nvarchar(40) NOT NULL,
    location nvarchar(240) NULL,
    video_link nvarchar(500) NULL,
    attendees int NOT NULL,
    status nvarchar(40) NOT NULL
  );
END;
IF OBJECT_ID('dbo.th_threads', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_threads (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    subject nvarchar(240) NOT NULL,
    context nvarchar(160) NOT NULL,
    participant nvarchar(160) NOT NULL,
    preview nvarchar(500) NOT NULL,
    updated_at datetime2 NOT NULL,
    unread bit NOT NULL DEFAULT 0,
    urgent bit NOT NULL DEFAULT 0
  );
END;
IF OBJECT_ID('dbo.th_messages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_messages (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    thread_id nvarchar(64) NOT NULL,
    author nvarchar(160) NOT NULL,
    body nvarchar(max) NOT NULL,
    created_at datetime2 NOT NULL,
    urgent bit NOT NULL DEFAULT 0
  );
END;
IF OBJECT_ID('dbo.th_bookings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_bookings (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    trainer nvarchar(160) NOT NULL,
    course nvarchar(240) NOT NULL,
    booking_date date NOT NULL,
    booking_time nvarchar(80) NOT NULL,
    duration nvarchar(80) NOT NULL,
    status nvarchar(40) NOT NULL,
    meeting_link nvarchar(500) NULL
  );
END;
IF OBJECT_ID('dbo.th_calendar_events', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_calendar_events (
    id nvarchar(64) NOT NULL PRIMARY KEY,
    organization_id nvarchar(64) NOT NULL,
    title nvarchar(240) NOT NULL,
    event_date date NOT NULL,
    event_time nvarchar(80) NOT NULL,
    event_type nvarchar(80) NOT NULL,
    accent nvarchar(40) NOT NULL,
    location nvarchar(240) NULL,
    meeting_link nvarchar(500) NULL
  );
END;
IF OBJECT_ID('dbo.th_review_settings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.th_review_settings (
    organization_id nvarchar(64) NOT NULL PRIMARY KEY,
    enabled bit NOT NULL DEFAULT 0,
    max_weighting decimal(5,2) NOT NULL DEFAULT 10,
    assessment_weight decimal(5,2) NOT NULL DEFAULT 50,
    timeliness_weight decimal(5,2) NOT NULL DEFAULT 30,
    application_weight decimal(5,2) NOT NULL DEFAULT 20,
    require_manager_signoff bit NOT NULL DEFAULT 1,
    collect_application_scores bit NOT NULL DEFAULT 1,
    eligible_programme_types nvarchar(500) NOT NULL DEFAULT 'Professional Development,Certification'
  );
END;

IF NOT EXISTS (SELECT 1 FROM dbo.th_organizations WHERE id = 'org_acme')
  INSERT INTO dbo.th_organizations (id, name, plan) VALUES ('org_acme', 'Northstar Logistics', 'Enterprise');
IF NOT EXISTS (SELECT 1 FROM dbo.th_users WHERE id = 'usr_ava')
  INSERT INTO dbo.th_users (id, organization_id, name, email, role, initials) VALUES ('usr_ava', 'org_acme', 'Ava Mokoena', 'ava@northstar.co.za', 'OrgOwner', 'AM');
IF NOT EXISTS (SELECT 1 FROM dbo.th_programmes WHERE id = 'prog_leadership')
  INSERT INTO dbo.th_programmes (id, organization_id, name, type, status, learner_count, course_count, progress, owner_name) VALUES
    ('prog_leadership', 'org_acme', 'Leadership Accelerator', 'Professional Development', 'On track', 84, 6, 68, 'Ava Mokoena'),
    ('prog_compliance', 'org_acme', 'Safety & Compliance', 'Compliance', 'Needs attention', 246, 4, 82, 'David Pillay'),
    ('prog_onboarding', 'org_acme', 'Operations Onboarding', 'Onboarding', 'On track', 42, 8, 54, 'Nandi Dlamini');
IF NOT EXISTS (SELECT 1 FROM dbo.th_courses WHERE id = 'course_coaching')
  INSERT INTO dbo.th_courses (id, organization_id, programme_id, title, category, progress, status, applied_threshold, applied_score, due_date, trainer, duration) VALUES
    ('course_coaching', 'org_acme', 'prog_leadership', 'Coaching for performance', 'Leadership', 74, 'In progress', 70, 82, DATEADD(day, 12, CAST(GETDATE() AS date)), 'Thabo Maseko', '3h 20m'),
    ('course_feedback', 'org_acme', 'prog_leadership', 'Feedback that moves work forward', 'Communication', 100, 'Competent', 70, 91, DATEADD(day, -8, CAST(GETDATE() AS date)), 'Thabo Maseko', '2h 10m'),
    ('course_safety', 'org_acme', 'prog_compliance', 'Incident prevention fundamentals', 'Compliance', 42, 'At risk', 80, NULL, DATEADD(day, 5, CAST(GETDATE() AS date)), 'Lerato Jacobs', '1h 45m'),
    ('course_ops', 'org_acme', 'prog_onboarding', 'Warehouse operating rhythm', 'Operations', 18, 'Not started', 75, NULL, DATEADD(day, 22, CAST(GETDATE() AS date)), 'Mpho Nkosi', '4h 00m');
IF NOT EXISTS (SELECT 1 FROM dbo.th_sessions WHERE id = 'session_coaching')
  INSERT INTO dbo.th_sessions (id, organization_id, title, programme, session_date, session_time, mode, location, video_link, attendees, status) VALUES
    ('session_coaching', 'org_acme', 'Live coaching lab', 'Leadership Accelerator', DATEADD(day, 1, CAST(GETDATE() AS date)), '09:00 – 10:30', 'Online', NULL, 'https://meet.google.com/trainhub-demo', 18, 'Confirmed'),
    ('session_safety', 'org_acme', 'Safety walkthrough', 'Safety & Compliance', DATEADD(day, 3, CAST(GETDATE() AS date)), '13:00 – 15:00', 'Offline', 'Johannesburg DC · Floor 2', NULL, 34, 'RSVP open'),
    ('session_review', 'org_acme', 'Manager application clinic', 'Leadership Accelerator', DATEADD(day, 6, CAST(GETDATE() AS date)), '15:30 – 16:15', 'Online', NULL, 'https://meet.google.com/trainhub-demo', 12, 'RSVP open');
IF NOT EXISTS (SELECT 1 FROM dbo.th_threads WHERE id = 'thread_coaching')
  INSERT INTO dbo.th_threads (id, organization_id, subject, context, participant, preview, updated_at, unread, urgent) VALUES
    ('thread_coaching', 'org_acme', 'Scenario assessment clarification', 'Coaching for performance', 'Thabo Maseko', 'I have tried the scenario twice and the feedback is still unclear.', DATEADD(hour, -2, sysdatetime()), 1, 1),
    ('thread_safety', 'org_acme', 'Safety walkthrough preparation', 'Incident prevention fundamentals', 'Lerato Jacobs', 'The pre-read is ready for the DC team.', DATEADD(day, -1, sysdatetime()), 0, 0),
    ('thread_ops', 'org_acme', 'New starter cohort', 'Warehouse operating rhythm', 'Mpho Nkosi', 'Three learners still need a start date.', DATEADD(day, -2, sysdatetime()), 0, 0);
IF NOT EXISTS (SELECT 1 FROM dbo.th_messages WHERE id = 'msg_coaching_1')
  INSERT INTO dbo.th_messages (id, organization_id, thread_id, author, body, created_at, urgent) VALUES
    ('msg_coaching_1', 'org_acme', 'thread_coaching', 'Thabo Maseko', 'Send me the scenario number and I will walk through the decision point with you.', DATEADD(hour, -3, sysdatetime()), 0),
    ('msg_coaching_2', 'org_acme', 'thread_coaching', 'You', 'I have tried the scenario twice and the feedback is still unclear.', DATEADD(hour, -2, sysdatetime()), 1);
IF NOT EXISTS (SELECT 1 FROM dbo.th_bookings WHERE id = 'booking_ava')
  INSERT INTO dbo.th_bookings (id, organization_id, trainer, course, booking_date, booking_time, duration, status, meeting_link) VALUES
    ('booking_ava', 'org_acme', 'Thabo Maseko', 'Coaching for performance', DATEADD(day, 2, CAST(GETDATE() AS date)), '11:00', '30 min', 'Confirmed', 'https://meet.google.com/trainhub-demo');
IF NOT EXISTS (SELECT 1 FROM dbo.th_calendar_events WHERE id = 'event_coaching')
  INSERT INTO dbo.th_calendar_events (id, organization_id, title, event_date, event_time, event_type, accent, location, meeting_link) VALUES
    ('event_coaching', 'org_acme', 'Live coaching lab', DATEADD(day, 1, CAST(GETDATE() AS date)), '09:00', 'Live session', 'teal', NULL, 'https://meet.google.com/trainhub-demo'),
    ('event_safety', 'org_acme', 'Safety walkthrough', DATEADD(day, 3, CAST(GETDATE() AS date)), '13:00', 'Physical session', 'orange', 'Johannesburg DC · Floor 2', NULL),
    ('event_booking', 'org_acme', '1:1 with Thabo', DATEADD(day, 2, CAST(GETDATE() AS date)), '11:00', '1:1 coaching', 'violet', NULL, 'https://meet.google.com/trainhub-demo');
IF NOT EXISTS (SELECT 1 FROM dbo.th_review_settings WHERE organization_id = 'org_acme')
  INSERT INTO dbo.th_review_settings (organization_id) VALUES ('org_acme');
`;

export async function getPool() {
  if (!process.env.DB_CONNECTION_STRING) {
    throw new Error("DB_CONNECTION_STRING is not configured");
  }

  if (demoMode) return new DemoPool();

  if (!poolPromise) {
    const values = Object.fromEntries(
      process.env.DB_CONNECTION_STRING.split(";")
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf("=");
          return [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
        }),
    );
    const [server, rawPort] = String(values.server || "").split(",");
    poolPromise = sql.connect({
      server,
      port: Number(rawPort || 1433),
      database: values.database,
      user: values["user id"],
      password: values.password,
      options: { trustServerCertificate: String(values.trustservercertificate).toLowerCase() === "true" },
      connectionTimeout: 5000,
    }).catch((error) => {
      poolPromise = undefined;
      demoMode = true;
      return Promise.reject(error);
    });
  }

  try {
    const pool = await poolPromise;
    if (!initialized) {
      await pool.request().batch(seedSql);
      initialized = true;
    }
    return pool;
  } catch (error) {
    demoMode = true;
    return new DemoPool();
  }
}

export function isDemoMode() {
  return demoMode;
}

export function orgIdFromRequest(request: { header: (name: string) => string | undefined }) {
  return request.header("x-organization-id") || "org_acme";
}

export const sqlTypes = sql;