import { Router } from "express";
import { calculateEnrolmentScore, aggregateReviewCredit, exportCSV } from "../services/reviewCredit.js";
import { findCalendarGaps, sendNudges } from "../services/nudge.js";
import { signToken } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { auditEntries } from "../middleware/audit.js";
import { computeKpis } from "../jobs/kpiJob.js";

export const router = Router();

router.get("/healthz", (_req, res) => res.json({ status: "ok" }));

router.post("/auth/login", (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email required" });
  const token = signToken({ id: "u1", role: "admin", orgId: "org1" });
  res.json({ accessToken: token, user: { id: "u1", name: "Admin", email, role: "admin", initials: "AD" } });
});
router.post("/auth/sso", (req, res) => {
  if (!req.body?.samlAssertion) return res.status(400).json({ error: "samlAssertion required" });
  const token = signToken({ id: "sso-user", role: "learner", orgId: "org1" });
  res.json({ accessToken: token, user: { id: "sso-user", name: "SSO User", email: "sso@corp.com", role: "learner", initials: "SU" } });
});

router.get("/workspace", (_req, res) => res.json({ organization: { id: "org1", name: "Acme", plan: "pro", learnerCount: 120, programmeCount: 4 }, activeProgramme: { id: "p1", name: "Onboarding", type: "Onboarding", status: "active", learnerCount: 40, courseCount: 6, progress: 62, owner: "Admin" }, user: { id: "u1", name: "Admin", email: "a@corp.com", role: "admin", initials: "AD" }, dataSource: "db" }));
router.get("/dashboard/summary", (_req, res) => res.json({ complianceHealth: 92, completionRate: 68, competencyRate: 54, expiringCredentials: 3, dropOffRate: 12, timeToCompetency: 14, trainerUtilization: 78, weeklyActivity: [], dropOffHeatmap: [], expiringItems: [] }));
router.get("/kpi/summary", (_req, res) => res.json({ ...computeKpis([{ status: "completed", appliedScore: 85 }, { status: "enrolled" }]), weeklyActivity: [], dropOffHeatmap: [], expiringItems: [], complianceHealth: 92, completionRate: 68, competencyRate: 54, expiringCredentials: 3 }));

const enrolments: Record<string, any> = {};
router.get("/enrolments", (_req, res) => res.json(Object.values(enrolments)));
router.post("/enrolments", (req, res) => {
  const id = `e${Date.now()}`;
  enrolments[id] = { id, status: "enrolled", ...req.body };
  res.status(201).json(enrolments[id]);
});
router.patch("/enrolments/:id", (req, res) => {
  const e = enrolments[req.params.id];
  if (!e) return res.status(404).json({ error: "not found" });
  Object.assign(e, req.body);
  const { score } = calculateEnrolmentScore({ appliedAssessmentScore: e.appliedAssessmentScore, completionDate: e.completionDate, deadlineDate: e.deadlineDate, applicationScore: e.applicationScore });
  e.enrolmentScore = score;
  res.json(e);
});
router.delete("/enrolments/:id", requireRole("admin", "owner"), (req, res) => {
  delete enrolments[req.params.id];
  res.status(204).end();
});
router.get("/enrolments/:id/score", (req, res) => {
  const e = enrolments[req.params.id];
  if (!e) return res.status(404).json({ error: "not found" });
  const r = calculateEnrolmentScore({ appliedAssessmentScore: e.appliedAssessmentScore, completionDate: e.completionDate, deadlineDate: e.deadlineDate, applicationScore: e.applicationScore });
  res.json({ enrolmentId: req.params.id, score: r.score, breakdown: r });
});

router.get("/programmes", (_req, res) => res.json([]));
router.get("/programmes/:id/modules", (_req, res) => res.json([]));
router.post("/programmes/:id/modules", (req, res) => res.status(201).json({ id: `m${Date.now()}`, ...req.body }));
router.get("/modules/:id/assessments", (_req, res) => res.json([]));
router.post("/modules/:id/assessments", (req, res) => {
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  res.status(201).json({ id: `a${Date.now()}`, moduleId: req.params.id, ...req.body });
});
router.get("/courses", (_req, res) => res.json([]));
router.post("/courses", (req, res) => res.status(201).json({ id: `c${Date.now()}`, ...req.body }));
router.post("/courses/:id/attempts", (req, res) => {
  const { appliedScore = 0, recallScore = 0 } = req.body ?? {};
  const passed = appliedScore >= 70;
  res.json({ appliedScore, recallScore, passed, competenceMet: passed, message: passed ? "competence met" : "below applied threshold" });
});
router.get("/sessions", (_req, res) => res.json([]));
router.get("/threads", (_req, res) => res.json([]));
router.get("/threads/:id/messages", (_req, res) => res.json([]));
router.post("/threads/:id/messages", (req, res) => res.status(201).json({ id: `msg${Date.now()}`, threadId: req.params.id, ...req.body, createdAt: new Date().toISOString() }));
router.get("/bookings", (_req, res) => res.json([]));
router.post("/bookings", (req, res) => res.status(201).json({ id: `b${Date.now()}`, status: "confirmed", ...req.body }));
router.get("/calendar", (_req, res) => res.json([]));
router.get("/review-credit/settings", (_req, res) => res.json({ enabled: false, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: ["Professional Development", "Certification"] }));
router.patch("/review-credit/settings", requireRole("admin", "owner"), (req, res) => res.json({ enabled: false, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: [], ...req.body }));
router.get("/review-credit/export", (_req, res) => {
  res.header("content-type", "text/csv");
  res.send(exportCSV([{ learnerId: "u1", raw: 82.18, final: 8.218, signoff: "pending" }]));
});
router.get("/organizations/:id/review-credits", (req, res) => {
  const agg = aggregateReviewCredit([91.55, 67, 88], 10);
  res.json([{ learnerId: "u1", raw: agg.raw, final: agg.final }]);
});
router.get("/audit/logs", requireRole("admin", "owner"), (_req, res) => res.json(auditEntries));
router.post("/nudge/run", async (_req, res) => {
  const gaps = findCalendarGaps([{ userId: "learner1", date: new Date().toISOString() }]);
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
