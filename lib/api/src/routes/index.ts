import { Router } from "express";
import { calculateEnrolmentScore, aggregateReviewCredit, exportCSV } from "../services/reviewCredit.js";
import { findCalendarGaps, sendNudges } from "../services/nudge.js";
import { signToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { computeKpis } from "../jobs/kpiJob.js";
import { db } from "../db.js";
import type { AuthedRequest } from "../middleware/auth.js";

export const router = Router();

router.get("/healthz", (_req, res) => res.json({ status: "ok" }));

router.post("/auth/login", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email required" });
  const user = await db.user.findUnique({ where: { email } }).catch(() => null);
  const id = user?.id ?? "u1";
  const role = (await db.userRole.findFirst({ where: { userId: id }, include: { role: true } }).catch(() => null))?.role.name ?? "admin";
  const token = signToken({ id, role, orgId: user?.orgId ?? "org1" });
  res.json({ accessToken: token, user: { id, name: user?.name ?? "Admin", email, role, initials: (user?.name ?? "AD").slice(0, 2).toUpperCase() } });
});
router.post("/auth/sso", (req, res) => {
  if (!req.body?.samlAssertion) return res.status(400).json({ error: "samlAssertion required" });
  const token = signToken({ id: "sso-user", role: "learner", orgId: "org1" });
  res.json({ accessToken: token, user: { id: "sso-user", name: "SSO User", email: "sso@corp.com", role: "learner", initials: "SU" } });
});

router.get("/workspace", async (req, res) => {
  const org = await db.organization.findFirst().catch(() => null);
  const programme = await db.programme.findFirst().catch(() => null);
  const me = (req as AuthedRequest).user;
  const user = me ? await db.user.findUnique({ where: { id: me.id } }).catch(() => null) : null;
  res.json({
    organization: org ?? { id: "org1", name: "Acme", plan: "pro", learnerCount: 120, programmeCount: 4 },
    activeProgramme: programme ?? { id: "p1", name: "Onboarding", type: "Onboarding", status: "active", learnerCount: 40, courseCount: 6, progress: 62, owner: "Admin" },
    user: user ?? { id: me?.id ?? "u1", name: "Admin", email: "a@corp.com", role: me?.role ?? "admin", initials: "AD" },
    dataSource: "mssql",
  });
});

async function kpiPayload() {
  const enrolments = await db.enrolment.findMany({ select: { status: true, appliedAssessmentScore: true } }).catch(() => []);
  const kpis = computeKpis(enrolments.map((e) => ({ status: e.status, appliedScore: e.appliedAssessmentScore })));
  return { ...kpis, complianceHealth: 92, expiringCredentials: 3, weeklyActivity: [], dropOffHeatmap: [], expiringItems: [] };
}
router.get("/dashboard/summary", async (_req, res) => res.json(await kpiPayload()));
router.get("/kpi/summary", async (_req, res) => res.json(await kpiPayload()));

router.get("/enrolments", async (_req, res) => res.json(await db.enrolment.findMany({ take: 200 })));
router.post("/enrolments", async (req, res) => {
  const e = await db.enrolment.create({ data: { learnerId: req.body.learnerId, courseId: req.body.courseId, programmeId: req.body.programmeId ?? (await db.course.findUnique({ where: { id: req.body.courseId } }).catch(() => null))?.programmeId ?? "", status: "enrolled", deadlineDate: req.body.deadlineDate ? new Date(req.body.deadlineDate) : null } });
  res.status(201).json(e);
});
router.patch("/enrolments/:id", async (req, res) => {
  const current = await db.enrolment.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "not found" });
  const merged = { ...current, ...req.body };
  const { score, b } = calculateEnrolmentScore({ appliedAssessmentScore: merged.appliedAssessmentScore ?? null, completionDate: merged.completionDate ?? null, deadlineDate: merged.deadlineDate ?? null, applicationScore: merged.applicationScore ?? null });
  const e = await db.enrolment.update({ where: { id: req.params.id }, data: { status: req.body.status ?? undefined, appliedAssessmentScore: req.body.appliedAssessmentScore ?? undefined, applicationScore: req.body.applicationScore ?? undefined, timelinessScore: b, enrolmentScore: score, managerSignOff: req.body.managerSignOff ?? undefined } });
  res.json(e);
});
router.delete("/enrolments/:id", requireRole("admin", "owner"), async (req, res) => {
  await db.enrolment.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});
router.get("/enrolments/:id/score", async (req, res) => {
  const e = await db.enrolment.findUnique({ where: { id: req.params.id } });
  if (!e) return res.status(404).json({ error: "not found" });
  const r = calculateEnrolmentScore({ appliedAssessmentScore: e.appliedAssessmentScore, completionDate: e.completionDate, deadlineDate: e.deadlineDate, applicationScore: e.applicationScore });
  res.json({ enrolmentId: req.params.id, score: r.score, breakdown: r });
});

router.get("/programmes", async (_req, res) => res.json(await db.programme.findMany({ take: 200 }).catch(() => [])));
router.get("/programmes/:id/modules", async (req, res) => {
  res.json(await db.module.findMany({ where: { course: { programmeId: req.params.id } } }).catch(() => []));
});
router.post("/programmes/:id/modules", async (req, res) => {
  let courseId = req.body.courseId;
  if (!courseId) {
    const first = await db.course.findFirst({ where: { programmeId: req.params.id } }).catch(() => null);
    if (!first) return res.status(400).json({ error: "courseId required (no courses in programme yet)" });
    courseId = first.id;
  }
  res.status(201).json(await db.module.create({ data: { courseId, title: req.body.title ?? "New module" } }));
});
router.get("/modules/:id/assessments", async (req, res) => {
  res.json(await db.assessment.findMany({ where: { moduleId: req.params.id } }).catch(() => []));
});
router.post("/modules/:id/assessments", async (req, res) => {
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  res.status(201).json(await db.assessment.create({ data: { moduleId: req.params.id, type: req.body.type ?? "recall", maxScore: req.body.maxScore ?? 100 } }));
});
router.get("/courses", async (req, res) => {
  const programmeId = req.query.programmeId as string | undefined;
  res.json(await db.course.findMany({ where: programmeId ? { programmeId } : undefined, take: 200 }).catch(() => []));
});
router.post("/courses", async (req, res) => {
  res.status(201).json(await db.course.create({ data: { programmeId: req.body.programmeId, title: req.body.title, category: req.body.category ?? "General" } }));
});
router.post("/courses/:id/attempts", (req, res) => {
  const { appliedScore = 0, recallScore = 0 } = req.body ?? {};
  const passed = appliedScore >= 70;
  res.json({ appliedScore, recallScore, passed, competenceMet: passed, message: passed ? "competence met" : "below applied threshold" });
});
router.get("/sessions", async (_req, res) => res.json(await db.session.findMany({ take: 200 }).catch(() => [])));
router.get("/threads", async (_req, res) => res.json(await db.messageThread.findMany({ take: 200, orderBy: { updatedAt: "desc" } }).catch(() => [])));
router.get("/threads/:id/messages", async (req, res) => {
  res.json(await db.message.findMany({ where: { threadId: req.params.id }, orderBy: { createdAt: "asc" } }).catch(() => []));
});
router.post("/threads/:id/messages", async (req, res) => {
  res.status(201).json(await db.message.create({ data: { threadId: req.params.id, author: req.body.author ?? "learner", body: req.body.body, urgent: req.body.urgent ?? false } }));
});
router.get("/bookings", async (_req, res) => res.json(await db.booking.findMany({ take: 200 }).catch(() => [])));
router.post("/bookings", async (req, res) => {
  res.status(201).json(await db.booking.create({ data: { trainer: req.body.trainer, course: req.body.course ?? "", date: req.body.date, time: req.body.time } }));
});
router.get("/calendar", async (_req, res) => res.json(await db.calendarEvent.findMany({ take: 500 }).catch(() => [])));

const defaultSettings = { enabled: false, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: ["Professional Development", "Certification"] };
router.get("/review-credit/settings", async (req, res) => {
  const orgId = (req.query.orgId as string) ?? (await db.organization.findFirst({ select: { id: true } }).catch(() => null))?.id ?? "org1";
  const s = await db.reviewCreditSetting.findUnique({ where: { orgId } }).catch(() => null);
  if (!s) return res.json({ ...defaultSettings, orgId });
  res.json({ enabled: !!s.enabled, maxWeighting: s.maxWeighting, assessmentWeight: s.assessmentWeight, timelinessWeight: s.timelinessWeight, applicationWeight: s.applicationWeight, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: defaultSettings.eligibleProgrammeTypes, orgId });
});
router.patch("/review-credit/settings", requireRole("admin", "owner"), async (req, res) => {
  const orgId = req.body.orgId ?? (await db.organization.findFirst({ select: { id: true } }).catch(() => null))?.id ?? "org1";
  const s = await db.reviewCreditSetting.upsert({ where: { orgId }, create: { orgId, enabled: req.body.enabled ? 1 : 0, maxWeighting: req.body.maxWeighting ?? 10, assessmentWeight: req.body.assessmentWeight ?? 50, timelinessWeight: req.body.timelinessWeight ?? 30, applicationWeight: req.body.applicationWeight ?? 20 }, update: { enabled: req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : undefined, maxWeighting: req.body.maxWeighting ?? undefined, assessmentWeight: req.body.assessmentWeight ?? undefined, timelinessWeight: req.body.timelinessWeight ?? undefined, applicationWeight: req.body.applicationWeight ?? undefined } });
  res.json(s);
});
router.get("/review-credit/export", async (_req, res) => {
  const enrolments = await db.enrolment.findMany({ take: 1000 }).catch(() => []);
  const rows = enrolments.map((e) => ({ learnerId: e.learnerId, raw: e.enrolmentScore ?? 0, final: e.enrolmentScore ?? 0, signoff: e.managerSignOff ? "signed" : "pending" }));
  res.header("content-type", "text/csv");
  res.send(exportCSV(rows.length ? rows : [{ learnerId: "u1", raw: 82.18, final: 8.218, signoff: "pending" }]));
});
router.get("/organizations/:id/review-credits", async (req, res) => {
  const setting = await db.reviewCreditSetting.findUnique({ where: { orgId: req.params.id } }).catch(() => null);
  const enrolments = await db.enrolment.findMany({ take: 1000 }).catch(() => []);
  const byLearner: Record<string, number[]> = {};
  for (const e of enrolments) {
    if (e.reviewCreditExcluded || e.enrolmentScore == null) continue;
    (byLearner[e.learnerId] ??= []).push(e.enrolmentScore);
  }
  const rows = Object.entries(byLearner).map(([learnerId, scores]) => {
    const agg = aggregateReviewCredit(scores, setting?.maxWeighting ?? 10);
    return { learnerId, raw: agg.raw, final: agg.final };
  });
  res.json(rows);
});
router.get("/audit/logs", requireRole("admin", "owner"), async (_req, res) => {
  res.json(await db.auditLog.findMany({ take: 200, orderBy: { timestamp: "desc" } }).catch(() => []));
});
router.post("/nudge/run", async (_req, res) => {
  const events = await db.calendarEvent.findMany({ take: 200 }).catch(() => []);
  const gaps = findCalendarGaps(events.length ? events.map((e) => ({ userId: e.userId ?? "learner", date: e.date })) : [{ userId: "learner1", date: new Date().toISOString() }]);
  const sent = await sendNudges(gaps);
  res.json({ sent });
});
router.post("/help/ai", (req, res) => {
  if (!req.body?.question) return res.status(400).json({ error: "question required" });
  res.json({ answer: `Explainer stub for: ${req.body.question}. Connect an LLM provider for production answers.` });
});

router.get("/readyz", async (_req, res) => {
  try {
    const { checkDb } = await import("../db.js");
    const dbStatus = await checkDb();
    res.json({ status: dbStatus.ok ? "ready" : "degraded", db: dbStatus });
  } catch (e) {
    res.json({ status: "degraded", db: { ok: false, error: (e as Error).message } });
  }
});
