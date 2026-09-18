import { Router } from "express";
import { calculateEnrolmentScore, aggregateReviewCredit, exportCSV } from "../services/reviewCredit.js";
import { findCalendarGaps, sendNudges } from "../services/nudge.js";
import { explainConcept } from "../services/aiExplainer.js";
import { verifyLoginPassword } from "../services/password.js";
import { signToken } from "../middleware/auth.js";
import { requireRole, requireProgrammeRole, isProgrammeStaff, isOrgStaff } from "../middleware/rbac.js";
import { computeKpis } from "../jobs/kpiJob.js";
import { avgResponseHours, slaStatusFor, runSlaJob, type SlaThread } from "../jobs/slaJob.js";
import { runNudgeJob } from "../jobs/nudgeJob.js";
import { runContentLifecycleJob } from "../jobs/contentLifecycleJob.js";
import { dispatchWebhook } from "../services/webhook.js";
import { db, orgScope, orgIdOf } from "../db.js";
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
router.post("/auth/forgot-password", async (req, res) => {
  if (!req.body?.email) return res.status(400).json({ error: "email required" });
  const { requestPasswordReset } = await import("../services/password.js");
  return res.json(await requestPasswordReset(req.body.email));
});
router.post("/auth/reset-password", async (req, res) => {
  if (!req.body?.token || !req.body?.newPassword) return res.status(400).json({ error: "token and newPassword required" });
  const { resetPassword } = await import("../services/password.js");
  const result = await resetPassword(req.body.token, req.body.newPassword);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
});
router.post("/auth/sso", async (req, res) => {
  if (process.env.SSO_ENABLED !== "true") {
    return res.status(501).json({ error: "SSO is not enabled — set SSO_ENABLED=true with a real SAML identity provider" });
  }
  if (!req.body?.samlAssertion || !req.body?.orgId) return res.status(400).json({ error: "samlAssertion and orgId required" });
  const { loginWithSaml } = await import("../services/saml.js");
  const result = await loginWithSaml(req.body.orgId, req.body.samlAssertion).catch(() => null);
  if (!result) return res.status(401).json({ error: "invalid credentials" });
  const user = await db.user.findUnique({ where: { id: result.userId } }).catch(() => null);
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  const role = (await db.userRole.findFirst({ where: { userId: user.id }, include: { role: true } }).catch(() => null))?.role.name ?? "learner";
  const token = signToken({ id: user.id, role, orgId: user.orgId });
  return res.json({ accessToken: token, user: { id: user.id, name: user.name, email: user.email, role, initials: user.name.slice(0, 2).toUpperCase() } });
});

router.get("/workspace", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const org = await db.organization.findUnique({ where: { id: scope.orgId } }).catch(() => null);
  const programme = await db.programme.findFirst({ where: { orgId: scope.orgId } }).catch(() => null);
  const me = (req as AuthedRequest).user;
  const user = me ? await db.user.findUnique({ where: { id: me.id } }).catch(() => null) : null;
  res.json({
    organization: org ?? { id: "org1", name: "Acme", plan: "pro", learnerCount: 120, programmeCount: 4 },
    activeProgramme: programme ?? { id: "p1", name: "Onboarding", type: "Onboarding", status: "active", learnerCount: 40, courseCount: 6, progress: 62, owner: "Admin" },
    user: user ?? { id: me?.id ?? "u1", name: "Admin", email: "a@corp.com", role: me?.role ?? "admin", initials: "AD" },
    dataSource: "mssql",
  });
});

async function kpiPayload(orgId: string) {
  const { buildDashboardSummary } = await import("../services/kpi.js");
  return buildDashboardSummary(orgId);
}
router.get("/dashboard/summary", async (req, res) => res.json(await kpiPayload(orgIdOf(req as AuthedRequest))));
router.get("/kpi/summary", async (req, res) => res.json(await kpiPayload(orgIdOf(req as AuthedRequest))));

async function assertProgrammeInOrg(programmeId: string, orgId: string) {
  const p = await db.programme.findFirst({ where: { id: programmeId, orgId } });
  if (!p) {
    const err = new Error("programme not found in your organization") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return p;
}
function lifecycleFilter(includeArchived: boolean) {
  return includeArchived ? { deletedAt: null } : { isArchived: false, deletedAt: null };
}
function canSeeArchived(role?: string) {
  return role === "admin" || role === "owner";
}
async function assertCourseInOrg(courseId: string, orgId: string) {
  const c = await db.course.findFirst({ where: { id: courseId, programme: { orgId } } });
  if (!c) {
    const err = new Error("course not found in your organization") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return c;
}

router.get("/enrolments", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const only = await stakeholderProgrammes(req as AuthedRequest);
  res.json(await db.enrolment.findMany({ where: { programme: scope, ...(only ? { programmeId: { in: only } } : {}) }, take: 200 }));
});
router.post("/enrolments", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const course = await assertCourseInOrg(req.body.courseId, scope.orgId);
  const learner = await db.user.findFirst({ where: { id: req.body.learnerId, orgId: scope.orgId } });
  if (!learner) {
    const err = new Error("learner not found in your organization") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const e = await db.enrolment.create({ data: { learnerId: learner.id, courseId: course.id, programmeId: req.body.programmeId ?? course.programmeId, status: "enrolled", deadlineDate: req.body.deadlineDate ? new Date(req.body.deadlineDate) : null } });
  if (e.programmeId) await assertProgrammeInOrg(e.programmeId, scope.orgId);
  return res.status(201).json(e);
});
router.patch("/enrolments/:id", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const current = await db.enrolment.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } });
  if (!current) return res.status(404).json({ error: "not found" });
  const isSelf = me.id === current.learnerId;
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, current.programmeId));
  const patch = req.body ?? {};
  if (patch.status !== undefined && !(isSelf || staff)) return res.status(403).json({ error: "only the learner or programme staff may update status" });
  if ((patch.appliedAssessmentScore !== undefined || patch.applicationScore !== undefined) && !staff) {
    return res.status(403).json({ error: "only programme trainers/admins may set scores" });
  }
  let signOffBy: string | undefined;
  let signOffAt: Date | undefined;
  if (patch.managerSignOff !== undefined) {
    const learner = await db.user.findUnique({ where: { id: current.learnerId } }).catch(() => null);
    if (!learner || learner.managerId !== me.id) return res.status(403).json({ error: "only the learner's line manager may sign off" });
    signOffBy = me.id;
    signOffAt = new Date();
  }
  const merged = { ...current, ...patch };
  const { score, b } = calculateEnrolmentScore({ appliedAssessmentScore: merged.appliedAssessmentScore ?? null, completionDate: merged.completionDate ?? null, deadlineDate: merged.deadlineDate ?? null, applicationScore: merged.applicationScore ?? null });
  const e = await db.enrolment.update({ where: { id: req.params.id }, data: { status: patch.status ?? undefined, appliedAssessmentScore: patch.appliedAssessmentScore ?? undefined, applicationScore: patch.applicationScore ?? undefined, timelinessScore: b, enrolmentScore: score, managerSignOff: patch.managerSignOff ?? undefined, managerSignOffBy: signOffBy ?? undefined, managerSignOffAt: signOffAt ?? undefined } });
  if (patch.status === "completed") {
    const [{ issueCertificateForEnrolment }, { checkStreakRecognition }] = await Promise.all([
      import("../services/certificates.js"),
      import("../services/recognition.js"),
    ]);
    await issueCertificateForEnrolment(e.id).catch(() => null);
    await checkStreakRecognition(e.learnerId).catch(() => null);
  }
  if (patch.appliedAssessmentScore !== undefined) {
    const { checkAppliedScoreRecognition } = await import("../services/recognition.js");
    await checkAppliedScoreRecognition(e.id).catch(() => null);
  }
  return res.json(e);
});
router.delete("/enrolments/:id", requireRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const existing = await db.enrolment.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } });
  if (!existing) return res.status(404).json({ error: "not found" });
  await db.enrolment.delete({ where: { id: req.params.id } }).catch(() => null);
  return res.status(204).end();
});
router.get("/enrolments/:id/score", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const e = await db.enrolment.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } });
  if (!e) return res.status(404).json({ error: "not found" });
  const r = calculateEnrolmentScore({ appliedAssessmentScore: e.appliedAssessmentScore, completionDate: e.completionDate, deadlineDate: e.deadlineDate, applicationScore: e.applicationScore });
  return res.json({ enrolmentId: req.params.id, score: r.score, breakdown: r });
});

router.get("/programmes", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const only = await stakeholderProgrammes(req as AuthedRequest);
  const programmes = await db.programme.findMany({ where: { ...scope, ...(only ? { id: { in: only } } : {}) }, take: 200 }).catch(() => []);
  const ids = programmes.map((p) => p.id);
  const courseGroups = ids.length ? await db.course.groupBy({ by: ["programmeId"], where: { programmeId: { in: ids }, deletedAt: null }, _count: { id: true } }).catch(() => []) : [];
  const enrolRows: { programmeId: string; learnerId: string }[] = ids.length ? await db.enrolment.findMany({ where: { programmeId: { in: ids } }, select: { programmeId: true, learnerId: true }, take: 5000 }).catch(() => []) : [];
  const learnersByProg = new Map<string, Set<string>>();
  for (const e of enrolRows) {
    const set = learnersByProg.get(e.programmeId) ?? new Set<string>();
    set.add(e.learnerId);
    learnersByProg.set(e.programmeId, set);
  }
  res.json(programmes.map((p) => ({
    ...p,
    courseCount: courseGroups.find((g) => g.programmeId === p.id)?._count.id ?? 0,
    learnerCount: learnersByProg.get(p.id)?.size ?? 0,
  })));
});
router.patch("/programmes/:id", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  for (const k of ["name", "type", "status", "owner"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.budget !== undefined) data.budget = Number(patch.budget);
  if (patch.progress !== undefined) data.progress = Number(patch.progress);
  return res.json(await db.programme.update({ where: { id: req.params.id }, data }));
});
async function resolveDeletionTarget(targetType: string, targetId: string, orgId: string): Promise<{ id: string; name: string } | null> {
  if (targetType === "programme") {
    const p = await db.programme.findFirst({ where: { id: targetId, orgId } });
    return p ? { id: p.id, name: p.name } : null;
  }
  if (targetType === "course") {
    const c = await db.course.findFirst({ where: { id: targetId, programme: { orgId } } });
    return c ? { id: c.id, name: c.title } : null;
  }
  if (targetType === "module") {
    const m = await db.module.findFirst({ where: { id: targetId, course: { programme: { orgId } } } });
    return m ? { id: m.id, name: m.title } : null;
  }
  if (targetType === "assessment") {
    const a = await db.assessment.findFirst({ where: { id: targetId, module: { course: { programme: { orgId } } } } });
    return a ? { id: a.id, name: `${a.type} assessment` } : null;
  }
  return null;
}
async function createDeleteRequest(targetType: string, targetId: string, me: { id: string }, orgId: string, reason?: string) {
  const target = await resolveDeletionTarget(targetType, targetId, orgId);
  if (!target) {
    const err = new Error(`${targetType} not found in your organization`) as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const existing = await db.deleteRequest.findFirst({ where: { targetType, targetId: target.id, status: "pending" } }).catch(() => null);
  if (existing) {
    const err = new Error("a pending delete request already exists for this target") as Error & { status?: number; requestId?: string };
    err.status = 409;
    err.requestId = existing.id;
    throw err;
  }
  return db.deleteRequest.create({
    data: { orgId, targetType, targetId: target.id, targetName: target.name, requestedBy: me.id, reason: reason ?? null },
  });
}
function deleteRequestBody(req: AuthedRequest) {
  return { targetId: req.params.id, reason: (req.body as { reason?: string } | null)?.reason };
}
router.post("/programmes/:id/delete-requests", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const { targetId, reason } = deleteRequestBody(req as AuthedRequest);
  try {
    return res.status(201).json(await createDeleteRequest("programme", targetId, me, scope.orgId, reason));
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message, ...("requestId" in (e as object) ? { requestId: (e as { requestId: string }).requestId } : {}) });
  }
});
router.post("/courses/:id/delete-requests", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const { targetId, reason } = deleteRequestBody(req as AuthedRequest);
  try {
    return res.status(201).json(await createDeleteRequest("course", targetId, me, scope.orgId, reason));
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message });
  }
});
router.post("/modules/:id/delete-requests", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const { targetId, reason } = deleteRequestBody(req as AuthedRequest);
  try {
    return res.status(201).json(await createDeleteRequest("module", targetId, me, scope.orgId, reason));
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message });
  }
});
router.post("/assessments/:id/delete-requests", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const { targetId, reason } = deleteRequestBody(req as AuthedRequest);
  try {
    return res.status(201).json(await createDeleteRequest("assessment", targetId, me, scope.orgId, reason));
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message });
  }
});
router.get("/delete-requests", requireRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  res.json(await db.deleteRequest.findMany({ where: { orgId: scope.orgId }, include: { requester: { select: { name: true, email: true } }, approver: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []));
});
router.post("/delete-requests/:id/approve", requireRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const dr = await db.deleteRequest.findFirst({ where: { id: req.params.id, orgId: scope.orgId } });
  if (!dr) return res.status(404).json({ error: "request not found in your organization" });
  if (dr.status !== "pending") return res.status(409).json({ error: `request already ${dr.status}` });
  if (dr.requestedBy === me.id) return res.status(403).json({ error: "approver must be a different user than the requester" });
  const now = new Date();
  if (dr.targetType === "programme") {
    await db.programme.updateMany({ where: { id: dr.targetId, orgId: scope.orgId }, data: { status: "archived" } });
    await db.course.updateMany({ where: { programmeId: dr.targetId, programme: { orgId: scope.orgId } }, data: { isArchived: true, archivedAt: now } });
  } else if (dr.targetType === "course") {
    await db.course.updateMany({ where: { id: dr.targetId, programme: { orgId: scope.orgId } }, data: { isArchived: true, archivedAt: now } });
  } else if (dr.targetType === "module") {
    const mod = await db.module.findFirst({ where: { id: dr.targetId, course: { programme: { orgId: scope.orgId } } } });
    if (mod) {
      await db.assessment.deleteMany({ where: { moduleId: mod.id } }).catch(() => null);
      await db.module.delete({ where: { id: mod.id } }).catch(() => null);
    }
  } else if (dr.targetType === "assessment") {
    const a = await db.assessment.findFirst({ where: { id: dr.targetId, module: { course: { programme: { orgId: scope.orgId } } } } });
    if (a) await db.assessment.delete({ where: { id: a.id } }).catch(() => null);
  } else {
    return res.status(400).json({ error: `unknown target type ${dr.targetType}` });
  }
  await db.auditLog.create({ data: { userId: me.id, action: "DELETE_REQUEST_APPROVED", entity: dr.targetType, entityId: dr.targetId, details: null } }).catch(() => null);
  return res.json(await db.deleteRequest.update({ where: { id: dr.id }, data: { status: "approved", approvedBy: me.id, decidedAt: now } }));
});
router.post("/delete-requests/:id/reject", requireRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const dr = await db.deleteRequest.findFirst({ where: { id: req.params.id, orgId: scope.orgId } });
  if (!dr) return res.status(404).json({ error: "request not found in your organization" });
  if (dr.status !== "pending") return res.status(409).json({ error: `request already ${dr.status}` });
  if (dr.requestedBy === me.id) return res.status(403).json({ error: "approver must be a different user than the requester" });
  return res.json(await db.deleteRequest.update({ where: { id: dr.id }, data: { status: "rejected", approvedBy: me.id, decidedAt: new Date() } }));
});
router.post("/programmes", requireRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  if (!req.body?.name) return res.status(400).json({ error: "name required" });
  const me = (req as AuthedRequest).user!;
  return res.status(201).json(await db.programme.create({
    data: { orgId: scope.orgId, name: req.body.name, type: req.body.type ?? "Professional Development", status: "active", owner: req.body.owner ?? me.id },
  }));
});
router.get("/programmes/:id/modules", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.module.findMany({ where: { course: { programmeId: req.params.id, programme: { orgId: scope.orgId } }, ...lifecycleFilter(includeArchived) } }).catch(() => []));
});
router.post("/programmes/:id/modules", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  let courseId = req.body.courseId;
  if (courseId) await assertCourseInOrg(courseId, scope.orgId);
  if (!courseId) {
    const first = await db.course.findFirst({ where: { programmeId: req.params.id, programme: { orgId: scope.orgId } } }).catch(() => null);
    if (!first) return res.status(400).json({ error: "courseId required (no courses in programme yet)" });
    courseId = first.id;
  }
  return res.status(201).json(await db.module.create({ data: { courseId, title: req.body.title ?? "New module" } }));
});
router.patch("/modules/:id", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.id, course: { programme: { orgId: scope.orgId } } } });
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.order !== undefined) data.order = Number(patch.order);
  return res.json(await db.module.update({ where: { id: mod.id }, data }));
});
router.patch("/assessments/:id", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const a = await db.assessment.findFirst({ where: { id: req.params.id, module: { course: { programme: { orgId: scope.orgId } } } } });
  if (!a) return res.status(404).json({ error: "assessment not found in your organization" });
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  const data: Record<string, unknown> = {};
  if (req.body?.type) data.type = req.body.type;
  if (req.body?.maxScore !== undefined) data.maxScore = Number(req.body.maxScore);
  return res.json(await db.assessment.update({ where: { id: a.id }, data }));
});
router.get("/modules/:id/assessments", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.assessment.findMany({ where: { moduleId: req.params.id, module: { course: { programme: { orgId: scope.orgId } } }, ...lifecycleFilter(includeArchived) } }).catch(() => []));
});
router.post("/modules/:id/assessments", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  const mod = await db.module.findFirst({ where: { id: req.params.id, course: { programme: { orgId: scope.orgId } } } });
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  return res.status(201).json(await db.assessment.create({ data: { moduleId: mod.id, type: req.body.type ?? "recall", maxScore: req.body.maxScore ?? 100 } }));
});
router.get("/courses", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const only = await stakeholderProgrammes(req as AuthedRequest);
  const programmeId = req.query.programmeId as string | undefined;
  if (programmeId) {
    if (only && !only.includes(programmeId)) return res.status(403).json({ error: "outside your programme scope" });
    await assertProgrammeInOrg(programmeId, scope.orgId);
  }
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  const programmeFilter = programmeId ? { programmeId } : only ? { programmeId: { in: only } } : {};
  return res.json(await db.course.findMany({ where: { programme: { orgId: scope.orgId }, ...programmeFilter, ...lifecycleFilter(includeArchived) }, take: 200 }).catch(() => []));
});
router.post("/courses", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.body.programmeId, scope.orgId);
  return res.status(201).json(await db.course.create({ data: { programmeId: req.body.programmeId, title: req.body.title, category: req.body.category ?? "General" } }));
});
router.patch("/courses/:id", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertCourseInOrg(req.params.id, scope.orgId);
  const patch = req.body ?? {};
  if (patch.programmeId) await assertProgrammeInOrg(patch.programmeId, scope.orgId);
  const data: Record<string, unknown> = {};
  for (const k of ["title", "category", "status", "trainer", "duration", "dueDate", "programmeId"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.appliedThreshold !== undefined) data.appliedThreshold = Number(patch.appliedThreshold);
  if (patch.progress !== undefined) data.progress = Number(patch.progress);
  return res.json(await db.course.update({ where: { id: req.params.id }, data }));
});
router.post("/courses/:courseId/modules/:moduleId/explain", async (req, res) => {
  const { concept, userQuery } = req.body ?? {};
  if (!concept || !userQuery) return res.status(400).json({ error: "concept and userQuery required" });
  const me = (req as AuthedRequest).user;
  if (me?.role === "learner") {
    const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: req.params.courseId } }).catch(() => null);
    if (!enrolled) return res.status(403).json({ error: "enrolment required" });
  }
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.moduleId, courseId: req.params.courseId, course: { programme: { orgId: scope.orgId } } } }).catch(() => null);
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  const course = await db.course.findUnique({ where: { id: req.params.courseId } }).catch(() => null);
  return res.json(await explainConcept({ courseTitle: course?.title ?? "Course", moduleTitle: mod.title, concept, userQuery }));
});
router.post("/courses/:id/feedback", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be an integer 1-5" });
  const scope = orgScope(req as AuthedRequest);
  await assertCourseInOrg(req.params.id, scope.orgId);
  if (me.role === "learner") {
    const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: req.params.id } }).catch(() => null);
    if (!enrolled) return res.status(403).json({ error: "enrolment required to leave feedback" });
  }
  return res.status(201).json(await db.courseFeedback.create({ data: { courseId: req.params.id, learnerId: me.id, rating, comment: req.body?.comment ?? null } }));
});
router.post("/courses/:id/attempts", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  if (me.role === "learner") {
    const scope = orgScope(req as AuthedRequest);
    const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: req.params.id, programme: { orgId: scope.orgId } } }).catch(() => null);
    if (!enrolled) return res.status(403).json({ error: "enrolment required to submit attempts" });
  }
  const { appliedScore = 0, recallScore = 0 } = req.body ?? {};
  const passed = appliedScore >= 70;
  return res.json({ appliedScore, recallScore, passed, competenceMet: passed, message: passed ? "competence met" : "below applied threshold" });
});
router.get("/sessions", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  res.json(await db.session.findMany({ where: { orgId: scope.orgId }, take: 200 }).catch(() => []));
});
router.post("/sessions", requireRole("trainer", "admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  if (!req.body?.title || !req.body?.date || !req.body?.time) return res.status(400).json({ error: "title, date and time required" });
  let programmeId: string | null = null;
  if (req.body.programmeId) {
    await assertProgrammeInOrg(req.body.programmeId, scope.orgId);
    programmeId = req.body.programmeId;
  }
  let trainerId: string | null = null;
  if (req.body.trainerId) {
    const trainer = await db.user.findFirst({ where: { id: req.body.trainerId, orgId: scope.orgId } });
    if (!trainer) return res.status(404).json({ error: "trainer not found in your organization" });
    trainerId = trainer.id;
  }
  return res.status(201).json(await db.session.create({ data: { title: req.body.title, programme: req.body.programme ?? "", programmeId, orgId: scope.orgId, trainer: req.body.trainer ?? "", trainerId, date: req.body.date, time: req.body.time, mode: req.body.mode ?? "online", capacity: req.body.capacity ?? null } }));
});
router.post("/sessions/:id/invite", requireRole("trainer", "admin", "owner"), async (req, res) => {
  const session = await db.session.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: "session not found" });
  const learnerIds = ((req.body?.learnerIds ?? []) as string[]).slice(0, 500);
  let invited = 0;
  for (const learnerId of learnerIds) {
    const r = await db.sessionRSVP.upsert({
      where: { id: `${session.id}:${learnerId}` },
      create: { id: `${session.id}:${learnerId}`, sessionId: session.id, learnerId, status: "invited" },
      update: {},
    }).catch(() => null);
    if (r) invited += 1;
  }
  return res.json({ sessionId: session.id, invited });
});
router.post("/sessions/:id/rsvp", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const { confirmRsvp, declineRsvp } = await import("../services/rsvp.js");
  const learnerId = me.role === "learner" ? me.id : (req.body?.learnerId ?? me.id);
  if (me.role === "learner" && learnerId !== me.id) return res.status(403).json({ error: "learners may only RSVP for themselves" });
  const rsvpOrg = orgIdOf(req as AuthedRequest);
  try {
    if (req.body?.status === "declined") return res.json(await declineRsvp(req.params.id, learnerId, rsvpOrg));
    return res.json(await confirmRsvp(req.params.id, learnerId, rsvpOrg));
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message });
  }
});
router.get("/threads", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const threads = await db.messageThread.findMany({ where: { orgId: scope.orgId }, take: 200, orderBy: { updatedAt: "desc" }, include: { messages: { orderBy: { createdAt: "asc" } } } }).catch(() => []);
  res.json(threads.map((t) => ({ ...t, averageResponseTimeHours: avgResponseHours(t.messages.map((m) => ({ author: m.author, createdAt: m.createdAt }))), slaStatus: slaStatusFor(t as SlaThread, avgResponseHours(t.messages.map((m) => ({ author: m.author, createdAt: m.createdAt })))) })));
});
async function assertThreadVisible(threadId: string, orgId: string) {
  const t = await db.messageThread.findFirst({ where: { id: threadId, orgId } });
  if (!t) {
    const err = new Error("thread not found in your organization") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return t;
}
router.get("/threads/:id/messages", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertThreadVisible(req.params.id, scope.orgId);
  res.json(await db.message.findMany({ where: { threadId: req.params.id }, orderBy: { createdAt: "asc" } }).catch(() => []));
});
router.post("/threads/:id/messages", async (req, res) => {
  await assertThreadVisible(req.params.id, orgIdOf(req as AuthedRequest));
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
router.get("/bookings", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  res.json(await db.booking.findMany({ where: { orgId: scope.orgId }, take: 200 }).catch(() => []));
});
router.post("/bookings", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (me.role === "learner") {
    const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, programme: { orgId: scope.orgId } } }).catch(() => null);
    if (!enrolled) return res.status(403).json({ error: "only enrolled learners may book sessions" });
  }
  let trainerId: string | null = null;
  if (req.body.trainer) {
    const trainers = await db.user.findMany({ where: { name: req.body.trainer, orgId: scope.orgId }, select: { id: true } }).catch(() => []);
    if (trainers.length === 1) trainerId = trainers[0].id;
  }
  let courseId: string | null = null;
  if (req.body.course) {
    const course = await db.course.findFirst({ where: { title: req.body.course, programme: { orgId: scope.orgId } } }).catch(() => null);
    if (course) courseId = course.id;
  }
  return res.status(201).json(await db.booking.create({ data: { trainer: req.body.trainer, trainerId, course: req.body.course ?? "", courseId, orgId: scope.orgId, date: req.body.date, time: req.body.time } }));
});
router.get("/calendar", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const where = me.role === "learner" ? { orgId: scope.orgId, userId: me.id } : { orgId: scope.orgId };
  res.json(await db.calendarEvent.findMany({ where, take: 500 }).catch(() => []));
});
router.get("/calendar/connections", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  res.json(await db.calendarConnection.findMany({ where: { userId: me.id }, select: { id: true, provider: true, calendarId: true, createdAt: true }, take: 20 }).catch(() => []));
});
router.post("/calendar/connections", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  if (!["microsoft", "google"].includes(req.body?.provider)) return res.status(400).json({ error: "provider must be microsoft|google" });
  if (!req.body?.accessToken) return res.status(400).json({ error: "accessToken required (complete the OAuth flow first)" });
  return res.status(201).json(await db.calendarConnection.create({ data: { userId: me.id, provider: req.body.provider, accessToken: req.body.accessToken, refreshToken: req.body.refreshToken ?? null, calendarId: req.body.calendarId ?? null } }));
});
router.delete("/calendar/connections/:id", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const existing = await db.calendarConnection.findFirst({ where: { id: req.params.id, userId: me.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  await db.calendarConnection.delete({ where: { id: req.params.id } }).catch(() => null);
  return res.status(204).end();
});
router.post("/sessions/:id/sync-calendar", requireRole("trainer", "admin", "owner"), async (req, res) => {
  const { syncSessionToCalendars } = await import("../services/calendarSync.js");
  try {
    return res.json(await syncSessionToCalendars(req.params.id, undefined, orgIdOf(req as AuthedRequest)));
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message });
  }
});
router.get("/recognitions", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (me.role === "learner") {
    res.json(await db.recognition.findMany({ where: { userId: me.id }, orderBy: { awardedAt: "desc" }, take: 100 }).catch(() => []));
  } else {
    res.json(await db.recognition.findMany({ where: { user: { orgId: scope.orgId } }, include: { user: { select: { name: true, email: true } } }, orderBy: { awardedAt: "desc" }, take: 200 }).catch(() => []));
  }
});
router.get("/certificates", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (me.role === "learner") {
    res.json(await db.certificate.findMany({ where: { learnerId: me.id }, include: { course: { select: { title: true } } }, orderBy: { issuedAt: "desc" }, take: 200 }).catch(() => []));
  } else {
    res.json(await db.certificate.findMany({ where: { course: { programme: { orgId: scope.orgId } } }, include: { course: { select: { title: true } }, learner: { select: { name: true, email: true } } }, orderBy: { expiresAt: "asc" }, take: 500 }).catch(() => []));
  }
});
router.post("/certificates/check-expiry", requireRole("admin", "owner"), async (req, res) => {
  const { runCertificateExpiryJob } = await import("../jobs/certificateExpiryJob.js");
  res.json(await runCertificateExpiryJob(Number(req.body?.withinDays ?? 30)));
});
router.get("/cohorts", requireRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  res.json(await db.cohort.findMany({ where: { orgId: scope.orgId }, include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } }, take: 200 }).catch(() => []));
});
router.post("/cohorts", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  if (!req.body?.name) return res.status(400).json({ error: "name required" });
  return res.status(201).json(await db.cohort.create({ data: { orgId: scope.orgId, name: req.body.name, department: req.body.department ?? null } }));
});
router.post("/cohorts/:id/members", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const cohort = await db.cohort.findFirst({ where: { id: req.params.id, orgId: scope.orgId } });
  if (!cohort) return res.status(404).json({ error: "cohort not found in your organization" });
  const userIds = ((req.body?.userIds ?? []) as string[]).slice(0, 500);
  const members = await db.user.findMany({ where: { id: { in: userIds }, orgId: scope.orgId }, select: { id: true } }).catch(() => []);
  let added = 0;
  for (const m of members) {
    const r = await db.cohortMember.upsert({ where: { cohortId_userId: { cohortId: cohort.id, userId: m.id } }, create: { cohortId: cohort.id, userId: m.id }, update: {} }).catch(() => null);
    if (r) added += 1;
  }
  return res.json({ cohortId: cohort.id, added });
});
router.post("/cohorts/:id/enrol", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const cohort = await db.cohort.findFirst({ where: { id: req.params.id, orgId: scope.orgId }, include: { members: true } });
  if (!cohort) return res.status(404).json({ error: "cohort not found in your organization" });
  if (!req.body?.courseId) return res.status(400).json({ error: "courseId required" });
  const course = await assertCourseInOrg(req.body.courseId, scope.orgId);
  let created = 0;
  for (const m of cohort.members) {
    const existing = await db.enrolment.findFirst({ where: { learnerId: m.userId, courseId: course.id } }).catch(() => null);
    if (existing) continue;
    await db.enrolment.create({ data: { learnerId: m.userId, courseId: course.id, programmeId: course.programmeId, status: "enrolled" } }).catch(() => null);
    created += 1;
  }
  return res.json({ cohortId: cohort.id, courseId: course.id, enrolled: created });
});

const defaultSettings = { enabled: false, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: ["Professional Development", "Certification"] };
router.get("/review-credit/settings", async (req, res) => {
  const orgId = orgIdOf(req as AuthedRequest);
  const s = await db.reviewCreditSetting.findUnique({ where: { orgId } }).catch(() => null);
  if (!s) return res.json({ ...defaultSettings, orgId });
  return res.json({ enabled: !!s.enabled, maxWeighting: s.maxWeighting, assessmentWeight: s.assessmentWeight, timelinessWeight: s.timelinessWeight, applicationWeight: s.applicationWeight, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: defaultSettings.eligibleProgrammeTypes, orgId });
});
router.patch("/review-credit/settings", requireRole("admin", "owner"), async (req, res) => {
  const orgId = orgIdOf(req as AuthedRequest);
  const s = await db.reviewCreditSetting.upsert({ where: { orgId }, create: { orgId, enabled: req.body.enabled ? 1 : 0, maxWeighting: req.body.maxWeighting ?? 10, assessmentWeight: req.body.assessmentWeight ?? 50, timelinessWeight: req.body.timelinessWeight ?? 30, applicationWeight: req.body.applicationWeight ?? 20 }, update: { enabled: req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : undefined, maxWeighting: req.body.maxWeighting ?? undefined, assessmentWeight: req.body.assessmentWeight ?? undefined, timelinessWeight: req.body.timelinessWeight ?? undefined, applicationWeight: req.body.applicationWeight ?? undefined } });
  res.json(s);
});
router.get("/review-credit/export", async (req, res) => {
  const enrolments: Enrolment[] = await db.enrolment.findMany({ where: { programme: orgScope(req as AuthedRequest) }, take: 1000 }).catch(() => []);
  const rows = enrolments.map((e) => ({ learnerId: e.learnerId, raw: e.enrolmentScore ?? 0, final: e.enrolmentScore ?? 0, signoff: e.managerSignOff ? "signed" : "pending" }));
  res.header("content-type", "text/csv");
  res.send(exportCSV(rows.length ? rows : [{ learnerId: "u1", raw: 82.18, final: 8.218, signoff: "pending" }]));
});
async function stakeholderProgrammes(req: AuthedRequest): Promise<string[] | null> {
  if (req.user?.role !== "stakeholder") return null;
  const grants = await db.userRole.findMany({ where: { userId: req.user.id, programmeId: { not: null } }, select: { programmeId: true } }).catch(() => []);
  return grants.map((g) => g.programmeId as string);
}
function assertSameOrg(req: AuthedRequest, orgId: string) {
  if (req.user?.orgId !== orgId) {
    const err = new Error("cross-organization access denied") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}
router.patch("/organizations/:id", requireRole("owner", "admin"), async (req, res) => {
  assertSameOrg(req as AuthedRequest, req.params.id);
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  for (const k of ["name", "plan", "domain"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.webhookUrls !== undefined) {
    if (!Array.isArray(patch.webhookUrls)) return res.status(400).json({ error: "webhookUrls must be an array" });
    data.webhookUrls = JSON.stringify(patch.webhookUrls);
  }
  if (patch.maxWeighting !== undefined) data.reviewCreditMaxWeighting = Number(patch.maxWeighting);
  return res.json(await db.organization.update({ where: { id: req.params.id }, data }));
});
router.post("/organizations", async (req, res) => {
  const { name, adminEmail, adminName, domain, adminPassword } = req.body ?? {};
  if (!name || !adminEmail || !adminName) return res.status(400).json({ error: "name, adminEmail and adminName required" });
  if (!adminPassword) return res.status(400).json({ error: "adminPassword required" });
  const existing = await db.user.findUnique({ where: { email: adminEmail } }).catch(() => null);
  if (existing) return res.status(409).json({ error: "email already registered" });
  const token = `verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const org = await db.organization.create({ data: { name, domain: domain ?? null, domainVerificationToken: token } });
  const { hashPassword } = await import("../services/password.js");
  const ownerRole = await db.role.findUnique({ where: { name: "owner" } }).catch(() => null);
  const user = await db.user.create({ data: { orgId: org.id, name: adminName, email: adminEmail, passwordHash: await hashPassword(adminPassword) } });
  if (ownerRole) await db.userRole.create({ data: { userId: user.id, roleId: ownerRole.id, programmeId: null } }).catch(() => null);
  console.log(`[registration] org=${org.id} verify token=${token} (email send stubbed — no provider configured)`);
  return res.status(201).json({ orgId: org.id, domainVerified: false, verificationToken: token });
});
router.post("/organizations/:id/verify-domain", async (req, res) => {
  const org = await db.organization.findUnique({ where: { id: req.params.id } }).catch(() => null);
  if (!org) return res.status(404).json({ error: "organization not found" });
  if (org.id !== (req as AuthedRequest).user?.orgId) return res.status(403).json({ error: "cross-organization access denied" });
  if (req.body?.token !== org.domainVerificationToken) return res.status(400).json({ error: "invalid verification token" });
  const updated = await db.organization.update({ where: { id: org.id }, data: { domainVerified: true, domainVerificationToken: null } });
  return res.json({ orgId: updated.id, domainVerified: updated.domainVerified });
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_ROLE_MAPPING: Record<string, string> = { trainer: "trainer", facilitator: "trainer", admin: "admin", owner: "owner", stakeholder: "stakeholder" };
router.post("/organizations/:id/learners/import", requireRole("admin", "owner"), async (req, res) => {
  assertSameOrg(req as AuthedRequest, req.params.id);
  const orgId = req.params.id;
  const rows = (req.body?.rows ?? []) as { name?: string; email?: string; department?: string; jobFunction?: string; managerEmail?: string }[];
  const roleMapping = { ...DEFAULT_ROLE_MAPPING, ...((req.body?.roleMapping ?? {}) as Record<string, string>) };
  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: { row: number; email?: string; error: string }[] = [];
  const warnings: { row: number; email: string; warning: string }[] = [];
  const validRoles = new Set(["owner", "admin", "trainer", "learner", "stakeholder"]);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.email || !EMAIL_RE.test(row.email)) {
      failed += 1;
      errors.push({ row: i, email: row.email, error: "invalid email" });
      continue;
    }
    let managerId: string | null = null;
    if (row.managerEmail) {
      const manager = await db.user.findFirst({ where: { email: row.managerEmail, orgId } }).catch(() => null);
      if (!manager) warnings.push({ row: i, email: row.email, warning: `unknown manager ${row.managerEmail} — imported with managerId null` });
      else managerId = manager.id;
    }
    const mapped = validRoles.has(roleMapping[(row.jobFunction ?? "").toLowerCase()] ?? "") ? roleMapping[(row.jobFunction ?? "").toLowerCase()] : "learner";
    try {
      const existing = await db.user.findUnique({ where: { email: row.email } });
      if (existing && existing.orgId !== orgId) throw new Error("email belongs to another organization");
      let userId: string;
      if (existing) {
        await db.user.update({ where: { email: row.email }, data: { name: row.name ?? existing.name, department: row.department ?? undefined, jobFunction: row.jobFunction ?? undefined, managerId } });
        updated += 1;
        userId = existing.id;
      } else {
        const { hashPassword } = await import("../services/password.js");
        const created_user = await db.user.create({ data: { orgId, name: row.name ?? row.email, email: row.email, passwordHash: await hashPassword(`invite-${Date.now().toString(36)}`), department: row.department ?? null, jobFunction: row.jobFunction ?? null, managerId } });
        created += 1;
        userId = created_user.id;
      }
      const programmeId = req.body?.programmeId as string | undefined;
      if (programmeId && mapped !== "learner") {
        await assertProgrammeInOrg(programmeId, orgId);
        const role = await db.role.findUnique({ where: { name: mapped } }).catch(() => null);
        if (role) await db.userRole.upsert({ where: { userId_roleId: { userId, roleId: role.id } }, create: { userId, roleId: role.id, programmeId }, update: { programmeId } }).catch(() => null);
      }
    } catch (e) {
      failed += 1;
      errors.push({ row: i, email: row.email, error: (e as Error).message });
    }
  }
  return res.json({ created, updated, failed, errors, warnings });
});
router.get("/organizations/:id/review-credits", async (req, res) => {
  assertSameOrg(req as AuthedRequest, req.params.id);
  const setting = await db.reviewCreditSetting.findUnique({ where: { orgId: req.params.id } }).catch(() => null);
  const enrolments = await db.enrolment.findMany({ where: { programme: { orgId: req.params.id } }, take: 1000 }).catch(() => []);
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
  assertSameOrg(req as AuthedRequest, req.params.id);
  const format = (req.query.format as string) === "csv" ? "csv" : "json";
  const setting = await db.reviewCreditSetting.findUnique({ where: { orgId: req.params.id } }).catch(() => null);
  const enrolments: Enrolment[] = await db.enrolment.findMany({ where: { programme: { orgId: req.params.id } }, take: 1000 }).catch(() => []);
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
  const orgId = orgIdOf(req as AuthedRequest);
  const now = new Date();
  const updated = await db.enrolment.updateMany({ where: { reviewCreditLockedAt: null, reviewCreditExcluded: false, programme: { orgId } }, data: { reviewCreditLockedAt: now } }).catch(() => ({ count: 0 }));
  await db.auditLog.create({ data: { userId: (req as AuthedRequest).user?.id ?? null, action: "REVIEW_CYCLE_LOCKED", entity: "organization", entityId: orgId, details: null } }).catch(() => null);
  const webhook = await dispatchWebhook(orgId, "review_credit_finalized", { lockedAt: now.toISOString(), lockedCount: updated.count });
  res.json({ orgId, lockedAt: now.toISOString(), lockedCount: updated.count, webhook });
});
router.get("/audit/logs", requireRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const members = await db.user.findMany({ where: { orgId: scope.orgId }, select: { id: true } }).catch(() => []);
  const ids = members.map((m) => m.id);
  res.json(await db.auditLog.findMany({ where: { OR: [{ userId: null }, { userId: { in: ids } }] }, take: 200, orderBy: { timestamp: "desc" } }).catch(() => []));
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
router.post("/content-lifecycle/run", requireRole("admin", "owner"), async (_req, res) => {
  res.json(await runContentLifecycleJob());
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


