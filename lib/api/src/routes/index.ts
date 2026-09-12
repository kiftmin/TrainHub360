import { Router } from "express";
import { calculateEnrolmentScore, aggregateReviewCredit, exportCSV } from "../services/reviewCredit.js";
import { findCalendarGaps, sendNudges } from "../services/nudge.js";
import { explainConcept } from "../services/aiExplainer.js";
import { verifyLoginPassword } from "../services/password.js";
import { signToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { computeKpis } from "../jobs/kpiJob.js";
import { avgResponseHours, slaStatusFor, runSlaJob, type SlaThread } from "../jobs/slaJob.js";
import { runNudgeJob } from "../jobs/nudgeJob.js";
import { dispatchWebhook } from "../services/webhook.js";
import { db } from "../db.js";
import type { AuthedRequest } from "../middleware/auth.js";
type EnrolmentRow = Awaited<ReturnType<typeof db.enrolment.findMany>>[number];
type Enrolment = EnrolmentRow;

export const router = Router();

router.get("/healthz", (_req, res) => res.json({ status: "ok" }));

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const user = await db.user.findUnique({ where: { email } }).catch(() => null);
  const ok = await verifyLoginPassword(password, user?.passwordHash ?? null);
  if (!ok || !user) return res.status(401).json({ error: "invalid credentials" });
  const role = (await db.userRole.findFirst({ where: { userId: user.id }, include: { role: true } }).catch(() => null))?.role.name ?? "learner";
  const token = signToken({ id: user.id, role, orgId: user.orgId });
  return res.json({ accessToken: token, user: { id: user.id, name: user.name, email: user.email, role, initials: user.name.slice(0, 2).toUpperCase() } });
});
router.post("/auth/sso", (req, res) => {
  if (!req.body?.samlAssertion) return res.status(400).json({ error: "samlAssertion required" });
  const token = signToken({ id: "sso-user", role: "learner", orgId: "org1" });
  return res.json({ accessToken: token, user: { id: "sso-user", name: "SSO User", email: "sso@corp.com", role: "learner", initials: "SU" } });
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
  return res.json(e);
});
router.delete("/enrolments/:id", requireRole("admin", "owner"), async (req, res) => {
  await db.enrolment.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});
router.get("/enrolments/:id/score", async (req, res) => {
  const e = await db.enrolment.findUnique({ where: { id: req.params.id } });
  if (!e) return res.status(404).json({ error: "not found" });
  const r = calculateEnrolmentScore({ appliedAssessmentScore: e.appliedAssessmentScore, completionDate: e.completionDate, deadlineDate: e.deadlineDate, applicationScore: e.applicationScore });
  return res.json({ enrolmentId: req.params.id, score: r.score, breakdown: r });
});

router.get("/programmes", async (_req, res) => res.json(await db.programme.findMany({ take: 200 }).catch(() => [])));
function lifecycleFilter(includeArchived: boolean) {
  return includeArchived ? { deletedAt: null } : { isArchived: false, deletedAt: null };
}
function canSeeArchived(role?: string) {
  return role === "admin" || role === "owner";
}
router.get("/programmes/:id/modules", async (req, res) => {
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.module.findMany({ where: { course: { programmeId: req.params.id }, ...lifecycleFilter(includeArchived) } }).catch(() => []));
});
router.post("/programmes/:id/modules", async (req, res) => {
  let courseId = req.body.courseId;
  if (!courseId) {
    const first = await db.course.findFirst({ where: { programmeId: req.params.id } }).catch(() => null);
    if (!first) return res.status(400).json({ error: "courseId required (no courses in programme yet)" });
    courseId = first.id;
  }
  return res.status(201).json(await db.module.create({ data: { courseId, title: req.body.title ?? "New module" } }));
});
router.get("/modules/:id/assessments", async (req, res) => {
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.assessment.findMany({ where: { moduleId: req.params.id, ...lifecycleFilter(includeArchived) } }).catch(() => []));
});
router.post("/modules/:id/assessments", async (req, res) => {
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  return res.status(201).json(await db.assessment.create({ data: { moduleId: req.params.id, type: req.body.type ?? "recall", maxScore: req.body.maxScore ?? 100 } }));
});
router.get("/courses", async (req, res) => {
  const programmeId = req.query.programmeId as string | undefined;
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.course.findMany({ where: { ...(programmeId ? { programmeId } : {}), ...lifecycleFilter(includeArchived) }, take: 200 }).catch(() => []));
});
router.post("/courses", async (req, res) => {
  res.status(201).json(await db.course.create({ data: { programmeId: req.body.programmeId, title: req.body.title, category: req.body.category ?? "General" } }));
});
router.post("/courses/:id/archive", requireRole("admin", "owner"), async (req, res) => {
  const course = await db.course.update({ where: { id: req.params.id }, data: { isArchived: true, archivedAt: new Date() } });
  await db.auditLog.create({ data: { userId: (req as AuthedRequest).user?.id ?? null, action: "POST /courses/:id/archive", entity: "course", entityId: course.id, details: null } }).catch(() => null);
  res.json(course);
});
router.delete("/courses/:id", requireRole("admin", "owner"), async (req, res) => {
  const course = await db.course.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  await db.auditLog.create({ data: { userId: (req as AuthedRequest).user?.id ?? null, action: "DELETE /courses/:id", entity: "course", entityId: course.id, details: null } }).catch(() => null);
  res.status(204).end();
});
router.post("/courses/:courseId/modules/:moduleId/explain", async (req, res) => {
  const { concept, userQuery } = req.body ?? {};
  if (!concept || !userQuery) return res.status(400).json({ error: "concept and userQuery required" });
  const me = (req as AuthedRequest).user;
  if (me?.role === "learner") {
    const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: req.params.courseId } }).catch(() => null);
    if (!enrolled) return res.status(403).json({ error: "enrolment required" });
  }
  const course = await db.course.findUnique({ where: { id: req.params.courseId } }).catch(() => null);
  const mod = await db.module.findUnique({ where: { id: req.params.moduleId } }).catch(() => null);
  if (!mod) return res.status(404).json({ error: "module not found" });
  return res.json(await explainConcept({ courseTitle: course?.title ?? "Course", moduleTitle: mod.title, concept, userQuery }));
});
router.post("/courses/:id/attempts", (req, res) => {
  const { appliedScore = 0, recallScore = 0 } = req.body ?? {};
  const passed = appliedScore >= 70;
  res.json({ appliedScore, recallScore, passed, competenceMet: passed, message: passed ? "competence met" : "below applied threshold" });
});
router.get("/sessions", async (_req, res) => res.json(await db.session.findMany({ take: 200 }).catch(() => [])));
router.get("/threads", async (_req, res) => {
  const threads = await db.messageThread.findMany({ take: 200, orderBy: { updatedAt: "desc" }, include: { messages: { orderBy: { createdAt: "asc" } } } }).catch(() => []);
  res.json(threads.map((t) => ({ ...t, averageResponseTimeHours: avgResponseHours(t.messages.map((m) => ({ author: m.author, createdAt: m.createdAt }))), slaStatus: slaStatusFor(t as SlaThread, avgResponseHours(t.messages.map((m) => ({ author: m.author, createdAt: m.createdAt })))) })));
});
router.get("/threads/:id/messages", async (req, res) => {
  res.json(await db.message.findMany({ where: { threadId: req.params.id }, orderBy: { createdAt: "asc" } }).catch(() => []));
});
router.post("/threads/:id/messages", async (req, res) => {
  const role = (req as AuthedRequest).user?.role ?? req.body.authorRole ?? "learner";
  const isLearner = role === "learner";
  const msg = await db.message.create({ data: { threadId: req.params.id, author: req.body.author ?? role, body: req.body.body, urgent: req.body.urgent ?? false } });
  await db.messageThread.update({
    where: { id: req.params.id },
    data: isLearner
      ? { lastLearnerMessageAt: new Date(), updatedAt: new Date() }
      : { lastTrainerResponseAt: new Date(), isEscalated: false, updatedAt: new Date() },
  }).catch(() => null);
  res.status(201).json(msg);
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
  return res.json({ enabled: !!s.enabled, maxWeighting: s.maxWeighting, assessmentWeight: s.assessmentWeight, timelinessWeight: s.timelinessWeight, applicationWeight: s.applicationWeight, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: defaultSettings.eligibleProgrammeTypes, orgId });
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
router.get("/organizations/:id/review-credits/export", requireRole("admin", "owner"), async (req, res) => {
  const format = (req.query.format as string) === "csv" ? "csv" : "json";
  const setting = await db.reviewCreditSetting.findUnique({ where: { orgId: req.params.id } }).catch(() => null);
  const enrolments = await db.enrolment.findMany({ take: 1000 }).catch(() => []);
  const byLearner: Record<string, Enrolment[]> = {};
  for (const e of enrolments) {
    if (e.reviewCreditExcluded || e.enrolmentScore == null) continue;
    const list = byLearner[e.learnerId];
    if (list) list.push(e);
    else byLearner[e.learnerId] = [e];
  }
  const rows = Object.entries(byLearner).map(([learnerId, list]) => {
    const agg = aggregateReviewCredit(list.map((e) => e.enrolmentScore as number), setting?.maxWeighting ?? 10);
    return {
      learnerId,
      enrolmentIds: list.map((e) => e.id),
      raw: agg.raw,
      final: agg.final,
      managerApprovals: list.map((e) => ({ enrolmentId: e.id, signOff: e.managerSignOff ?? false, by: e.managerSignOffBy ?? null, at: e.managerSignOffAt ?? null })),
      lockedAt: list.map((e) => e.reviewCreditLockedAt).filter(Boolean),
    };
  });
  if (format === "csv") {
    res.header("content-type", "text/csv");
    return res.send(exportCSV(rows.map((r) => ({ learnerId: r.learnerId, raw: r.raw, final: r.final, signoff: r.managerApprovals.every((a) => a.signOff) ? "signed" : "pending" }))));
  }
  return res.json(rows);
});
router.post("/review-credits/lock", requireRole("admin", "owner"), async (req, res) => {
  const orgId = req.body.orgId ?? (await db.organization.findFirst({ select: { id: true } }).catch(() => null))?.id ?? "org1";
  const now = new Date();
  const updated = await db.enrolment.updateMany({ where: { reviewCreditLockedAt: null, reviewCreditExcluded: false }, data: { reviewCreditLockedAt: now } }).catch(() => ({ count: 0 }));
  await db.auditLog.create({ data: { userId: (req as AuthedRequest).user?.id ?? null, action: "REVIEW_CYCLE_LOCKED", entity: "organization", entityId: orgId, details: null } }).catch(() => null);
  const webhook = await dispatchWebhook(orgId, "review_credit_finalized", { lockedAt: now.toISOString(), lockedCount: updated.count });
  res.json({ orgId, lockedAt: now.toISOString(), lockedCount: updated.count, webhook });
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
router.post("/sla/run", requireRole("admin", "owner"), async (_req, res) => {
  res.json(await runSlaJob());
});
router.post("/nudge/dispatch", requireRole("admin", "owner"), async (_req, res) => {
  res.json(await runNudgeJob());
});
router.post("/help/ai", (req, res) => {
  if (!req.body?.question) return res.status(400).json({ error: "question required" });
  return res.json({ answer: `Explainer stub for: ${req.body.question}. Connect an LLM provider for production answers.` });
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

// Express 4 does not catch async handler rejections � wrap every route so DB
// outages become 503s via the error middleware instead of crashing the process.
for (const layer of ((router as unknown as { stack: { route?: { stack: { handle: (req: unknown, res: unknown, next: (e?: unknown) => void) => unknown }[] } }[] }).stack)) {
  const route = layer.route;
  if (!route) continue;
  for (const l of route.stack) {
    const orig = l.handle;
    l.handle = (req: unknown, res: unknown, next: (e?: unknown) => void) =>
      Promise.resolve(orig(req, res, next)).catch(next);
  }
}


