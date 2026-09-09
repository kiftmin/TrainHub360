import { Router, type IRouter } from "express";
import {
  CreateBookingBody,
  CreateBookingResponse,
  CreateCourseBody,
  CreateCourseResponse,
  GetDashboardSummaryResponse,
  GetReviewCreditSettingsResponse,
  GetWorkspaceResponse,
  ListBookingsResponse,
  ListCalendarEventsResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  ListMessageThreadsResponse,
  ListProgrammesResponse,
  ListSessionsResponse,
  ListThreadMessagesParams,
  ListThreadMessagesResponse,
  SendThreadMessageBody,
  SendThreadMessageParams,
  SendThreadMessageResponse,
  SubmitAssessmentAttemptBody,
  SubmitAssessmentAttemptParams,
  SubmitAssessmentAttemptResponse,
  UpdateReviewCreditSettingsBody,
  UpdateReviewCreditSettingsResponse,
} from "@workspace/api-zod";
import { getPool, orgIdFromRequest, sqlTypes } from "../lib/mssql";
import { isDemoMode } from "../lib/mssql";

const router: IRouter = Router();

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function dbError(res: Response, error: unknown) {
  res.status(503).json({ error: error instanceof Error ? error.message : "Database unavailable" });
}

type Response = Parameters<Parameters<IRouter["get"]>[1]>[1];

router.get("/workspace", async (req, res) => {
  try {
    const orgId = orgIdFromRequest(req);
    const pool = await getPool();
    const org = await pool.request().input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT o.id, o.name, o.plan,
        (SELECT COUNT(*) FROM dbo.th_users WHERE organization_id = o.id AND role = 'Learner') learnerCount,
        (SELECT COUNT(*) FROM dbo.th_programmes WHERE organization_id = o.id) programmeCount
      FROM dbo.th_organizations o WHERE o.id = @orgId
    `);
    const user = await pool.request().input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT TOP 1 id, name, email, role, initials FROM dbo.th_users WHERE organization_id = @orgId ORDER BY created_at
    `);
    const programme = await pool.request().input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT TOP 1 id, name, type, status, learner_count learnerCount, course_count courseCount, progress, owner_name owner
      FROM dbo.th_programmes WHERE organization_id = @orgId ORDER BY progress DESC
    `);
    const data = GetWorkspaceResponse.parse({
      organization: org.recordset[0],
      activeProgramme: programme.recordset[0],
      user: user.recordset[0],
      dataSource: isDemoMode() ? "demo-workspace" : "sql-server",
    });
    res.json(data);
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/dashboard/summary", async (req, res) => {
  try {
    const orgId = orgIdFromRequest(req);
    const pool = await getPool();
    const counts = await pool.request().input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT
        ISNULL(AVG(progress), 0) completionRate,
        ISNULL(AVG(CASE WHEN status = 'Competent' THEN 100.0 ELSE 38.0 END), 0) competencyRate,
        ISNULL(AVG(CASE WHEN status = 'At risk' THEN 100.0 ELSE 0.0 END), 0) dropOffRate,
        COUNT(CASE WHEN due_date <= DATEADD(day, 30, GETDATE()) THEN 1 END) expiringCredentials,
        11.5 timeToCompetency,
        78.0 trainerUtilization
      FROM dbo.th_courses WHERE organization_id = @orgId
    `);
    const expiring = await pool.request().input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT TOP 4 u.name, c.title course, CONVERT(varchar(10), c.due_date, 23) expires,
        CASE WHEN c.due_date < DATEADD(day, 7, GETDATE()) THEN 'At risk' ELSE 'Due soon' END status
      FROM dbo.th_courses c
      CROSS JOIN (SELECT TOP 4 name FROM dbo.th_users WHERE organization_id = @orgId ORDER BY name) u
      WHERE c.organization_id = @orgId AND c.due_date IS NOT NULL
      ORDER BY c.due_date
    `);
    const summary = GetDashboardSummaryResponse.parse({
      complianceHealth: 86,
      completionRate: Number(counts.recordset[0]?.completionRate || 0),
      competencyRate: Number(counts.recordset[0]?.competencyRate || 0),
      expiringCredentials: Number(counts.recordset[0]?.expiringCredentials || 0),
      dropOffRate: Number(counts.recordset[0]?.dropOffRate || 0),
      timeToCompetency: Number(counts.recordset[0]?.timeToCompetency || 0),
      trainerUtilization: Number(counts.recordset[0]?.trainerUtilization || 0),
      weeklyActivity: [
        { label: "Mon", active: 38, completed: 24 },
        { label: "Tue", active: 46, completed: 29 },
        { label: "Wed", active: 54, completed: 37 },
        { label: "Thu", active: 49, completed: 34 },
        { label: "Fri", active: 63, completed: 44 },
        { label: "Sat", active: 31, completed: 19 },
        { label: "Sun", active: 23, completed: 16 },
      ],
      dropOffHeatmap: [
        { label: "Module 1", value: 12 },
        { label: "Module 2", value: 23 },
        { label: "Module 3", value: 9 },
        { label: "Scenario", value: 31 },
        { label: "Reflection", value: 16 },
      ],
      expiringItems: expiring.recordset,
    });
    res.json(summary);
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/programmes", async (req, res) => {
  try {
    const pool = await getPool();
    const rows = await pool.request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT id, name, type, status, learner_count learnerCount, course_count courseCount, progress, owner_name owner
      FROM dbo.th_programmes WHERE organization_id = @orgId ORDER BY name
    `);
    res.json(ListProgrammesResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/courses", async (req, res) => {
  try {
    const params = ListCoursesQueryParams.parse({ programmeId: req.query.programmeId || undefined });
    const request = (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req));
    let query = `
      SELECT c.id, c.title, c.programme_id programmeId, p.name programmeName, c.category,
        c.progress, c.status, c.applied_threshold appliedThreshold, c.applied_score appliedScore,
        CONVERT(varchar(10), c.due_date, 23) dueDate, c.trainer, c.duration
      FROM dbo.th_courses c INNER JOIN dbo.th_programmes p ON p.id = c.programme_id
      WHERE c.organization_id = @orgId
    `;
    if (params.programmeId) {
      request.input("programmeId", sqlTypes.NVarChar, params.programmeId);
      query += " AND c.programme_id = @programmeId";
    }
    const rows = await request.query(query + " ORDER BY c.due_date");
    res.json(ListCoursesResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.post("/courses", async (req, res) => {
  try {
    const data = CreateCourseBody.parse(req.body);
    const orgId = orgIdFromRequest(req);
    const id = `course_${Date.now()}`;
    const pool = await getPool();
    await pool.request()
      .input("id", sqlTypes.NVarChar, id)
      .input("orgId", sqlTypes.NVarChar, orgId)
      .input("programmeId", sqlTypes.NVarChar, data.programmeId)
      .input("title", sqlTypes.NVarChar, data.title)
      .input("category", sqlTypes.NVarChar, data.category)
      .input("threshold", sqlTypes.Decimal(5, 2), data.appliedThreshold || 70)
      .input("dueDate", sqlTypes.Date, data.dueDate || null)
      .query(`
        INSERT INTO dbo.th_courses (id, organization_id, programme_id, title, category, progress, status, applied_threshold, applied_score, due_date, trainer, duration)
        VALUES (@id, @orgId, @programmeId, @title, @category, 0, 'Not started', @threshold, NULL, @dueDate, 'Unassigned', NULL)
      `);
    const created = await pool.request().input("id", sqlTypes.NVarChar, id).input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT c.id, c.title, c.programme_id programmeId, p.name programmeName, c.category, c.progress, c.status,
        c.applied_threshold appliedThreshold, c.applied_score appliedScore, CONVERT(varchar(10), c.due_date, 23) dueDate, c.trainer, c.duration
      FROM dbo.th_courses c INNER JOIN dbo.th_programmes p ON p.id = c.programme_id WHERE c.id = @id AND c.organization_id = @orgId
    `);
    res.status(201).json(CreateCourseResponse.parse(created.recordset[0]));
  } catch (error) {
    dbError(res, error);
  }
});

router.post("/courses/:courseId/attempts", async (req, res) => {
  try {
    const path = SubmitAssessmentAttemptParams.parse(req.params);
    const body = SubmitAssessmentAttemptBody.parse(req.body);
    const pool = await getPool();
    const result = await pool.request().input("id", sqlTypes.NVarChar, path.courseId).input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT applied_threshold appliedThreshold FROM dbo.th_courses WHERE id = @id AND organization_id = @orgId
    `);
    const threshold = Number(result.recordset[0]?.appliedThreshold || 70);
    const competenceMet = body.appliedScore >= threshold;
    const passed = competenceMet && body.recallScore >= 60;
    const parsed = SubmitAssessmentAttemptResponse.parse({
      appliedScore: body.appliedScore,
      recallScore: body.recallScore,
      passed,
      competenceMet,
      message: competenceMet ? "Applied threshold met. This course can be marked competent." : `Applied assessment is below the ${threshold}% competence threshold.`,
    });
    if (passed) {
      await pool.request().input("id", sqlTypes.NVarChar, path.courseId).input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).input("score", sqlTypes.Decimal(5, 2), body.appliedScore).query(`
        UPDATE dbo.th_courses SET applied_score = @score, progress = 100, status = 'Competent'
        WHERE id = @id AND organization_id = @orgId
      `);
    }
    res.json(parsed);
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/sessions", async (req, res) => {
  try {
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT id, title, programme, CONVERT(varchar(10), session_date, 23) date, session_time time, mode,
        location, video_link videoLink, attendees, status
      FROM dbo.th_sessions WHERE organization_id = @orgId ORDER BY session_date, session_time
    `);
    res.json(ListSessionsResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/threads", async (req, res) => {
  try {
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT id, subject, context, participant, preview, CONVERT(varchar(32), updated_at, 126) updatedAt, unread, urgent
      FROM dbo.th_threads WHERE organization_id = @orgId ORDER BY updated_at DESC
    `);
    res.json(ListMessageThreadsResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/threads/:threadId/messages", async (req, res) => {
  try {
    const params = ListThreadMessagesParams.parse(req.params);
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).input("threadId", sqlTypes.NVarChar, params.threadId).query(`
      SELECT id, thread_id threadId, author, body, CONVERT(varchar(32), created_at, 126) createdAt, urgent
      FROM dbo.th_messages WHERE organization_id = @orgId AND thread_id = @threadId ORDER BY created_at
    `);
    res.json(ListThreadMessagesResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.post("/threads/:threadId/messages", async (req, res) => {
  try {
    const params = SendThreadMessageParams.parse(req.params);
    const body = SendThreadMessageBody.parse(req.body);
    const orgId = orgIdFromRequest(req);
    const id = `msg_${Date.now()}`;
    const pool = await getPool();
    await pool.request().input("id", sqlTypes.NVarChar, id).input("orgId", sqlTypes.NVarChar, orgId).input("threadId", sqlTypes.NVarChar, params.threadId).input("body", sqlTypes.NVarChar, body.body).input("urgent", sqlTypes.Bit, body.urgent || false).query(`
      INSERT INTO dbo.th_messages (id, organization_id, thread_id, author, body, created_at, urgent)
      VALUES (@id, @orgId, @threadId, 'You', @body, sysdatetime(), @urgent)
    `);
    await pool.request().input("id", sqlTypes.NVarChar, params.threadId).input("orgId", sqlTypes.NVarChar, orgId).input("urgent", sqlTypes.Bit, body.urgent || false).input("body", sqlTypes.NVarChar, body.body).query(`
      UPDATE dbo.th_threads SET preview = @body, updated_at = sysdatetime(), urgent = @urgent
      WHERE id = @id AND organization_id = @orgId
    `);
    const created = await pool.request().input("id", sqlTypes.NVarChar, id).input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT id, thread_id threadId, author, body, CONVERT(varchar(32), created_at, 126) createdAt, urgent FROM dbo.th_messages WHERE id = @id AND organization_id = @orgId
    `);
    res.status(201).json(SendThreadMessageResponse.parse(created.recordset[0]));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/bookings", async (req, res) => {
  try {
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT id, trainer, course, CONVERT(varchar(10), booking_date, 23) date, booking_time time, duration, status, meeting_link meetingLink
      FROM dbo.th_bookings WHERE organization_id = @orgId ORDER BY booking_date, booking_time
    `);
    res.json(ListBookingsResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.post("/bookings", async (req, res) => {
  try {
    const body = CreateBookingBody.parse(req.body);
    const orgId = orgIdFromRequest(req);
    const id = `booking_${Date.now()}`;
    const pool = await getPool();
    await pool.request().input("id", sqlTypes.NVarChar, id).input("orgId", sqlTypes.NVarChar, orgId).input("trainer", sqlTypes.NVarChar, body.trainer).input("course", sqlTypes.NVarChar, body.course || "1:1 coaching").input("date", sqlTypes.Date, body.date).input("time", sqlTypes.NVarChar, body.time).query(`
      INSERT INTO dbo.th_bookings (id, organization_id, trainer, course, booking_date, booking_time, duration, status, meeting_link)
      VALUES (@id, @orgId, @trainer, @course, @date, @time, '30 min', 'Requested', NULL)
    `);
    const created = await pool.request().input("id", sqlTypes.NVarChar, id).input("orgId", sqlTypes.NVarChar, orgId).query(`
      SELECT id, trainer, course, CONVERT(varchar(10), booking_date, 23) date, booking_time time, duration, status, meeting_link meetingLink
      FROM dbo.th_bookings WHERE id = @id AND organization_id = @orgId
    `);
    res.status(201).json(CreateBookingResponse.parse(created.recordset[0]));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/calendar", async (req, res) => {
  try {
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT id, title, CONVERT(varchar(10), event_date, 23) date, event_time time, event_type type, accent, location, meeting_link meetingLink
      FROM dbo.th_calendar_events WHERE organization_id = @orgId ORDER BY event_date, event_time
    `);
    res.json(ListCalendarEventsResponse.parse(rows.recordset));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/review-credit/settings", async (req, res) => {
  try {
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT enabled, max_weighting maxWeighting, assessment_weight assessmentWeight, timeliness_weight timelinessWeight,
        application_weight applicationWeight, require_manager_signoff requireManagerSignoff,
        collect_application_scores collectApplicationScores, eligible_programme_types eligibleProgrammeTypes
      FROM dbo.th_review_settings WHERE organization_id = @orgId
    `);
    const row = rows.recordset[0];
    res.json(GetReviewCreditSettingsResponse.parse({
      ...row,
      eligibleProgrammeTypes: String(row.eligibleProgrammeTypes).split(",").map((value) => value.trim()),
    }));
  } catch (error) {
    dbError(res, error);
  }
});

router.patch("/review-credit/settings", async (req, res) => {
  try {
    const body = UpdateReviewCreditSettingsBody.parse(req.body);
    const orgId = orgIdFromRequest(req);
    const pool = await getPool();
    const current = await pool.request().input("orgId", sqlTypes.NVarChar, orgId).query("SELECT * FROM dbo.th_review_settings WHERE organization_id = @orgId");
    const existing = current.recordset[0];
    const next = {
      enabled: body.enabled ?? Boolean(existing.enabled),
      maxWeighting: body.maxWeighting ?? Number(existing.max_weighting),
      assessmentWeight: body.assessmentWeight ?? Number(existing.assessment_weight),
      timelinessWeight: body.timelinessWeight ?? Number(existing.timeliness_weight),
      applicationWeight: body.applicationWeight ?? Number(existing.application_weight),
      collectApplicationScores: body.collectApplicationScores ?? Boolean(existing.collect_application_scores),
      eligibleProgrammeTypes: body.eligibleProgrammeTypes ?? String(existing.eligible_programme_types).split(",").map((value) => value.trim()),
    };
    if (Math.round((next.assessmentWeight + next.timelinessWeight + next.applicationWeight) * 100) / 100 !== 100) {
      res.status(400).json({ error: "Assessment, timeliness, and application weights must sum to 100%." });
      return;
    }
    await pool.request().input("orgId", sqlTypes.NVarChar, orgId).input("enabled", sqlTypes.Bit, next.enabled).input("maxWeighting", sqlTypes.Decimal(5, 2), next.maxWeighting).input("assessmentWeight", sqlTypes.Decimal(5, 2), next.assessmentWeight).input("timelinessWeight", sqlTypes.Decimal(5, 2), next.timelinessWeight).input("applicationWeight", sqlTypes.Decimal(5, 2), next.applicationWeight).input("collectApplicationScores", sqlTypes.Bit, next.collectApplicationScores).input("eligibleProgrammeTypes", sqlTypes.NVarChar, next.eligibleProgrammeTypes.join(",")).query(`
      UPDATE dbo.th_review_settings SET enabled = @enabled, max_weighting = @maxWeighting, assessment_weight = @assessmentWeight,
        timeliness_weight = @timelinessWeight, application_weight = @applicationWeight, collect_application_scores = @collectApplicationScores,
        eligible_programme_types = @eligibleProgrammeTypes WHERE organization_id = @orgId
    `);
    res.json(UpdateReviewCreditSettingsResponse.parse({
      ...next,
      requireManagerSignoff: true,
    }));
  } catch (error) {
    dbError(res, error);
  }
});

router.get("/review-credit/export", async (req, res) => {
  try {
    const rows = await (await getPool()).request().input("orgId", sqlTypes.NVarChar, orgIdFromRequest(req)).query(`
      SELECT u.name learner_name, u.email learner_email, c.title course, c.applied_score applied_assessment_score,
        c.progress completion_percent, CASE WHEN c.status = 'Competent' THEN 100 ELSE 0 END timeliness_score,
        CAST(NULL AS decimal(5,2)) application_score
      FROM dbo.th_courses c CROSS JOIN dbo.th_users u
      WHERE c.organization_id = @orgId AND u.organization_id = @orgId AND u.role = 'Learner'
    `);
    const header = "learner_name,learner_email,course,applied_assessment_score,completion_percent,timeliness_score,application_score";
    const csv = [header, ...rows.recordset.map((row) => Object.values(row).map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
    res.type("text/csv").send(csv);
  } catch (error) {
    dbError(res, error);
  }
});

export default router;