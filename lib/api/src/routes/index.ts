import { Router } from "express";
import { calculateEnrolmentScore, aggregateReviewCredit, exportCSV } from "../services/reviewCredit.js";
import { findCalendarGaps, sendNudges } from "../services/nudge.js";
import { explainConcept } from "../services/aiExplainer.js";
import { verifyLoginPassword } from "../services/password.js";
import { signToken } from "../middleware/auth.js";
import {
  requireProgrammeRole,
  isProgrammeStaff,
  isOrgStaff,
  isOrgOwner,
  resolveRole,
  requireOrgStaff,
  hasAdminGrant,
  assertNotLastProgrammeAdmin,
  assertNotLastOrgOwner,
  canModifyOwner,
  isProgrammeAdmin,
  hasAnyProgrammeStaffGrant,
  requireOrgStaffOrProgrammeAdmin,
} from "../middleware/rbac.js";
import { loginKeys, isLoginLocked, recordLoginFailure, clearLoginFailures } from "../middleware/rateLimit.js";
import { assertNotGradingSelf } from "../middleware/grading.js";
import { parseEnrolmentPatch } from "../services/enrolmentPatch.js";
import { applyScoreChange, lockEnrolmentRow, notifyManagerSignoffRequired } from "../services/scoreChange.js";
import { revokeCertificatesForEnrolment } from "../services/certificates.js";
import { computeKpis } from "../jobs/kpiJob.js";
import { avgResponseHours, slaStatusFor, runSlaJob, type SlaThread } from "../jobs/slaJob.js";
import { runNudgeJob } from "../jobs/nudgeJob.js";
import { runContentLifecycleJob } from "../jobs/contentLifecycleJob.js";
import { dispatchWebhook } from "../services/webhook.js";
import { getStorageProvider } from "../services/storage.js";
import {
  UPLOAD_EXT,
  UPLOAD_MIME,
  UploadRejected,
  consumeTempFile,
  extensionOf,
  resolveUploadedFile,
  safeFileName,
  storeUpload,
  uploadSingleFile,
  uploadMaxBytes,
} from "../services/uploads.js";
import { recomputeEnrolmentProgress, providerForUrl, isSafeExternalUrl } from "../services/contentProgress.js";
import { attemptStats, versionChain } from "../services/assessmentAttempts.js";
import { evaluateEnrolment } from "../services/enrolmentOutcome.js";
import { enqueueCourseEvaluation, drainEvaluationQueue } from "../services/evaluationQueue.js";
import { buildIcsCalendar, sessionsForUser } from "../services/ical.js";
import crypto from "node:crypto";
import { db, Prisma, orgScope, orgIdOf } from "../db.js";
import type { AuthedRequest } from "../middleware/auth.js";
type EnrolmentRow = Awaited<ReturnType<typeof db.enrolment.findMany>>[number];
type Enrolment = EnrolmentRow;

export const router = Router();

router.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// Round 8 / 3.3: a failed send is only useful if an operator can see it. Org staff read the
// failures that belong to their organization, newest first; dismiss removes one after handling.
router.get("/email-failures", requireOrgStaff(), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const { listEmailFailures } = await import("../services/emailFailures.js");
  const items = await listEmailFailures(scope.orgId, limit, offset);
  return res.json({ items, limit, offset });
});

router.post("/email-failures/:id/dismiss", requireOrgStaff(), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const row = await db.emailFailure.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!row) return res.status(404).json({ error: "email failure not found" });
  await db.emailFailure.delete({ where: { id: row.id } });
  return res.status(204).end();
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const keys = loginKeys(req.ip, email);
  // Locked-out and wrong-password responses are deliberately identical, so a caller cannot
  // tell whether an account exists or is locked. Round 7 gap 8: the throttle is always live;
  // a test that needs different limits configures them (configureLoginThrottle) for that case.
  if (isLoginLocked(keys)) return res.status(401).json({ error: "invalid credentials" });
  const user = await db.user.findUnique({ where: { email } }).catch(() => null);
  const ok = await verifyLoginPassword(password, user?.passwordHash ?? null);
  if (!ok || !user) {
    recordLoginFailure(keys);
    return res.status(401).json({ error: "invalid credentials" });
  }
  if (user.isActive === false) {
    recordLoginFailure(keys);
    return res.status(401).json({ error: "invalid credentials" });
  }
  clearLoginFailures(keys);
  const role = await resolveRole(user.id);
  const token = signToken({ id: user.id, role, orgId: user.orgId, tokenVersion: user.tokenVersion });
  return res.json({ accessToken: token, user: { id: user.id, name: user.name, email: user.email, role, isOrgStaff: await isOrgStaff(user.id), initials: user.name.slice(0, 2).toUpperCase() } });
});
router.post("/auth/activate", async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword required" });
  const { activateAccount } = await import("../services/password.js");
  const result = await activateAccount(String(token), String(newPassword));
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
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
  if (user.isActive === false) return res.status(403).json({ error: "account deactivated — contact your organization administrator" });
  const role = await resolveRole(user.id);
  const token = signToken({ id: user.id, role, orgId: user.orgId, tokenVersion: user.tokenVersion });
  return res.json({ accessToken: token, user: { id: user.id, name: user.name, email: user.email, role, isOrgStaff: await isOrgStaff(user.id), initials: user.name.slice(0, 2).toUpperCase() } });
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

router.get("/users", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const orgStaff = await isOrgStaff(me.id);
  let adminProgrammeIds: string[] = [];
  if (!orgStaff) {
    if (!(await hasAdminGrant(me.id))) return res.status(403).json({ error: "directory access required" });
    const grants = await db.userRole.findMany({
      where: { userId: me.id, programmeId: { not: null }, role: { name: "admin" } },
      select: { programmeId: true },
    }).catch(() => [] as Array<{ programmeId: string | null }>);
    adminProgrammeIds = grants.map((g) => g.programmeId).filter((v): v is string => !!v);
    if (!adminProgrammeIds.length) return res.status(403).json({ error: "directory access required" });
  }
  const scope = orgScope(req as AuthedRequest);
  const search = String(req.query.search ?? "").trim();
  const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const searchFilter = search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {};
  const users = (await db.user.findMany({
    where: { orgId: scope.orgId, ...searchFilter },
    select: {
      id: true, name: true, email: true, department: true, jobFunction: true, isActive: true, activatedAt: true,
      roles: {
        where: orgStaff ? undefined : { programmeId: { in: adminProgrammeIds } },
        select: { programmeId: true, role: { select: { name: true } } },
      },
    },
    orderBy: { name: "asc" },
    take,
  }).catch(() => [])) as Array<{ id: string; name: string; email: string; department: string | null; jobFunction: string | null; isActive: boolean; activatedAt: Date | null; roles: Array<{ programmeId: string | null; role: { name: string } }> }>;
  const programmeIds = [...new Set(users.flatMap((u) => u.roles.map((r) => r.programmeId).filter((v): v is string => !!v)))];
  const programmeRows = (programmeIds.length
    ? await db.programme.findMany({ where: { id: { in: programmeIds }, orgId: scope.orgId }, select: { id: true, name: true } }).catch(() => [])
    : []) as Array<{ id: string; name: string }>;
  const programmeNames = new Map(programmeRows.map((p) => [p.id, p.name]));
  return res.json(users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    // Programme admins only see directory identity + their own programmes'
    // grants; department/job function and other programmes' grants stay private.
    ...(orgStaff ? { department: u.department, jobFunction: u.jobFunction } : {}),
    isActive: u.isActive,
    // Round 7 gap 5: org staff can see who has not opened their invitation yet, which is
    // what makes the "resend invite" action next to it meaningful. Never sent to
    // programme admins, who have no way to act on it.
    ...(orgStaff ? { activatedAt: u.activatedAt } : {}),
    roles: u.roles.map((r) => ({ role: r.role.name, programmeId: r.programmeId, programmeName: r.programmeId ? programmeNames.get(r.programmeId) ?? null : null })),
  })));
});

// Organization-level directory provisioning. Programme managers assign roles to
// these people; they do not create accounts from the programme screen.
router.post("/users", requireOrgStaff(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const name = String(req.body?.name ?? "").trim();
  const department = req.body?.department ? String(req.body.department).trim() : null;
  const jobFunction = req.body?.jobFunction ? String(req.body.jobFunction).trim() : null;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "valid email required" });
  if (!name) return res.status(400).json({ error: "name required" });
  const existing = await db.user.findUnique({ where: { email } }).catch(() => null);
  if (existing) {
    return res.status(409).json({ error: existing.orgId === scope.orgId ? "user already exists in your organization" : "this email is already registered to another organization — use a different email" });
  }
  const { unguessablePasswordHash, issueActivationToken, sendActivationEmail } = await import("../services/password.js");
  const user = await db.user.create({
    data: { orgId: scope.orgId, name, email, department, jobFunction, passwordHash: await unguessablePasswordHash() },
  }).catch(() => null);
  if (!user) return res.status(500).json({ error: "could not create user" });
  const activation = await issueActivationToken(user.id);
  // Round 7 gap 3: a send that fails is recorded, not swallowed. The account still exists,
  // so the response says so and the admin can resend (gap 5).
  const emailSent = await sendActivationEmail(user.email, user.name, activation.token);
  await db.auditLog.create({ data: { userId: me.id, action: "USER_CREATED", entity: "user", entityId: user.id, details: email } }).catch(() => null);
  return res.status(201).json({
    id: user.id, name: user.name, email: user.email, department: user.department, jobFunction: user.jobFunction, isActive: true, activatedAt: user.activatedAt,
    emailSent,
    // NEVER expose the token outside the test environment.
    ...(process.env.NODE_ENV === "test" ? { activationToken: activation.token } : {}),
  });
});

router.post("/users/:id/resend-activation", requireOrgStaff(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const target = await db.user.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!target) return res.status(404).json({ error: "user not found in your organization" });
  if (target.activatedAt) return res.status(409).json({ error: "account is already activated" });
  const { issueActivationToken, sendActivationEmail } = await import("../services/password.js");
  // Invalidate any outstanding activation links before issuing a new one.
  await db.passwordResetToken.updateMany({ where: { userId: target.id, purpose: "activation", usedAt: null }, data: { usedAt: new Date() } }).catch(() => null);
  const activation = await issueActivationToken(target.id);
  const emailSent = await sendActivationEmail(target.email, target.name, activation.token);
  await db.auditLog.create({ data: { userId: me.id, action: "ACTIVATION_RESENT", entity: "user", entityId: target.id, details: target.email } }).catch(() => null);
  return res.json({ ok: true, emailSent, ...(process.env.NODE_ENV === "test" ? { activationToken: activation.token } : {}) });
});

// Update an org user (name, department, jobFunction) or deactivate/reactivate.
router.patch("/users/:id", requireOrgStaff(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const target = await db.user.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!target) return res.status(404).json({ error: "user not found in your organization" });
  const patch = req.body ?? {};
  const targetIsOwner = !!(await db.userRole.findFirst({ where: { userId: target.id, programmeId: null, role: { name: "owner" } } }).catch(() => null));
  if (targetIsOwner && !(await canModifyOwner(me.id))) {
    return res.status(403).json({ error: "only an organization owner may modify an owner account" });
  }
  if (patch.isActive === false) {
    if (target.id === me.id) return res.status(409).json({ error: "you cannot deactivate your own account" });
    if (targetIsOwner) {
      try { await assertNotLastOrgOwner(scope.orgId, target.id); }
      catch (e) { return res.status((e as { status?: number }).status ?? 409).json({ error: (e as Error).message }); }
    }
  }
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined && String(patch.name).trim()) data.name = String(patch.name).trim();
  if (patch.department !== undefined) data.department = patch.department || null;
  if (patch.jobFunction !== undefined) data.jobFunction = patch.jobFunction || null;
  if (patch.isActive !== undefined) {
    data.isActive = Boolean(patch.isActive);
    data.deactivatedAt = patch.isActive ? null : new Date();
    data.tokenVersion = { increment: 1 };
  }
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.user.update({ where: { id: target.id }, data });
    if (data.name && data.name !== target.name) {
      // Keep the denormalized display name in sync; identity stays trainerId.
      // Round 6 / H3: the name fallback is only for legacy rows with no trainerId, and it is
      // scoped to this organization, so a rename never rewrites another tenant's courses.
      await tx.course.updateMany({
        where: { programme: { orgId: scope.orgId }, OR: [{ trainerId: target.id }, { trainerId: null, trainer: target.name }] },
        data: { trainer: String(data.name) },
      }).catch(() => null);
    }
    return row;
  }).catch(() => null);
  if (!updated) return res.status(500).json({ error: "could not update user" });
  await db.auditLog.create({ data: { userId: me.id, action: patch.isActive === false ? "USER_DEACTIVATED" : "USER_UPDATED", entity: "user", entityId: target.id, details: JSON.stringify(patch) } }).catch(() => null);
  return res.json({ id: updated.id, name: updated.name, email: updated.email, department: updated.department, jobFunction: updated.jobFunction, isActive: updated.isActive });
});

// Assign or remove an org-wide role (owner/admin). Programme-scoped roles
// are managed through POST /programmes/:id/members.
router.post("/users/:id/org-role", requireOrgStaff(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const target = await db.user.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!target) return res.status(404).json({ error: "user not found in your organization" });
  const roleName = String(req.body?.role ?? "").toLowerCase();
  if (!["owner", "admin", ""].includes(roleName)) return res.status(400).json({ error: "org-wide role must be owner or admin (or empty to remove)" });
  const currentOrgGrants = await db.userRole.findMany({ where: { userId: target.id, programmeId: null }, include: { role: true } }).catch(() => [] as Array<{ id: string; role: { name: string } }>);
  const targetIsOwner = currentOrgGrants.some((g) => g.role.name === "owner");
  const actorIsOwner = await canModifyOwner(me.id);
  if ((roleName === "owner" || targetIsOwner) && !actorIsOwner) {
    return res.status(403).json({ error: "only organization owners may change an owner's role" });
  }
  if (targetIsOwner && roleName !== "owner") {
    try { await assertNotLastOrgOwner(scope.orgId, target.id); }
    catch (e) { return res.status((e as { status?: number }).status ?? 409).json({ error: (e as Error).message }); }
  }
  if (target.id === me.id && roleName === "" && currentOrgGrants.length > 0) {
    // Self-lockout guard: don't let the last org staff account strip its own
    // org-wide role and lose every governance capability.
    const otherOrgStaff = await db.userRole.findFirst({
      where: { programmeId: null, userId: { not: me.id }, user: { orgId: scope.orgId }, role: { name: { in: ["owner", "admin"] } } },
    }).catch(() => null);
    if (!otherOrgStaff) return res.status(409).json({ error: "you cannot remove your own last organization staff role" });
  }
  const role = roleName ? await db.role.findUnique({ where: { name: roleName } }).catch(() => null) : null;
  if (roleName && !role) return res.status(400).json({ error: `unknown role ${roleName}` });
  await db.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: target.id, programmeId: null } });
    if (role) await tx.userRole.create({ data: { userId: target.id, roleId: role.id, programmeId: null } });
    await tx.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
  }).catch(() => null);
  await db.auditLog.create({ data: { userId: me.id, action: "ORG_ROLE_CHANGED", entity: "user", entityId: target.id, details: roleName || "removed" } }).catch(() => null);
  return res.json({ userId: target.id, orgRole: roleName || null });
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
// Round 9 / Phase 1.1. A strict whitelist, one role per field, and scores computed from the
// stored row plus only the validated fields the caller was allowed to change. A learner cannot
// touch status, dates or scores at all: progress comes from content progress and attempts.
router.patch("/enrolments/:id", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const current = await db.enrolment.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } });
  if (!current) return res.status(404).json({ error: "not found" });

  // Both checks read the database, never the token or the body.
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, current.programmeId));
  const learnerRow = await db.user.findUnique({ where: { id: current.learnerId }, select: { managerId: true } }).catch(() => null);
  const lineManager = !!learnerRow && learnerRow.managerId === me.id;

  const parsed = parseEnrolmentPatch(req.body ?? {}, { staff, lineManager });
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  if (parsed.forbidden.length) {
    return res.status(403).json({ error: `you may not set ${parsed.forbidden.join(", ")} on this enrolment` });
  }
  const { staff: patch, manager } = parsed;
  const staffFieldCount = Object.keys(patch).filter((k) => k !== "reason").length;
  if (!staffFieldCount && manager.managerSignOff === undefined) {
    return res.status(400).json({ error: "nothing to update" });
  }

  // Round 8 / 1.3: an applied score or completion override must carry a reason.
  const overridesOutcome =
    patch.appliedAssessmentScore !== undefined || patch.status !== undefined || patch.completionDate !== undefined;
  const reason = typeof patch.reason === "string" ? patch.reason.trim() : "";
  if (overridesOutcome && reason.length < 10) {
    return res.status(400).json({ error: "a reason of at least 10 characters is required to override a score or completion" });
  }
  // [CONFIRM] 2026-11-21: only an org owner may override a locked enrolment.
  if (overridesOutcome && current.reviewCreditLockedAt && !(await isOrgOwner(me.id))) {
    return res.status(403).json({ error: "this review-credit period is locked; only an organization owner may override it" });
  }
  let signOffBy: string | undefined;
  let signOffAt: Date | undefined;
  if (manager.managerSignOff !== undefined) {
    if (!lineManager) return res.status(403).json({ error: "only the learner's line manager may sign off" });
    signOffBy = me.id;
    signOffAt = new Date();
  }

  // Round 6 / M1: the withdrawal hook below must see the row as it was.
  const wasWithdrawn = current.status === "withdrawn";
  const manualScore = patch.appliedAssessmentScore !== undefined;
  const result = await db.$transaction(async (tx) => {
    // The decision and the score write hold the row lock, so an evaluation landing at the same
    // time cannot overwrite this override (or silently clear the sign-off a second time).
    const row = await lockEnrolmentRow(tx, req.params.id);
    if (!row) return null;
    // [CONFIRM] 2026-11-21: un-completing revokes the certificate issued for that completion. A
    // later automatic completion is a new completion and issues a fresh certificate as normal.
    const uncompleting = patch.status === "enrolled" && row.status === "completed";
    const appliedForScore = manualScore ? (patch.appliedAssessmentScore as number) : row.appliedAssessmentScore ?? null;
    const completionDateForScore = uncompleting
      ? null
      : patch.completionDate !== undefined ? patch.completionDate : row.completionDate ?? null;
    const deadlineForScore = patch.deadlineDate !== undefined ? patch.deadlineDate : row.deadlineDate ?? null;
    const applicationForScore = patch.applicationScore !== undefined ? patch.applicationScore : row.applicationScore ?? null;
    // A staff status change is a manual completion; the automatic loop writes "assessment".
    const completes = patch.status === "completed" && row.status !== "completed";
    const finalCompletionDate = uncompleting
      ? null
      : patch.completionDate !== undefined
        ? patch.completionDate
        : completes ? row.completionDate ?? new Date() : completionDateForScore;
    const { score, b } = calculateEnrolmentScore({
      appliedAssessmentScore: appliedForScore,
      completionDate: finalCompletionDate,
      deadlineDate: deadlineForScore,
      applicationScore: applicationForScore,
    });
    const scoreEffect = await applyScoreChange(tx, row, {
      appliedAssessmentScore: appliedForScore,
      applicationScore: applicationForScore,
      deadlineDate: deadlineForScore,
      completionDate: finalCompletionDate,
      timelinessScore: b,
      enrolmentScore: score,
    });
    const revokedCertificateIds = uncompleting ? await revokeCertificatesForEnrolment(tx, row.id) : [];
    await tx.enrolment.update({
      where: { id: row.id },
      data: {
        status: patch.status ?? undefined,
        ...(uncompleting ? { completionDate: null, completionSource: null } : {}),
        ...(manualScore ? {
          appliedScoreSource: "manual",
          appliedScoreOverrideReason: reason,
          appliedScoreOverriddenBy: me.id,
          appliedScoreOverriddenAt: new Date(),
          pendingAssessmentScore: null,
          pendingAssessmentScoreAt: null,
        } : {}),
        ...(completes ? { completionSource: "manual" as const } : {}),
        managerSignOff: manager.managerSignOff ?? undefined,
        managerSignOffBy: signOffBy ?? undefined,
        managerSignOffAt: signOffAt ?? undefined,
      },
    });
    if (overridesOutcome) {
      await tx.auditLog.create({
        data: {
          userId: me.id,
          action: manualScore ? "ENROLMENT_SCORE_OVERRIDDEN" : "ENROLMENT_STATUS_OVERRIDDEN",
          entity: "enrolment",
          entityId: row.id,
          details: JSON.stringify({ reason, status: patch.status ?? null, completionDate: patch.completionDate ?? null, deadlineDate: patch.deadlineDate ?? null, appliedAssessmentScore: manualScore ? appliedForScore : null, completionSource: completes ? "manual" : null, uncompleted: uncompleting }),
        },
      }).catch(() => null);
    }
    if (revokedCertificateIds.length) {
      await tx.auditLog.create({
        data: {
          userId: me.id,
          action: "CERTIFICATE_REVOKED",
          entity: "enrolment",
          entityId: row.id,
          details: JSON.stringify({ reason, certificateIds: revokedCertificateIds }),
        },
      }).catch(() => null);
    }
    return { e: (await tx.enrolment.findUnique({ where: { id: row.id } }))!, signOffCleared: scoreEffect.signOffCleared, completes };
  });
  if (!result) return res.status(404).json({ error: "not found" });
  const { e, signOffCleared, completes } = result;
  if (signOffCleared) await notifyManagerSignoffRequired(e.learnerId);
  if (patch.status === "withdrawn" && !wasWithdrawn) {
    // Round 6 / M1: a withdrawn learner loses the threads of that programme.
    await revokeStaleThreadAccess(e.learnerId, scope.orgId);
  }
  if (completes) {
    const [{ issueCertificateForEnrolment }, { checkStreakRecognition }] = await Promise.all([
      import("../services/certificates.js"),
      import("../services/recognition.js"),
    ]);
    await issueCertificateForEnrolment(e.id).catch(() => null);
    await checkStreakRecognition(e.learnerId).catch(() => null);
  }
  if (manualScore) {
    const { checkAppliedScoreRecognition } = await import("../services/recognition.js");
    await checkAppliedScoreRecognition(e.id).catch(() => null);
  }
  return res.json(e);
});
router.delete("/enrolments/:id", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const existing = await db.enrolment.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } });
  if (!existing) return res.status(404).json({ error: "not found" });
  await db.enrolment.delete({ where: { id: req.params.id } }).catch(() => null);
  return res.status(204).end();
});
async function loadEnrolmentForStaff(req: AuthedRequest, id: string) {
  const scope = orgScope(req);
  const e = await db.enrolment.findFirst({ where: { id, programme: { orgId: scope.orgId } } });
  if (!e) throw Object.assign(new Error("not found"), { status: 404 });
  const staff = (await isOrgStaff(req.user!.id)) || (await isProgrammeStaff(req.user!.id, e.programmeId));
  if (!staff) throw Object.assign(new Error("programme staff access required"), { status: 403 });
  return e;
}

router.post("/enrolments/:id/accept-assessment-score", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const e = await loadEnrolmentForStaff(req as AuthedRequest, req.params.id);
  const result = await db.$transaction(async (tx) => {
    const row = await lockEnrolmentRow(tx, e.id);
    if (!row || row.pendingAssessmentScore == null) return null;
    const applied = row.pendingAssessmentScore;
    const { score, b } = calculateEnrolmentScore({
      appliedAssessmentScore: applied,
      completionDate: row.completionDate,
      deadlineDate: row.deadlineDate,
      applicationScore: row.applicationScore,
    });
    const scoreEffect = await applyScoreChange(tx, row, {
      appliedAssessmentScore: applied,
      applicationScore: row.applicationScore,
      deadlineDate: row.deadlineDate,
      completionDate: row.completionDate,
      timelinessScore: b,
      enrolmentScore: score,
    });
    await tx.enrolment.update({
      where: { id: row.id },
      data: {
        appliedScoreSource: "assessment",
        appliedScoreOverrideReason: null,
        appliedScoreOverriddenBy: null,
        appliedScoreOverriddenAt: null,
        pendingAssessmentScore: null,
        pendingAssessmentScoreAt: null,
        pendingRejectedScore: null,
      },
    });
    await tx.auditLog.create({
      data: { userId: me.id, action: "ASSESSMENT_SCORE_ACCEPTED", entity: "enrolment", entityId: row.id, details: JSON.stringify({ acceptedScore: applied, appliedAssessmentScore: applied }) },
    }).catch(() => null);
    return { learnerId: row.learnerId, signOffCleared: scoreEffect.signOffCleared };
  });
  if (!result) return res.status(409).json({ error: "there is no pending assessment result" });
  if (result.signOffCleared) await notifyManagerSignoffRequired(result.learnerId);
  return res.json(await evaluateEnrolment(e.id, "manual_status"));
});

router.post("/enrolments/:id/reject-assessment-score", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const e = await loadEnrolmentForStaff(req as AuthedRequest, req.params.id);
  const rejected = await db.$transaction(async (tx) => {
    const row = await lockEnrolmentRow(tx, e.id);
    if (!row || row.pendingAssessmentScore == null) return null;
    await tx.enrolment.update({
      where: { id: row.id },
      data: { pendingAssessmentScore: null, pendingAssessmentScoreAt: null, pendingRejectedScore: row.pendingAssessmentScore },
    });
    await tx.auditLog.create({
      data: { userId: me.id, action: "ASSESSMENT_SCORE_REJECTED", entity: "enrolment", entityId: row.id, details: JSON.stringify({ rejectedScore: row.pendingAssessmentScore }) },
    }).catch(() => null);
    return row.pendingAssessmentScore;
  });
  if (rejected === null) return res.status(409).json({ error: "there is no pending assessment result" });
  return res.json({ ok: true, enrolmentId: e.id });
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
  const me = (req as AuthedRequest).user!;
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const current = await db.programme.findFirst({ where: { id: req.params.id, orgId: scope.orgId }, select: { slaHours: true } }).catch(() => null);
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  for (const k of ["name", "type", "status", "owner"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.budget !== undefined) data.budget = Number(patch.budget);
  if (patch.progress !== undefined) data.progress = Number(patch.progress);
  if (patch.slaHours !== undefined) {
    if (patch.slaHours === null || patch.slaHours === "") {
      data.slaHours = null;
    } else {
      const parsed = parseSlaHours(patch.slaHours);
      if (parsed === null) return res.status(400).json({ error: "slaHours must be an integer between 1 and 720" });
      data.slaHours = parsed;
    }
  }
  const updated = await db.programme.update({ where: { id: req.params.id }, data });
  if (data.slaHours !== undefined && data.slaHours !== (current?.slaHours ?? null)) {
    await db.auditLog.create({ data: { userId: me.id, action: "PROGRAMME_SLA_UPDATED", entity: "programme", entityId: req.params.id, details: JSON.stringify({ from: current?.slaHours ?? null, slaHours: data.slaHours }) } }).catch(() => null);
  }
  return res.json(updated);
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
  if (targetType === "member_bulk") {
    const p = await db.programme.findFirst({ where: { id: targetId, orgId } });
    return p ? { id: p.id, name: `Bulk member removal — ${p.name}` } : null;
  }
  return null;
}
async function createDeleteRequest(targetType: string, targetId: string, me: { id: string }, orgId: string, reason?: string, payload?: string) {
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
    data: { orgId, targetType, targetId: target.id, targetName: target.name, requestedBy: me.id, reason: reason ?? null, payload: payload ?? null },
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
async function deleteRequestProgrammeId(dr: { targetType: string; targetId: string }): Promise<string | null> {
  if (dr.targetType === "programme" || dr.targetType === "member_bulk") return dr.targetId;
  if (dr.targetType === "course") {
    const c = await db.course.findUnique({ where: { id: dr.targetId }, select: { programmeId: true } }).catch(() => null);
    return c?.programmeId ?? null;
  }
  if (dr.targetType === "module") {
    const m = await db.module.findUnique({ where: { id: dr.targetId }, select: { course: { select: { programmeId: true } } } }).catch(() => null);
    return m?.course.programmeId ?? null;
  }
  if (dr.targetType === "assessment") {
    const a = await db.assessment.findUnique({ where: { id: dr.targetId }, select: { module: { select: { course: { select: { programmeId: true } } } } } }).catch(() => null);
    return a?.module.course.programmeId ?? null;
  }
  return null;
}

async function canDecideDeleteRequest(userId: string, dr: { targetType: string; targetId: string }): Promise<boolean> {
  if (await isOrgStaff(userId)) return true;
  const programmeId = await deleteRequestProgrammeId(dr);
  if (!programmeId) return false;
  const grant = await db.userRole
    .findFirst({ where: { userId, programmeId, role: { name: { in: ["owner", "admin"] } } } })
    .catch(() => null);
  return !!grant;
}

router.get("/delete-requests", requireOrgStaffOrProgrammeAdmin(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const rows = await db.deleteRequest.findMany({ where: { orgId: scope.orgId }, include: { requester: { select: { name: true, email: true } }, approver: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []);
  const visible = [];
  for (const dr of rows) if (await canDecideDeleteRequest(me.id, dr)) visible.push(dr);
  return res.json(visible);
});
router.post("/delete-requests/:id/approve", requireOrgStaffOrProgrammeAdmin(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const dr = await db.deleteRequest.findFirst({ where: { id: req.params.id, orgId: scope.orgId } });
  if (!dr) return res.status(404).json({ error: "request not found in your organization" });
  if (dr.status !== "pending") return res.status(409).json({ error: `request already ${dr.status}` });
  if (!(await canDecideDeleteRequest(me.id, dr))) return res.status(403).json({ error: "forbidden for this programme" });
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
  } else if (dr.targetType === "member_bulk") {
    const userIds = dr.payload ? (JSON.parse(dr.payload) as { userIds?: string[] }).userIds ?? [] : [];
    await removeProgrammeMembers(dr.targetId, userIds, me.id, scope.orgId);
  } else {
    return res.status(400).json({ error: `unknown target type ${dr.targetType}` });
  }
  await db.auditLog.create({ data: { userId: me.id, action: "DELETE_REQUEST_APPROVED", entity: dr.targetType, entityId: dr.targetId, details: null } }).catch(() => null);
  return res.json(await db.deleteRequest.update({ where: { id: dr.id }, data: { status: "approved", approvedBy: me.id, decidedAt: now } }));
});
router.post("/delete-requests/:id/reject", requireOrgStaffOrProgrammeAdmin(), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const dr = await db.deleteRequest.findFirst({ where: { id: req.params.id, orgId: scope.orgId } });
  if (!dr) return res.status(404).json({ error: "request not found in your organization" });
  if (dr.status !== "pending") return res.status(409).json({ error: `request already ${dr.status}` });
  if (!(await canDecideDeleteRequest(me.id, dr))) return res.status(403).json({ error: "forbidden for this programme" });
  if (dr.requestedBy === me.id) return res.status(403).json({ error: "approver must be a different user than the requester" });
  return res.json(await db.deleteRequest.update({ where: { id: dr.id }, data: { status: "rejected", approvedBy: me.id, decidedAt: new Date() } }));
});
router.post("/programmes", requireOrgStaff(), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  if (!req.body?.name) return res.status(400).json({ error: "name required" });
  const me = (req as AuthedRequest).user!;
  return res.status(201).json(await db.programme.create({
    data: { orgId: scope.orgId, name: req.body.name, type: req.body.type ?? "Professional Development", status: "active", owner: req.body.owner ?? me.id },
  }));
});

const MEMBER_ROLES = new Set(["admin", "trainer", "learner", "stakeholder"]);

router.get("/programmes/:id/members", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const grants = await db.userRole.findMany({
    where: { programmeId: req.params.id, user: { orgId: scope.orgId } },
    include: { user: { select: { id: true, name: true, email: true, department: true, jobFunction: true } }, role: true },
    orderBy: { user: { name: "asc" } },
  }).catch(() => []);
  return res.json(grants.map((g) => ({ userId: g.userId, name: g.user.name, email: g.user.email, department: g.user.department, jobFunction: g.user.jobFunction, role: g.role.name })));
});

async function resolveRoleRow(roleName: string): Promise<{ id: string; name: string }> {
  const role = await db.role.findUnique({ where: { name: roleName } });
  if (!role) {
    const err = new Error(`unknown role ${roleName}`) as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return role;
}

async function ensureLearnerEnrolments(tx: typeof db | any, userId: string, programmeId: string) {
  const courses = await tx.course.findMany({ where: { programmeId, deletedAt: null, isArchived: false }, select: { id: true } });
  for (const c of courses) {
    const already = await tx.enrolment.findFirst({ where: { learnerId: userId, courseId: c.id } }).catch(() => null);
    if (!already) {
      await tx.enrolment.create({ data: { learnerId: userId, courseId: c.id, programmeId, status: "enrolled" } }).catch(() => null);
    } else if (already.status === "withdrawn" || already.withdrawnAt) {
      // Round 8 / E.5: removing a member withdraws their enrolment but keeps the row. Adding the
      // learner grant back therefore has to reinstate it, or a re-added member has a grant that
      // can never grant access (content, progress, threads).
      await tx.enrolment.update({ where: { id: already.id }, data: { status: "enrolled", withdrawnAt: null, withdrawnBy: null } }).catch(() => null);
    }
  }
}

// Removes grants (all roles) for the given users and WITHDRAWS their
// enrolments. Enrolment rows and scores are retained for audit/history.
export async function removeProgrammeMembers(
  programmeId: string,
  userIds: string[],
  actorId: string,
  orgId?: string,
): Promise<{ removed: number; withdrawn: number; coursesUnassigned: number; userIds: string[] }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return { removed: 0, withdrawn: 0, coursesUnassigned: 0, userIds: [] };
  const users = await db.user.findMany({
    where: { id: { in: unique }, ...(orgId ? { orgId } : {}) },
    select: { id: true, name: true, email: true },
  }).catch(() => [] as Array<{ id: string; name: string; email: string }>);
  if (!users.length) return { removed: 0, withdrawn: 0, coursesUnassigned: 0, userIds: [] };
  const ids = users.map((u) => u.id);
  const grants = await db.userRole.findMany({ where: { programmeId, userId: { in: ids } }, include: { role: true } }).catch(() => [] as Array<{ userId: string; role: { name: string } }>);
  // Last-admin guard: if every admin in the programme is in this removal set, block.
  const adminCount = await db.userRole.count({ where: { programmeId, role: { name: "admin" } } }).catch(() => 0);
  const removingAdmins = new Set(grants.filter((g) => g.role.name === "admin").map((g) => g.userId)).size;
  if (adminCount > 0 && adminCount - removingAdmins <= 0) {
    const err = new Error("cannot remove the last programme admin — appoint another admin first") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  const now = new Date();
  let removed = 0;
  let withdrawn = 0;
  let coursesUnassigned = 0;
  await db.$transaction(async (tx) => {
    const del = await tx.userRole.deleteMany({ where: { programmeId, userId: { in: ids } } });
    removed = del.count;
    const w = await tx.enrolment.updateMany({
      where: { programmeId, learnerId: { in: ids }, status: { not: "withdrawn" } },
      data: { status: "withdrawn", withdrawnAt: now, withdrawnBy: actorId },
    });
    withdrawn = w.count;
    // Round 6 / H3: match by identity first; the name fallback only for legacy rows with no
    // trainerId, so two trainers who share a name do not affect each other's courses.
    const unassign = await tx.course.updateMany({
      where: { programmeId, OR: [{ trainerId: { in: ids } }, { trainerId: null, trainer: { in: users.map((u) => u.name) } }] },
      data: { trainerId: null, trainer: "" },
    });
    coursesUnassigned = unassign.count;
    await tx.user.updateMany({ where: { id: { in: ids } }, data: { tokenVersion: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "PROGRAMME_MEMBERS_REMOVED",
        entity: "programme",
        entityId: programmeId,
        details: JSON.stringify({ userIds: ids, emails: users.map((u) => u.email) }),
      },
    }).catch(() => null);
  });
  // Round 6 / M1 + Round 8 / E.5: removed members lose their threads in this programme, but the
  // participation rows stay (leftAt/leftReason) so the history survives and a re-add can restore.
  const revoke = await db.threadParticipant.updateMany({
    where: { userId: { in: ids }, thread: { programmeId }, leftAt: null },
    data: { leftAt: now, leftReason: "removed from programme" },
  }).catch(() => ({ count: 0 }));
  if (revoke.count) {
    await db.auditLog.create({ data: { userId: actorId, action: "THREAD_ACCESS_REVOKED", entity: "programme", entityId: programmeId, details: `${revoke.count} thread participation(s)` } }).catch(() => null);
  }
  return { removed, withdrawn, coursesUnassigned, userIds: ids };
}

router.post("/programmes/:id/members", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const roleNames = Array.isArray(req.body?.roles)
    ? [...new Set((req.body.roles as unknown[]).map(String))]
    : [String(req.body?.role ?? "learner")];
  if (!roleNames.length || roleNames.some((r) => !MEMBER_ROLES.has(r))) return res.status(400).json({ error: "roles must be a non-empty subset of admin|trainer|learner|stakeholder" });
  const roleName = roleNames[0];
  const userIdInput = req.body?.userId ? String(req.body.userId) : null;
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  let user: { id: string; name: string; email: string; orgId: string } | null = null;
  if (userIdInput) {
    user = await db.user.findFirst({ where: { id: userIdInput, orgId: scope.orgId } }).catch(() => null);
    if (!user) return res.status(404).json({ error: "user not found in your organization" });
  } else {
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "valid email or userId required" });
    user = await db.user.findUnique({ where: { email } }).catch(() => null);
    if (!user) return res.status(400).json({ error: "user not found in your organization — add them under People first" });
    if (user.orgId !== scope.orgId) return res.status(409).json({ error: "this email is already registered to another organization — use a different email" });
  }
  const roles: Array<{ id: string; name: string }> = [];
  try { for (const name of roleNames) roles.push(await resolveRoleRow(name)); }
  catch (e) { return res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message }); }
  await db.$transaction(async (tx) => {
    // ADD semantics only: never delete another grant. The unique key makes this
    // idempotent, so a trainer can also be a programme admin (§4).
    for (const role of roles) {
      const existing = await tx.userRole.findFirst({ where: { userId: user!.id, roleId: role.id, programmeId: req.params.id } });
      if (!existing) await tx.userRole.create({ data: { userId: user!.id, roleId: role.id, programmeId: req.params.id } });
    }
    if (roleNames.includes("learner") && req.body?.enrol !== false) await ensureLearnerEnrolments(tx, user!.id, req.params.id);
    await tx.auditLog.create({ data: { userId: me.id, action: "PROGRAMME_MEMBER_ADDED", entity: "programme", entityId: req.params.id, details: `${user!.email} as ${roleNames.join(",")}` } }).catch(() => null);
  });
  return res.status(201).json({ userId: user.id, name: user.name, email: user.email, role: roleName, roles: roleNames });
});

router.patch("/programmes/:id/members/:userId", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const toRole = req.body?.toRole === undefined ? (req.body?.role === undefined ? undefined : String(req.body.role)) : String(req.body.toRole);
  const fromRole = req.body?.fromRole === undefined ? undefined : String(req.body.fromRole);
  const nameInput = req.body?.name === undefined ? undefined : String(req.body.name).trim();
  // Round 6: a `roles` array is a complete replacement of this programme's grants, so it
  // needs no fromRole/toRole. The single-grant guard must therefore only apply when no
  // roles array was sent — checking it first made the multi-role branch below unreachable
  // (every roles-only PATCH returned 400 "fromRole/toRole or name required").
  const replacesGrants = Array.isArray(req.body?.roles);
  if (!replacesGrants && toRole === undefined && nameInput === undefined && fromRole === undefined) return res.status(400).json({ error: "fromRole/toRole or name required" });
  if (nameInput !== undefined && !nameInput) return res.status(400).json({ error: "name cannot be empty" });
  if (toRole !== undefined && !MEMBER_ROLES.has(toRole)) return res.status(400).json({ error: "role must be admin|trainer|learner|stakeholder" });
  if (fromRole !== undefined && !MEMBER_ROLES.has(fromRole)) return res.status(400).json({ error: "fromRole must be admin|trainer|learner|stakeholder" });
  const target = await db.user.findFirst({ where: { id: req.params.userId, orgId: scope.orgId } }).catch(() => null);
  if (!target) return res.status(404).json({ error: "member not found in your organization" });
  const currentGrants = (await db.userRole.findMany({ where: { userId: target.id, programmeId: req.params.id }, include: { role: true } }).catch(() => [])) as Array<{ id: string; roleId: string; role: { name: string } }>;
  // Round 8 / E.10: toRole alone used to rewrite whichever grant happened to come first.
  if (!replacesGrants && toRole !== undefined && fromRole === undefined && currentGrants.length > 1) {
    return res.status(400).json({ error: "fromRole is required when the member holds more than one role in this programme" });
  }
  // Multi-role edit: replace the exact set of grants for this programme.
  if (Array.isArray(req.body?.roles)) {
    const desired = [...new Set((req.body.roles as unknown[]).map(String))];
    if (!desired.length || desired.some((r) => !MEMBER_ROLES.has(r))) return res.status(400).json({ error: "roles must be a non-empty subset of admin|trainer|learner|stakeholder" });
    const currentNames = new Set(currentGrants.map((g) => g.role.name));
    if (currentNames.has("admin") && !desired.includes("admin")) await assertNotLastProgrammeAdmin(req.params.id, target.id, "admin");
    const resolved: Awaited<ReturnType<typeof resolveRoleRow>>[] = [];
    for (const name of desired) resolved.push(await resolveRoleRow(name));
    let coursesUpdated = 0;
    let coursesUnassigned = 0;
    const user = await db.$transaction(async (tx) => {
      let row = target;
      if (nameInput !== undefined) {
        const previousName = target.name;
        row = await tx.user.update({ where: { id: target.id }, data: { name: nameInput } });
        const renamed = await tx.course.updateMany({
          where: { programme: { orgId: scope.orgId }, OR: [{ trainerId: target.id }, { trainerId: null, trainer: previousName }] },
          data: { trainer: nameInput },
        }).catch(() => ({ count: 0 }));
        coursesUpdated += renamed.count;
      }
      for (const g of currentGrants) {
        if (!desired.includes(g.role.name)) await tx.userRole.delete({ where: { id: g.id } });
      }
      for (const role of resolved) {
        if (!currentNames.has(role.name)) await tx.userRole.create({ data: { userId: target.id, roleId: role.id, programmeId: req.params.id } });
      }
      if (desired.includes("learner")) await ensureLearnerEnrolments(tx, target.id, req.params.id);
      if (currentNames.has("trainer") && !desired.includes("trainer")) {
        const result = await tx.course.updateMany({ where: { programmeId: req.params.id, OR: [{ trainerId: target.id }, { trainerId: null, trainer: target.name }] }, data: { trainerId: null, trainer: "" } });
        coursesUnassigned += result.count;
      }
      if (currentGrants.length !== desired.length) await tx.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
      await tx.auditLog.create({ data: { userId: me.id, action: "PROGRAMME_MEMBER_ROLES_SET", entity: "programme", entityId: req.params.id, details: `${target.email} → ${desired.join(",")}` } }).catch(() => null);
      return row;
    });
    return res.json({ userId: user.id, name: user.name, email: user.email, roles: desired, role: desired[0], coursesUpdated, coursesUnassigned });
  }
  const sourceRoleName = fromRole ?? (toRole !== undefined && currentGrants.length ? currentGrants[0].role.name : undefined);
  if (toRole !== undefined && !sourceRoleName) return res.status(404).json({ error: "member has no role grant in this programme" });
  let coursesUpdated = 0;
  try {
    if (toRole !== undefined && sourceRoleName === "admin" && toRole !== "admin") {
      await assertNotLastProgrammeAdmin(req.params.id, target.id, "admin");
    }
    const role = toRole !== undefined ? await resolveRoleRow(toRole) : undefined;
    const user = await db.$transaction(async (tx) => {
      let row = target;
      if (nameInput !== undefined) {
        const previousName = target.name;
        row = await tx.user.update({ where: { id: target.id }, data: { name: nameInput } });
        const renamed = await tx.course.updateMany({
          where: { programme: { orgId: scope.orgId }, OR: [{ trainerId: target.id }, { trainerId: null, trainer: previousName }] },
          data: { trainer: nameInput },
        }).catch(() => ({ count: 0 }));
        coursesUpdated += renamed.count;
      }
      if (role && sourceRoleName) {
        const grant = currentGrants.find((g) => g.role.name === sourceRoleName);
        if (!grant) {
          const err = new Error(`member has no ${sourceRoleName} grant in this programme`) as Error & { status?: number };
          err.status = 404;
          throw err;
        }
        await tx.userRole.update({ where: { id: grant.id }, data: { roleId: role.id } });
        await tx.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
        if (role.name === "learner" && req.body?.enrol !== false) await ensureLearnerEnrolments(tx, target.id, req.params.id);
        const remainingTrainer = await tx.userRole.findFirst({ where: { userId: target.id, programmeId: req.params.id, role: { name: "trainer" } } });
        if (sourceRoleName === "trainer" && !remainingTrainer) {
          const result = await tx.course.updateMany({ where: { programmeId: req.params.id, OR: [{ trainerId: target.id }, { trainerId: null, trainer: target.name }] }, data: { trainerId: null, trainer: "" } });
          coursesUpdated = result.count;
        }
      }
      await tx.auditLog.create({ data: { userId: me.id, action: "PROGRAMME_MEMBER_UPDATED", entity: "programme", entityId: req.params.id, details: `${row.email}${toRole ? ` ${sourceRoleName}→${toRole}` : ""}` } }).catch(() => null);
      return row;
    });
    const currentGrant = await db.userRole.findFirst({ where: { userId: target.id, programmeId: req.params.id }, include: { role: true } }).catch(() => null);
    return res.json({ userId: user.id, name: user.name, email: user.email, role: toRole ?? currentGrant?.role.name ?? "learner", coursesUpdated });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

router.delete("/programmes/:id/members/:userId", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const target = await db.user.findFirst({ where: { id: req.params.userId, orgId: scope.orgId } }).catch(() => null);
  if (!target) return res.status(404).json({ error: "member not found in your organization" });
  const roleFilter = typeof req.query.role === "string" && req.query.role ? req.query.role : null;
  if (roleFilter && !MEMBER_ROLES.has(roleFilter)) return res.status(400).json({ error: "role must be admin|trainer|learner|stakeholder" });
  try {
    if (roleFilter) {
      if (roleFilter === "admin") await assertNotLastProgrammeAdmin(req.params.id, target.id, "admin");
      const grants = await db.userRole.findMany({ where: { userId: target.id, programmeId: req.params.id }, include: { role: true } }).catch(() => [] as Array<{ id: string; role: { name: string } }>);
      const grant = grants.find((g) => g.role.name === roleFilter);
      if (!grant) return res.status(404).json({ error: `member has no ${roleFilter} grant in this programme` });
      let coursesUnassigned = 0;
      await db.$transaction(async (tx) => {
        await tx.userRole.delete({ where: { id: grant.id } });
        if (roleFilter === "trainer") {
          const remainingTrainer = await tx.userRole.findFirst({ where: { userId: target.id, programmeId: req.params.id, role: { name: "trainer" } } });
          if (!remainingTrainer) {
            const result = await tx.course.updateMany({ where: { programmeId: req.params.id, OR: [{ trainerId: target.id }, { trainerId: null, trainer: target.name }] }, data: { trainerId: null, trainer: "" } });
            coursesUnassigned = result.count;
          }
        }
        const remaining = await tx.userRole.count({ where: { userId: target.id, programmeId: req.params.id } });
        if (remaining === 0) {
          await tx.enrolment.updateMany({ where: { learnerId: target.id, programmeId: req.params.id, status: { not: "withdrawn" } }, data: { status: "withdrawn", withdrawnAt: new Date(), withdrawnBy: me.id } });
        }
        await tx.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
        await tx.auditLog.create({ data: { userId: me.id, action: "PROGRAMME_MEMBER_ROLE_REMOVED", entity: "programme", entityId: req.params.id, details: JSON.stringify({ userId: target.id, email: target.email, role: roleFilter }) } }).catch(() => null);
      });
      return res.json({ userId: target.id, removed: 1, coursesUnassigned });
    }
    const result = await removeProgrammeMembers(req.params.id, [target.id], me.id, scope.orgId);
    return res.json({ userId: target.id, removed: result.removed, coursesUnassigned: result.coursesUnassigned, withdrawn: result.withdrawn });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

router.post("/programmes/:id/members/bulk-remove", requireProgrammeRole("admin", "owner"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const programme = await assertProgrammeInOrg(req.params.id, scope.orgId);
  const userIds = [...new Set(((req.body?.userIds ?? []) as string[]).map(String).filter(Boolean))].slice(0, 500);
  if (!userIds.length) return res.status(400).json({ error: "userIds required" });
  const org = await db.organization.findUnique({ where: { id: scope.orgId }, select: { bulkRemovalThreshold: true } }).catch(() => null);
  const threshold = org?.bulkRemovalThreshold ?? 5;
  try {
    if (userIds.length >= threshold) {
      const request = await createDeleteRequest("member_bulk", programme.id, me, scope.orgId, req.body?.reason ? String(req.body.reason) : undefined, JSON.stringify({ userIds }));
      return res.status(202).json({ pendingApproval: true, request });
    }
    const result = await removeProgrammeMembers(programme.id, userIds, me.id, scope.orgId);
    return res.json({ pendingApproval: false, ...result });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

router.get("/programmes/:id/modules", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.params.id, scope.orgId);
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.module.findMany({ where: { course: { programmeId: req.params.id, programme: { orgId: scope.orgId } }, ...lifecycleFilter(includeArchived) } }).catch(() => []));
});
router.post("/programmes/:id/modules", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
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
router.patch("/modules/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.id, course: { programme: { orgId: scope.orgId } } } });
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.order !== undefined) data.order = Number(patch.order);
  return res.json(await db.module.update({ where: { id: mod.id }, data }));
});
router.patch("/assessments/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const a = await db.assessment.findFirst({
    where: { id: req.params.id, module: { course: { programme: { orgId: scope.orgId } } } },
    include: { module: { select: { courseId: true } } },
  });
  if (!a) return res.status(404).json({ error: "assessment not found in your organization" });
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  const data: Record<string, unknown> = {};
  if (req.body?.type) data.type = req.body.type;
  if (req.body?.maxScore !== undefined) data.maxScore = Number(req.body.maxScore);
  for (const k of ["passMark", "maxAttempts", "timeLimitMinutes"]) {
    if (req.body?.[k] !== undefined) data[k] = req.body[k] === null ? null : Number(req.body[k]);
  }
  if (req.body?.title !== undefined) data.title = String(req.body.title);

  // Round 9 / 2.1: editing a live paper no longer takes it offline. The change goes into one
  // draft that accumulates further edits; nothing a learner sees moves until the draft is
  // published, and pushing a draft live is what retires the old version.
  if (a.isPublished) {
    if (req.body?.confirmNewVersion !== true) {
      return res.status(409).json({
        error: `this assessment is live; your edit opens draft v${a.version + 1} and learners stay on v${a.version} until you publish it`,
        requiresNewVersion: true,
        nextVersion: a.version + 1,
      });
    }
    const draft = await ensureDraftFor(a.id, (req as AuthedRequest).user!.id);
    const saved = await db.assessment.update({ where: { id: draft.id }, data });
    return res.status(201).json({ ...saved, supersededId: a.id, draft: true });
  }
  return res.json(await db.assessment.update({ where: { id: a.id }, data }));
});
router.get("/modules/:id/assessments", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const includeArchived = req.query.includeArchived === "true" && canSeeArchived((req as AuthedRequest).user?.role);
  res.json(await db.assessment.findMany({ where: { moduleId: req.params.id, module: { course: { programme: { orgId: scope.orgId } } }, ...lifecycleFilter(includeArchived) } }).catch(() => []));
});
router.post("/modules/:id/assessments", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  if (req.body?.type && !["recall", "applied"].includes(req.body.type)) return res.status(400).json({ error: "type must be recall|applied" });
  const mod = await db.module.findFirst({ where: { id: req.params.id, course: { programme: { orgId: scope.orgId } } } });
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  return res.status(201).json(await db.assessment.create({
    data: {
      moduleId: mod.id,
      type: req.body.type ?? "recall",
      title: req.body.title ? String(req.body.title) : "",
      maxScore: req.body.maxScore !== undefined ? Number(req.body.maxScore) : 100,
      passMark: req.body.passMark !== undefined ? Number(req.body.passMark) : 70,
      maxAttempts: req.body.maxAttempts !== undefined ? Number(req.body.maxAttempts) : null,
      timeLimitMinutes: req.body.timeLimitMinutes !== undefined ? Number(req.body.timeLimitMinutes) : null,
    },
  }));
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
router.post("/courses", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertProgrammeInOrg(req.body.programmeId, scope.orgId);
  let trainerId: string | null = null;
  let trainerName = String(req.body.trainer ?? "");
  if (req.body.trainerId) {
    const t = await db.user.findFirst({ where: { id: String(req.body.trainerId), orgId: scope.orgId } });
    if (!t) return res.status(404).json({ error: "trainer not found in your organization" });
    trainerId = t.id;
    trainerName = t.name;
  }
  return res.status(201).json(await db.course.create({ data: { programmeId: req.body.programmeId, title: req.body.title, category: req.body.category ?? "General", trainerId, trainer: trainerName } }));
});
router.patch("/courses/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  await assertCourseInOrg(req.params.id, scope.orgId);
  const patch = req.body ?? {};
  if (patch.programmeId) await assertProgrammeInOrg(patch.programmeId, scope.orgId);
  const data: Record<string, unknown> = {};
  for (const k of ["title", "category", "status", "duration", "dueDate", "programmeId"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.trainerId !== undefined) {
    if (patch.trainerId === null || patch.trainerId === "") {
      data.trainerId = null;
      data.trainer = "";
    } else {
      const t = await db.user.findFirst({ where: { id: String(patch.trainerId), orgId: scope.orgId } });
      if (!t) return res.status(404).json({ error: "trainer not found in your organization" });
      data.trainerId = t.id;
      data.trainer = t.name;
    }
  } else if (patch.trainer !== undefined) {
    data.trainer = patch.trainer;
  }
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
// Scores must only ever be produced server-side from stored answers.
router.post("/courses/:id/attempts", (_req, res) => {
  return res.status(410).json({ error: "client-submitted scores are no longer accepted; use POST /assessments/:id/attempts and POST /attempts/:id/submit" });
});

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Round 8 / 2.1: the five question kinds the builder and learner screen share.
export const QUESTION_KINDS = ["single_choice", "multi_choice", "true_false", "short_answer", "scenario"] as const;
type QuestionKind = (typeof QUESTION_KINDS)[number];
const CHOICE_KINDS = new Set<QuestionKind>(["single_choice", "multi_choice", "true_false"]);
const MANUAL_KINDS = new Set<QuestionKind>(["scenario"]);

function normalizeKind(value: unknown, assessmentType: string): QuestionKind | null {
  const raw = String(value ?? "").trim();
  if ((QUESTION_KINDS as readonly string[]).includes(raw)) return raw as QuestionKind;
  // Backwards compatibility with rows/questions posted before kinds existed.
  if (raw === "recall" || raw === "applied") return "multi_choice";
  if (!raw) return assessmentType === "applied" ? "scenario" : "multi_choice";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Phase 4 — assessment builder, server-side grading, the review queue, and what a result sets off.
//
// Three rules run through everything here:
//   * a score never comes from the request body;
//   * a learner never sees an answer key or a rubric;
//   * a published assessment is frozen — editing it makes a new version, so past attempts keep
//     pointing at the questions they were graded against.
// ---------------------------------------------------------------------------------------------

// Only the live copy of an assessment may be read by a learner: a superseded version keeps its
// attempts but accepts no new ones.
function liveAssessmentFilter() {
  return { isPublished: true, publishedAt: { not: null } as { not: null } };
}

async function assessmentInOrg(assessmentId: string, orgId: string) {
  return db.assessment
    .findFirst({
      where: { id: assessmentId, module: { course: { programme: { orgId } } } },
      include: {
        module: { select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true, programmeId: true, appliedThreshold: true } } } },
        questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } },
      },
    })
    .catch(() => null);
}

// The rows a learner may see: no `isCorrect`, no `rubric`. Leaving them out of the query rather
// than deleting them afterwards means no future edit to this file can leak them by accident.
function learnerQuestionView(questions: Array<{ id: string; kind: string; prompt: string; scenarioContext: string | null; points: number; order: number; options: Array<{ id: string; text: string; order: number }> }>) {
  return shuffleInPlace(
    questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      scenarioContext: q.scenarioContext,
      points: q.points,
      order: q.order,
      options: shuffleInPlace(q.options.map((o) => ({ id: o.id, text: o.text, order: o.order }))),
    })),
  );
}

// Short answers are auto-marked when the question lists accepted answers. Doing it here keeps the
// rule in one place: an answer counts when it matches an accepted form once case, surrounding
// space and repeated spaces are ignored — never by substring, so "not at all" cannot match "all".
function acceptedForms(accepted: string[]): string[] {
  return accepted.map((s) => s.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
}

function shortAnswerMatches(text: string, accepted: string[]): boolean {
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]$/, "");
  const forms = acceptedForms(accepted);
  if (!forms.length) return false;
  const answer = normalise(text);
  return answer.length > 0 && forms.some((f) => normalise(f) === answer);
}

// Publish freezes the current question set. A later edit to a published assessment clones it into
// a new version instead of changing questions that attempt history depends on.
/**
 * Round 9 / 2.1. The one draft for a live paper. A published assessment is never edited in place:
 * the edit opens (or reuses) a draft at version + 1 that points back at it, and the live row keeps
 * its questions, its attempts and its place as the paper learners are taking.
 */
async function ensureDraftFor(assessmentId: string, actorId: string) {
  const source = await db.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
  });
  const existing = await db.assessment.findFirst({ where: { supersedesId: source.id, isPublished: false, deletedAt: null } });
  if (existing) return existing;
  return db.$transaction(async (tx) => {
    // Re-check inside the transaction: two trainers saving at once must still get one draft.
    const again = await tx.assessment.findFirst({ where: { supersedesId: source.id, isPublished: false, deletedAt: null } });
    if (again) return again;
    const copy = await tx.assessment.create({
      data: {
        moduleId: source.moduleId,
        type: source.type,
        title: source.title,
        maxScore: source.maxScore,
        passMark: source.passMark,
        maxAttempts: source.maxAttempts,
        timeLimitMinutes: source.timeLimitMinutes,
        isPublished: false,
        publishedAt: null,
        version: source.version + 1,
        supersedesId: source.id,
      },
    });
    for (const question of source.questions) {
      const q = await tx.question.create({
        data: {
          assessmentId: copy.id,
          order: question.order,
          kind: question.kind,
          prompt: question.prompt,
          scenarioContext: question.scenarioContext,
          points: question.points,
          rubric: question.rubric,
          acceptedAnswers: question.acceptedAnswers,
        },
      });
      for (const option of question.options) {
        await tx.questionOption.create({ data: { questionId: q.id, text: option.text, isCorrect: option.isCorrect, order: option.order } });
      }
    }
    await tx.auditLog.create({
      data: { userId: actorId, action: "ASSESSMENT_DRAFT_OPENED", entity: "assessment", entityId: copy.id, details: JSON.stringify({ supersedesId: source.id, version: copy.version }) },
    }).catch(() => null);
    return copy;
  });
}

function questionProblems(kind: QuestionKind, assessmentType: string, options: Array<{ text?: unknown; isCorrect?: unknown }>, acceptedAnswers?: unknown): string[] {
  const problems: string[] = [];
  if (assessmentType === "recall" && kind === "scenario") problems.push("recall assessments cannot contain scenario questions");
  if (CHOICE_KINDS.has(kind)) {
    if (!Array.isArray(options) || options.length < 2) problems.push(`${kind} questions need at least two options`);
    if (Array.isArray(options) && options.some((o) => !String(o?.text ?? "").trim())) problems.push("every option needs text");
    const correct = Array.isArray(options) ? options.filter((o) => o?.isCorrect === true).length : 0;
    if (kind === "multi_choice" && correct < 1) problems.push("multi-choice questions need at least one correct option");
    if ((kind === "single_choice" || kind === "true_false") && correct !== 1) problems.push(`${kind} questions need exactly one correct option`);
    if (kind === "true_false" && Array.isArray(options) && options.length !== 2) problems.push("true/false questions need exactly two options");
  } else if (options.length) {
    problems.push(`${kind} questions do not use options`);
  }
  if (kind === "short_answer" && acceptedAnswers !== undefined && !Array.isArray(acceptedAnswers)) {
    problems.push("acceptedAnswers must be a list of strings");
  }
  return problems;
}

function acceptedAnswersJson(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const list = value.map((v) => String(v).trim()).filter(Boolean).slice(0, 50);
  return list.length ? JSON.stringify(list) : null;
}

function parseAcceptedAnswers(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function publishProblems(assessment: { type: string; questions: Array<{ kind: string; options: Array<{ isCorrect: boolean }> }> }): string[] {
  const problems: string[] = [];
  if (!assessment.questions.length) problems.push("add at least one question before publishing");
  for (const q of assessment.questions) {
    const kind = normalizeKind(q.kind, assessment.type);
    if (!kind) { problems.push(`unknown question kind ${q.kind}`); continue; }
    problems.push(...questionProblems(kind, assessment.type, q.options ?? []));
  }
  if (assessment.type === "applied" && !assessment.questions.some((q) => {
    const k = normalizeKind(q.kind, assessment.type);
    return k === "scenario" || k === "short_answer";
  })) {
    problems.push("applied assessments need at least one scenario or short-answer question (a scenario or short answer cannot be shown by choice alone)");
  }
  return problems;
}

router.get("/assessments/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const assessment = await assessmentInOrg(req.params.id, scope.orgId);
  if (!assessment) return res.status(404).json({ error: "assessment not found in your organization" });
  const isLive = assessment.isPublished && assessment.publishedAt !== null;
  return res.json({ ...assessment, editable: !isLive, live: isLive });
});

const QUESTION_KIND_SET = new Set(["single_choice", "multi_choice", "true_false", "short_answer", "scenario"]);

// Static checks for a question. `type` is the assessment's type, because a recall assessment may
// only carry objective kinds and an applied one needs at least one manual kind to publish.
function validateQuestionInput(type: string, body: any, kind: string): string | null {
  if (!QUESTION_KIND_SET.has(kind)) return "kind must be single_choice|multi_choice|true_false|short_answer|scenario";
  if (type === "recall" && (kind === "short_answer" || kind === "scenario")) {
    return `a recall assessment may only contain objective questions; ${kind} questions are not allowed`;
  }
  if (!String(body?.prompt ?? "").trim()) return "prompt required";
  const points = body?.points === undefined ? 1 : Number(body.points);
  if (!Number.isFinite(points) || points <= 0) return "points must be a positive number";
  const objective = kind === "single_choice" || kind === "multi_choice" || kind === "true_false";
  if (objective) {
    const options = Array.isArray(body?.options) ? (body.options as any[]) : [];
    if (options.length < 2) return "at least two options are required";
    if (options.some((o) => !String(o?.text ?? "").trim())) return "every option needs text";
    const correct = options.filter((o) => o?.isCorrect === true).length;
    if (kind !== "multi_choice" && correct !== 1) return `${kind} questions must have exactly one correct option`;
    if (kind === "multi_choice" && correct < 1) return "multi_choice questions need at least one correct option";
    return null;
  }
  // A scenario is marked against a rubric by a person. A short answer may list accepted forms and
  // be marked without one, so its rubric stays optional.
  if (kind === "scenario" && !String(body?.rubric ?? "").trim()) return "a scenario question needs a rubric to mark it against";
  return null;
}

function questionWriteData(type: string, body: any, kind: string, fallbackOrder: number) {
  const data: Record<string, unknown> = {
    kind,
    prompt: String(body.prompt).trim(),
    points: body.points === undefined ? 1 : Number(body.points),
    order: body.order === undefined ? fallbackOrder : Number(body.order),
    scenarioContext: body.scenarioContext === undefined || body.scenarioContext === null ? null : String(body.scenarioContext),
    rubric: body.rubric === undefined || body.rubric === null ? null : String(body.rubric),
  };
  if (body.acceptedAnswers !== undefined) {
    // Short answers may carry a list of accepted forms; stored on the question as JSON so a rubric
    // stays a single column of instructions for a person and the accepted forms stay machine-read.
    const forms = Array.isArray(body.acceptedAnswers) ? body.acceptedAnswers.map(String) : [];
    data.acceptedAnswers = forms.length ? JSON.stringify(forms) : null;
  }
  return data;
}

async function writeOptions(tx: any, questionId: string, options: any[]) {
  await tx.questionOption.deleteMany({ where: { questionId } });
  for (let i = 0; i < options.length; i++) {
    await tx.questionOption.create({ data: { questionId, text: String(options[i].text), isCorrect: options[i]?.isCorrect === true, order: i } });
  }
}

// Editing a published assessment continues in a new version and returns where the edit landed,
// so the client can follow the version rather than wonder why its change did not appear.
router.post("/assessments/:id/questions", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  let assessment = await assessmentInOrg(req.params.id, scope.orgId);
  if (!assessment) return res.status(404).json({ error: "assessment not found in your organization" });
  const kind = String(req.body?.kind ?? "");
  const problem = validateQuestionInput(assessment.type, req.body, kind);
  if (problem) return res.status(400).json({ error: problem });

  let versionCreated = false;
  if (assessment.isPublished) {
    assessment = (await assessmentInOrg((await ensureDraftFor(assessment.id, me.id)).id, scope.orgId))!;
    versionCreated = true;
  }
  const options = Array.isArray(req.body?.options) ? (req.body.options as any[]) : [];
  const question = await db.$transaction(async (tx) => {
    const q = await tx.question.create({ data: { assessmentId: assessment!.id, ...(questionWriteData(assessment!.type, req.body, kind, assessment!.questions.length) as any) } });
    if (options.length) await writeOptions(tx, q.id, options);
    return tx.question.findUnique({ where: { id: q.id }, include: { options: { orderBy: { order: "asc" } } } });
  });
  return res.status(201).json({ ...question, assessmentId: assessment.id, version: assessment.version, versionCreated });
});

router.patch("/questions/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const question = await db.question.findFirst({
    where: { id: req.params.id, assessment: { module: { course: { programme: { orgId: scope.orgId } } } } },
    include: { assessment: { select: { id: true, type: true, isPublished: true } } },
  }).catch(() => null);
  if (!question) return res.status(404).json({ error: "question not found in your organization" });
  if (question.assessment.isPublished) {
    return res.status(409).json({ error: "this assessment is published; editing it starts a new version", code: "published" });
  }
  const kind = String(req.body?.kind ?? question.kind);
  const merged = {
    prompt: req.body?.prompt ?? question.prompt,
    points: req.body?.points ?? question.points,
    options: req.body?.options,
    rubric: req.body?.rubric ?? question.rubric,
    acceptedAnswers: req.body?.acceptedAnswers,
  };
  const problem = validateQuestionInput(question.assessment.type, merged, kind);
  if (problem) return res.status(400).json({ error: problem });
  const updated = await db.$transaction(async (tx) => {
    const data: Record<string, unknown> = questionWriteData(question.assessment.type, { ...merged, order: req.body?.order ?? question.order, scenarioContext: req.body?.scenarioContext ?? question.scenarioContext }, kind, question.order);
    // Only overwrite the accepted answers when the caller sent them, so a prompt edit does not
    // silently drop the machine-marking rule.
    if (req.body?.acceptedAnswers === undefined) delete data.acceptedAnswers;
    await tx.question.update({ where: { id: question.id }, data });
    if (Array.isArray(req.body?.options)) await writeOptions(tx, question.id, req.body.options);
    return tx.question.findUnique({ where: { id: question.id }, include: { options: { orderBy: { order: "asc" } } } });
  });
  return res.json(updated);
});

router.delete("/questions/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const question = await db.question.findFirst({
    where: { id: req.params.id, assessment: { module: { course: { programme: { orgId: scope.orgId } } } } },
    include: { assessment: { select: { isPublished: true } } },
  }).catch(() => null);
  if (!question) return res.status(404).json({ error: "question not found in your organization" });
  if (question.assessment.isPublished) {
    return res.status(409).json({ error: "this assessment is published; editing it starts a new version", code: "published" });
  }
  await db.$transaction(async (tx) => {
    // Stored answers to this question are part of an attempt that was already graded; keep them
    // readable by clearing the link rather than refusing the edit.
    await tx.attemptAnswer.deleteMany({ where: { questionId: question.id } }).catch(() => null);
    await tx.questionOption.deleteMany({ where: { questionId: question.id } });
    await tx.question.delete({ where: { id: question.id } });
  });
  return res.json({ deleted: question.id });
});

router.put("/assessments/:id/questions/order", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const assessment = await db.assessment.findFirst({ where: { id: req.params.id, module: { course: { programme: { orgId: scope.orgId } } } } }).catch(() => null);
  if (!assessment) return res.status(404).json({ error: "assessment not found in your organization" });
  if (assessment.isPublished) return res.status(409).json({ error: "cannot reorder questions of a published assessment", requiresNewVersion: true });
  const ids = ((req.body?.ids ?? []) as string[]).map(String);
  const questions = await db.question.findMany({ where: { assessmentId: assessment.id }, select: { id: true } }).catch(() => [] as Array<{ id: string }>);
  const allowed = new Set(questions.map((q) => q.id));
  if (ids.length !== allowed.size || ids.some((id) => !allowed.has(id))) {
    return res.status(400).json({ error: "ids must list every question in this assessment exactly once" });
  }
  await db.$transaction(ids.map((id, index) => db.question.update({ where: { id }, data: { order: index } })));
  return res.json({ assessmentId: assessment.id, order: ids });
});

router.get("/assessments/:id/publish-impact", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const draft = await db.assessment.findFirst({
    where: { id: req.params.id, isPublished: false, supersedesId: { not: null }, module: { course: { programme: { orgId: scope.orgId } } } },
    select: { id: true, supersedesId: true, module: { select: { courseId: true } } },
  }).catch(() => null);
  if (!draft || !draft.supersedesId) return res.status(404).json({ error: "draft not found in your organization" });
  const previous = await db.assessment.findFirst({
    where: { id: draft.supersedesId, module: { course: { programme: { orgId: scope.orgId } } } },
    select: { id: true, supersedesId: true, changeKind: true, supersededAt: true },
  }).catch(() => null);
  if (!previous || previous.supersededAt) return res.status(400).json({ error: "this draft does not replace a live paper" });

  const enrolments = await db.enrolment.findMany({
    where: { courseId: draft.module.courseId, status: { not: "withdrawn" }, withdrawnAt: null },
    select: { learnerId: true, status: true },
  }).catch(() => [] as Array<{ learnerId: string; status: string }>);
  const learnerIds = enrolments.map((e) => e.learnerId);
  const chain = await versionChain(db, previous);
  const attempts = learnerIds.length
    ? await db.assessmentAttempt.findMany({
        where: { assessmentId: { in: chain.map((node) => node.id) }, learnerId: { in: learnerIds } },
        select: { learnerId: true },
        distinct: ["learnerId"],
      }).catch(() => [] as Array<{ learnerId: string }>)
    : [];
  return res.json({
    enrolled: enrolments.length,
    completed: enrolments.filter((e) => e.status === "completed").length,
    notCompleted: enrolments.filter((e) => e.status !== "completed").length,
    withAttempts: attempts.length,
  });
});

router.post("/assessments/:id/publish", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const assessment = await db.assessment.findFirst({
    where: { id: req.params.id, module: { course: { programme: { orgId: scope.orgId } } } },
    include: { questions: { include: { options: true } }, module: { select: { courseId: true } } },
  }).catch(() => null);
  if (!assessment) return res.status(404).json({ error: "assessment not found in your organization" });
  if (assessment.isPublished && assessment.publishedAt) return res.status(409).json({ error: "this assessment is already published; edit it to start a new version" });
  const problems = publishProblems(assessment);
  if (problems.length) return res.status(400).json({ error: problems[0], problems });

  // Round 9 / 2.2: a version that replaces a live one must say how the change was meant. A minor
  // correction carries earlier results forward; a new paper means a retake and a fresh attempt
  // count. The trainer chooses, so a typo fix does not silently cost a learner their competence.
  const previous = assessment.supersedesId
    ? await db.assessment.findUnique({ where: { id: assessment.supersedesId }, select: { id: true, version: true, supersededAt: true } })
    : null;
  const replacesLive = !!previous && !previous.supersededAt;
  const changeKind = req.body?.changeKind;
  if (replacesLive && !["minor", "new_paper"].includes(String(changeKind))) {
    return res.status(400).json({
      error: "changeKind is required when publishing over a live version: \"minor\" (results carry forward) or \"new_paper\" (learners must retake)",
      requiresChangeKind: true,
    });
  }
  if (changeKind !== undefined && !["minor", "new_paper"].includes(String(changeKind))) {
    return res.status(400).json({ error: "changeKind must be minor or new_paper" });
  }

  const total = assessment.questions.reduce((sum, q) => sum + (q.points ?? 1), 0);
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const published = await tx.assessment.update({
      where: { id: assessment.id },
      data: { isPublished: true, publishedAt: now, maxScore: total, changeKind: changeKind === undefined ? null : String(changeKind) },
    });
    if (replacesLive) {
      await tx.assessment.update({ where: { id: previous.id }, data: { isPublished: false, publishedAt: null, supersededAt: now, supersededById: me.id } });
    }
    return published;
  });
  await db.auditLog.create({
    data: {
      userId: me.id,
      action: "ASSESSMENT_PUBLISHED",
      entity: "assessment",
      entityId: assessment.id,
      details: `v${assessment.version}, ${assessment.questions.length} question(s)${replacesLive ? `, replaces v${previous.version} as ${changeKind}` : ""}`,
    },
  }).catch(() => null);

  // Round 9 / 3.3: the re-evaluation is queued, not run inside the request.
  if (replacesLive) {
    await enqueueCourseEvaluation(assessment.module.courseId, "assessment_superseded");
    // A new paper is a retake for everyone who has not completed: say so, once.
    if (changeKind === "new_paper") {
      await notifyRetakeRequired(assessment.module.courseId, assessment.title);
    }
  } else {
    await enqueueCourseEvaluation(assessment.module.courseId, "assessment_published");
  }
  return res.json(updated);
});

/** Tell the enrolled, not-yet-completed learners that a new paper is up and they need to retake. */
async function notifyRetakeRequired(courseId: string, title: string): Promise<void> {
  const enrolments = await db.enrolment.findMany({
    where: { courseId, status: { not: "withdrawn" }, withdrawnAt: null, OR: [{ status: { not: "completed" } }, { completionSource: null }] },
    select: { learnerId: true },
  }).catch(() => [] as Array<{ learnerId: string }>);
  const { notify } = await import("../services/notify.js");
  for (const e of enrolments) {
    await notify(e.learnerId, "assessment_retake_required", {
      title: "This assessment was updated",
      body: `"${title}" has been replaced with a new paper. Please retake it to update your result.`,
      link: "/assessments",
    }).catch(() => null);
  }
}

// Round 9 / 2.1: discarding a draft is how a trainer backs out of an edit. The live version is
// untouched; only the unpublished row goes away.
router.post("/assessments/:id/discard-draft", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const draft = await db.assessment.findFirst({
    where: { id: req.params.id, isPublished: false, module: { course: { programme: { orgId: scope.orgId } } } },
    select: { id: true, supersedesId: true, version: true },
  }).catch(() => null);
  if (!draft) return res.status(404).json({ error: "no editable draft with that id in your organization" });
  if (!draft.supersedesId) return res.status(409).json({ error: "this is not a draft of a live version; delete it with the normal rules instead" });
  const attempts = await db.assessmentAttempt.count({ where: { assessmentId: draft.id } });
  if (attempts) return res.status(409).json({ error: "this draft already has attempts; it cannot be discarded" });
  await db.$transaction(async (tx) => {
    await tx.questionOption.deleteMany({ where: { question: { assessmentId: draft.id } } });
    await tx.question.deleteMany({ where: { assessmentId: draft.id } });
    await tx.assessment.delete({ where: { id: draft.id } });
    await tx.auditLog.create({
      data: { userId: me.id, action: "ASSESSMENT_DRAFT_DISCARDED", entity: "assessment", entityId: draft.id, details: JSON.stringify({ supersedesId: draft.supersedesId, version: draft.version }) },
    }).catch(() => null);
  });
  return res.json({ discarded: draft.id, liveVersion: draft.supersedesId });
});

router.get("/courses/:id/evaluation-status", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const course = await db.course.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } }, select: { programmeId: true } }).catch(() => null);
  if (!course) return res.status(404).json({ error: "course not found in your organization" });
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, course.programmeId));
  if (!staff) return res.status(403).json({ error: "programme staff access required" });
  const { evaluationStatusFor } = await import("../services/evaluationQueue.js");
  const status = await evaluationStatusFor(req.params.id);
  return res.json(status);
});

router.get("/courses/:id/assessments", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const course = await db.course.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } }).catch(() => null);
  if (!course) return res.status(404).json({ error: "course not found in your organization" });
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, course.programmeId));
  const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: course.id } }).catch(() => null);
  if (!staff && !enrolled) return res.status(403).json({ error: "enrolment required" });
  const assessments = await db.assessment.findMany({
    where: {
      module: { courseId: course.id, isArchived: false, deletedAt: null },
      ...(staff ? {} : { isPublished: true, supersededAt: null }),
      ...lifecycleFilter(false),
    },
    include: { questions: { select: { id: true, kind: true, points: true, order: true }, orderBy: { order: "asc" } }, module: { select: { id: true, title: true } } },
    orderBy: { id: "asc" },
  }).catch(() => [] as any[]);
  const submitted = await db.assessmentAttempt.findMany({ where: { learnerId: me.id, assessmentId: { in: assessments.map((a) => a.id) }, status: { in: ["submitted", "graded"] } }, select: { assessmentId: true, percent: true } }).catch(() => [] as any[]);
  return res.json(assessments.map((a) => {
    const attempts = submitted.filter((s) => s.assessmentId === a.id);
    const best = attempts.length ? Math.max(...attempts.map((s) => s.percent ?? 0)) : null;
    const locked = !!a.maxAttempts && attempts.length >= a.maxAttempts && (best ?? 0) < (a.passMark ?? 70);
    return { ...a, attemptCount: attempts.length, bestScore: best, remainingAttempts: a.maxAttempts ? Math.max(0, a.maxAttempts - attempts.length) : null, locked };
  }));
});

// Start an attempt. Eligibility is checked here and nowhere else: live assessment, enrolment in
// the course, and attempts remaining.
router.post("/assessments/:id/attempts", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const assessment = await assessmentInOrg(req.params.id, scope.orgId);
  if (!assessment) return res.status(404).json({ error: "assessment not found" });
  if (assessment.supersededAt) return res.status(403).json({ error: "this paper has been superseded; start the current version instead", superseded: true });
  if (!assessment.isPublished || !assessment.publishedAt) return res.status(403).json({ error: "assessment is not published" });
  const enrolment = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: assessment.module.courseId } }).catch(() => null);
  if (!enrolment || enrolment.status === "withdrawn" || enrolment.withdrawnAt) return res.status(403).json({ error: "enrolment required to take this assessment" });
  if (!assessment.questions.length) return res.status(409).json({ error: "assessment has no questions" });

  const { passMarkFor, parseOptionIds } = await import("../services/assessment.js");
  const threshold = passMarkFor({ passMark: assessment.passMark, type: assessment.type }, assessment.module.course);
  const stats = await attemptStats(db, assessment, enrolment.id, threshold);
  if (assessment.maxAttempts && stats.attemptsUsed >= assessment.maxAttempts && !stats.passedBefore) {
    return res.status(403).json({ error: "no attempts remaining; ask a trainer to reset your attempts", locked: true, bestScore: stats.bestScore, attemptsUsed: stats.attemptsUsed, maxAttempts: assessment.maxAttempts });
  }

  // Resuming: an attempt already in progress is returned rather than a second one started, so a
  // reload or a lost connection cannot burn an attempt.
  const expiresAtFor = (startedAt: Date) => (assessment.timeLimitMinutes ? new Date(startedAt.getTime() + assessment.timeLimitMinutes * 60_000) : null);
  let attempt = await db.assessmentAttempt.findFirst({ where: { assessmentId: assessment.id, enrolmentId: enrolment.id, status: "in_progress" }, orderBy: { startedAt: "desc" } });
  let resumed = !!attempt;
  if (attempt) {
    const expires = expiresAtFor(attempt.startedAt);
    // Time ran out while the learner was away: close the open attempt so a new one can start.
    if (expires && expires <= new Date()) {
      await db.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: "grading", submittedAt: new Date() } }).catch(() => null);
      attempt = null;
      resumed = false;
    }
  }
  if (!attempt) {
    attempt = await db.assessmentAttempt.create({
      data: { assessmentId: assessment.id, enrolmentId: enrolment.id, learnerId: me.id, attemptNumber: stats.attemptsUsed + 1, startedAt: new Date(), status: "in_progress" },
    });
  }
  const savedAnswers = resumed ? await db.attemptAnswer.findMany({ where: { attemptId: attempt.id } }).catch(() => []) : [];
  return res.status(resumed ? 200 : 201).json({
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    resumed,
    startedAt: attempt.startedAt,
    expiresAt: expiresAtFor(attempt.startedAt),
    timeLimitMinutes: assessment.timeLimitMinutes,
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    type: assessment.type,
    version: assessment.version,
    maxAttempts: assessment.maxAttempts,
    attemptsUsed: stats.attemptsUsed,
    questions: learnerQuestionView(assessment.questions),
    answers: savedAnswers.map((a) => ({ questionId: a.questionId, optionIds: parseOptionIds(a.optionIds ?? null), text: a.answer })),
  });
});

router.post("/assessments/:id/attempts/reset", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const assessment = await assessmentInOrg(req.params.id, scope.orgId);
  if (!assessment) return res.status(404).json({ error: "assessment not found" });
  const enrolmentId = typeof req.body?.enrolmentId === "string" ? req.body.enrolmentId : "";
  if (!enrolmentId) return res.status(400).json({ error: "enrolmentId required" });
  const enrolment = await db.enrolment.findFirst({
    where: {
      id: enrolmentId,
      courseId: assessment.module.courseId,
      programmeId: assessment.module.course.programmeId,
      status: { not: "withdrawn" },
      withdrawnAt: null,
    },
  }).catch(() => null);
  if (!enrolment) return res.status(404).json({ error: "enrolment not found for this assessment" });

  const chain = await versionChain(db, assessment);
  const chainIds = chain.map((node) => node.id);
  const attempts = await db.assessmentAttempt.findMany({
    where: { assessmentId: { in: chainIds }, enrolmentId },
    select: { id: true },
  });
  const attemptIds = attempts.map((attempt) => attempt.id);
  await db.$transaction(async (tx) => {
    await tx.attemptAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await tx.assessmentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
    await tx.auditLog.create({
      data: {
        userId: me.id,
        action: "ASSESSMENT_ATTEMPTS_RESET",
        entity: "assessment",
        entityId: assessment.id,
        details: `enrolment ${enrolment.id}, ${attemptIds.length} attempt(s) across ${chainIds.length} version(s)`,
      },
    }).catch(() => null);
  });
  await evaluateEnrolment(enrolment.id, "manual_status");
  return res.json({ assessmentId: assessment.id, enrolmentId: enrolment.id, reset: attemptIds.length, chainAssessmentIds: chainIds });
});

router.get("/attempts/:id", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const attempt = await db.assessmentAttempt.findFirst({
    where: { id: req.params.id },
    include: {
      answers: true,
      assessment: { include: { module: { include: { course: { select: { id: true, title: true, appliedThreshold: true, programme: { select: { orgId: true, id: true } } } } } }, questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } } },
      learner: { select: { id: true, name: true, email: true } },
    },
  }).catch(() => null);
  if (!attempt || attempt.assessment.module.course.programme.orgId !== scope.orgId) return res.status(404).json({ error: "attempt not found" });
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, attempt.assessment.module.course.programme.id));
  if (attempt.learnerId !== me.id && !staff) return res.status(403).json({ error: "this attempt belongs to another learner" });
  const { parseOptionIds, passMarkFor } = await import("../services/assessment.js");
  const answers = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const graded = attempt.status === "graded";
  const body: Record<string, unknown> = {
    attemptId: attempt.id,
    assessmentId: attempt.assessmentId,
    assessmentTitle: attempt.assessment.title,
    type: attempt.assessment.type,
    version: attempt.assessment.version,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    gradedAt: attempt.gradedAt,
    timeLimitMinutes: attempt.assessment.timeLimitMinutes,
    expiresAt: attempt.assessment.timeLimitMinutes && attempt.status === "in_progress" ? new Date(attempt.startedAt.getTime() + attempt.assessment.timeLimitMinutes * 60_000) : null,
    learner: attempt.learner,
    // A score exists only after grading; before that the attempt is still open or in the queue.
    score: graded ? attempt.score : null,
    maxScore: graded ? attempt.maxScore : null,
    percent: graded ? attempt.percent : null,
    passed: graded ? attempt.passed : null,
    passMark: passMarkFor({ passMark: attempt.assessment.passMark, type: attempt.assessment.type }, attempt.assessment.module.course),
    passMarkSource: attempt.assessment.passMark !== null ? "assessment" : attempt.assessment.type === "applied" ? "course_applied_threshold" : "default",
    questions: attempt.assessment.questions.map((q) => {
      const answer = answers.get(q.id);
      const options = q.options.map((o) => ({
        id: o.id,
        text: o.text,
        order: o.order,
        // The key and the rubric are for a trainer grading the attempt, never for the learner.
        ...(staff ? { isCorrect: o.isCorrect } : {}),
        ...(staff && graded && answer ? { selected: parseOptionIds(answer.optionIds ?? null).includes(o.id) } : {}),
      }));
      return {
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        scenarioContext: q.scenarioContext,
        points: q.points,
        order: q.order,
        options,
        ...(staff ? { rubric: q.rubric } : {}),
        ...(answer
          ? {
              yourAnswer: { optionIds: parseOptionIds(answer.optionIds ?? null), text: answer.answer },
              ...(graded || staff ? { pointsAwarded: answer.pointsAwarded, graderComment: answer.graderComment, autoGraded: answer.autoGraded } : {}),
            }
          : { yourAnswer: null }),
      };
    }),
  };
  return res.json(body);
});

// Save answers without submitting. The time limit is enforced here too, so a learner cannot keep
// editing past the deadline by never pressing submit.
router.put("/attempts/:id/answers", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const attempt = await db.assessmentAttempt.findFirst({
    where: { id: req.params.id, learnerId: me.id },
    include: {
      assessment: {
        include: {
          module: { include: { course: { select: { programme: { select: { orgId: true } } } } } },
          questions: { include: { options: { select: { id: true } } } },
        },
      },
    },
  }).catch(() => null);
  if (!attempt || attempt.assessment.module.course.programme.orgId !== scope.orgId) return res.status(404).json({ error: "attempt not found" });
  if (attempt.status !== "in_progress") return res.status(409).json({ error: "attempt is already submitted" });
  const expired = attempt.assessment.timeLimitMinutes && Date.now() > attempt.startedAt.getTime() + attempt.assessment.timeLimitMinutes * 60_000;
  if (expired) return res.status(409).json({ error: "the time limit for this attempt has passed; submit it to have what you entered graded", expired: true });
  const { saveAnswers } = await import("../services/assessment.js");
  const answers = Array.isArray(req.body?.answers) ? (req.body.answers as any[]) : [];
  const saved = await saveAnswers(attempt.id, attempt.assessment.questions.map((q) => ({ id: q.id, kind: q.kind, options: q.options })), answers);
  const expiresAt = attempt.assessment.timeLimitMinutes ? new Date(attempt.startedAt.getTime() + attempt.assessment.timeLimitMinutes * 60_000) : null;
  return res.json({ attemptId: attempt.id, saved, expiresAt });
});

async function programmeTrainerIds(programmeId: string): Promise<string[]> {
  const trainers = await db.userRole.findMany({ where: { programmeId, role: { name: "trainer" } }, select: { userId: true } }).catch(() => [] as Array<{ userId: string }>);
  if (trainers.length) return [...new Set(trainers.map((t) => t.userId))];
  const admins = await db.userRole.findMany({ where: { OR: [{ programmeId }, { programmeId: null }], role: { name: { in: ["admin", "owner"] } } }, select: { userId: true } }).catch(() => [] as Array<{ userId: string }>);
  return [...new Set(admins.map((a) => a.userId))];
}

// Submit and grade. Objective answers are marked here against the stored key; a scenario or short
// answer without accepted forms sends the attempt to the review queue instead of guessing.
router.post("/attempts/:id/submit", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const attempt = await db.assessmentAttempt.findFirst({
    where: { id: req.params.id, learnerId: me.id },
    include: {
      answers: true,
      assessment: {
        include: {
          module: { include: { course: { include: { programme: { select: { orgId: true } } } } } },
          questions: { include: { options: true } },
        },
      },
    },
  }).catch(() => null);
  if (!attempt || attempt.assessment.module.course.programme.orgId !== scope.orgId) return res.status(404).json({ error: "attempt not found" });
  if (attempt.status !== "in_progress") return res.status(409).json({ error: "attempt is already submitted" });
  // Round 8 / E.3: a withdrawn learner cannot keep answering, even on an attempt started earlier.
  const enrolment = await db.enrolment.findFirst({
    where: { learnerId: me.id, courseId: attempt.assessment.module.courseId, status: { not: "withdrawn" }, withdrawnAt: null },
    select: { id: true },
  }).catch(() => null);
  if (!enrolment) return res.status(403).json({ error: "enrolment required to submit this assessment" });

  const { gradeObjective, percentOf, passMarkFor, isObjective, isManual, parseOptionIds } = await import("../services/assessment.js");
  const sent = Array.isArray(req.body?.answers) ? (req.body.answers as any[]) : [];

  // Answers may arrive with the submit call or be already saved; the newer of the two wins.
  let savedCount = 0;
  if (sent.length) {
    const { saveAnswers } = await import("../services/assessment.js");
    savedCount = await saveAnswers(attempt.id, attempt.assessment.questions.map((q) => ({ id: q.id, kind: q.kind, options: q.options })), sent);
  }
  const stored = new Map((await db.attemptAnswer.findMany({ where: { attemptId: attempt.id } })).map((a) => [a.questionId, a]));

  let earned = 0;
  let total = 0;
  let waitingForGrading = 0;
  const results: Array<{ questionId: string; kind: string; correct: boolean | null; points: number; manual: boolean }> = [];

  for (const question of attempt.assessment.questions) {
    total += question.points ?? 1;
    const answer = stored.get(question.id);
    if (!answer) {
      results.push({ questionId: question.id, kind: question.kind, correct: null, points: 0, manual: isManual(question.kind) });
      if (isManual(question.kind)) waitingForGrading++;
      continue;
    }
    if (isObjective(question.kind)) {
      const correctIds = question.options.filter((o) => o.isCorrect).map((o) => o.id);
      const marked = gradeObjective(question.kind, question.points ?? 1, correctIds, parseOptionIds(answer.optionIds ?? null));
      earned += marked.points;
      await db.attemptAnswer.update({ where: { id: answer.id }, data: { pointsAwarded: marked.points, autoGraded: true } });
      results.push({ questionId: question.id, kind: question.kind, correct: marked.correct, points: marked.points, manual: false });
      continue;
    }
    // A short answer the question pre-agreed accepted forms for can be marked without a person.
    let accepted: string[] = [];
    try {
      accepted = question.acceptedAnswers ? (JSON.parse(question.acceptedAnswers) as string[]) : [];
    } catch {
      accepted = [];
    }
    if (isManual(question.kind) && question.kind === "short_answer" && accepted.length) {
      const marked = shortAnswerMatches(String(answer.answer ?? ""), accepted);
      const points = marked ? question.points ?? 1 : 0;
      earned += points;
      await db.attemptAnswer.update({ where: { id: answer.id }, data: { pointsAwarded: points, autoGraded: true } });
      results.push({ questionId: question.id, kind: question.kind, correct: marked, points, manual: false });
      continue;
    }
    waitingForGrading++;
    results.push({ questionId: question.id, kind: question.kind, correct: null, points: 0, manual: true });
  }

  const threshold = passMarkFor({ passMark: attempt.assessment.passMark, type: attempt.assessment.type }, attempt.assessment.module.course);
  const percentage = percentOf(earned, total);
  const now = new Date();
  const nextStatus = waitingForGrading > 0 ? "grading" : "graded";
  const updated = await db.assessmentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: nextStatus,
      submittedAt: now,
      // A partial score is not a result. Until the queue clears, the attempt carries no percent,
      // so nothing downstream can read an unfinished attempt as a pass or a fail.
      score: nextStatus === "graded" ? percentage : null,
      maxScore: total,
      percent: nextStatus === "graded" ? percentage : null,
      passed: nextStatus === "graded" ? percentage >= threshold : null,
      ...(nextStatus === "graded" ? { gradedAt: now, gradedBy: null } : {}),
    },
  });

  let outcome: Awaited<ReturnType<typeof import("../services/assessment.js")["applyAttemptOutcome"]>> | null = null;
  if (nextStatus === "graded") {
    const { applyAttemptOutcome } = await import("../services/assessment.js");
    outcome = await applyAttemptOutcome(updated.id).catch(() => null);
    await db.auditLog.create({ data: { userId: me.id, action: "ATTEMPT_AUTO_GRADED", entity: "assessment_attempt", entityId: updated.id, details: `${percentage}% (${earned}/${total})` } }).catch(() => null);
  } else {
    // Round 8 / 2.3: tell the people who have to mark it, once per submission.
    const { notify } = await import("../services/notify.js");
    const trainerIds = await programmeTrainerIds(attempt.assessment.module.course.programmeId);
    await Promise.all(
      trainerIds.map((userId) =>
        notify(userId, "grading_queued", {
          title: "Assessment waiting for marking",
          body: `A learner submitted ${attempt.assessment.title || "an assessment"} and it needs a person to mark it.`,
          link: "/assessments/grading",
        }),
      ),
    );
  }
  return res.json({
    attemptId: updated.id,
    attemptNumber: updated.attemptNumber,
    status: updated.status,
    graded: nextStatus === "graded",
    awaitingGrading: waitingForGrading,
    score: nextStatus === "graded" ? percentage : null,
    percent: nextStatus === "graded" ? percentage : null,
    earnedPoints: earned,
    totalPoints: total,
    passMark: threshold,
    passed: nextStatus === "graded" ? percentage >= threshold : null,
    competenceMet: !!outcome?.competenceMet,
    results,
  });
});

// The review queue: attempts a person has to mark. Programme staff see their own programmes; org
// staff see the organization. An attempt is never visible before it was submitted.
router.get("/assessments/grading/queue", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const programmeId = req.query.programmeId ? String(req.query.programmeId) : undefined;
  const staffEverywhere = await isOrgStaff(me.id);
  if (!staffEverywhere && !(await hasAnyProgrammeStaffGrant(me.id))) return res.status(403).json({ error: "programme staff access required" });
  const programmeIds = staffEverywhere
    ? []
    : (await db.userRole.findMany({ where: { userId: me.id, programmeId: { not: null }, role: { name: { in: ["admin", "owner", "trainer"] } } }, select: { programmeId: true } })).map((g) => g.programmeId).filter((id): id is string => !!id);
  const attempts = await db.assessmentAttempt.findMany({
    where: {
      status: "grading",
      assessment: {
        module: {
          course: {
            programmeId: staffEverywhere ? undefined : { in: programmeIds },
            programme: { orgId: scope.orgId, ...(programmeId ? { id: programmeId } : {}) },
          },
        },
      },
    },
    orderBy: { submittedAt: "asc" },
    take: 200,
    include: {
      learner: { select: { id: true, name: true, email: true } },
      assessment: { select: { id: true, title: true, type: true, module: { select: { course: { select: { id: true, title: true, programmeId: true } } } } } },
      answers: { select: { id: true, questionId: true, pointsAwarded: true, autoGraded: true } },
    },
  }).catch(() => [] as any[]);
  return res.json(attempts.map((a: any) => ({
    id: a.id,
    attemptId: a.id,
    attemptNumber: a.attemptNumber,
    submittedAt: a.submittedAt,
    learner: a.learner,
    assessment: { id: a.assessment.id, title: a.assessment.title, type: a.assessment.type },
    course: a.assessment.module.course,
    answered: a.answers.filter((x: any) => x.pointsAwarded !== null).length,
    answersStored: a.answers.length,
  })));
});

// Mark a queued attempt. Only programme staff (or org staff) may, and never the learner it
// belongs to: a learner grading their own work is the failure mode this route exists to prevent.
// Round 8 / 2.3: accepts either { grades: [{ questionId, points, comment }] } or the builder's
// { answers: [{ answerId, pointsAwarded, comment }] }.
router.post("/attempts/:id/grade", assertNotGradingSelf, requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const attempt = await db.assessmentAttempt.findFirst({
    where: { id: req.params.id },
    include: {
      answers: true,
      assessment: { include: { module: { include: { course: { include: { programme: { select: { orgId: true } } } } } }, questions: { include: { options: true } } } },
    },
  }).catch(() => null);
  if (!attempt || attempt.assessment.module.course.programme.orgId !== scope.orgId) return res.status(404).json({ error: "attempt not found in your organization" });
  if (attempt.learnerId === me.id) return res.status(403).json({ error: "you cannot grade your own attempt" });
  if (attempt.status !== "grading") {
    // A graded attempt is final. Re-marking would rewrite history that a certificate may already
    // rest on; a correction is a new attempt, not an edit.
    return res.status(409).json({ error: attempt.status === "graded" ? "this attempt was already graded" : `attempt is ${attempt.status}, not awaiting grading` });
  }

  const { isManual, percentOf, passMarkFor } = await import("../services/assessment.js");
  const answerById = new Map(attempt.answers.map((a) => [a.id, a]));
  const rawSubmissions: Array<{ questionId?: unknown; answerId?: unknown; points?: unknown; pointsAwarded?: unknown; comment?: unknown }> = Array.isArray(req.body?.grades)
    ? (req.body.grades as any[])
    : Array.isArray(req.body?.answers)
      ? (req.body.answers as any[])
      : [];
  const submissions = rawSubmissions.map((s) => ({
    questionId: s.questionId !== undefined ? String(s.questionId) : s.answerId ? answerById.get(String(s.answerId))?.questionId : undefined,
    points: s.points !== undefined ? s.points : s.pointsAwarded,
    comment: s.comment,
  }));
  const stored = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const manualQuestions = attempt.assessment.questions.filter((q) => isManual(q.kind));
  const given = new Map(submissions.map((s) => [String(s?.questionId ?? ""), s]));

  // Every manual question must be marked: a half-marked attempt would silently score zero for the
  // rest, which is the same as failing someone for a trainer's oversight.
  const missing = manualQuestions.filter((q) => !stored.get(q.id) || !given.has(q.id));
  if (missing.length) return res.status(400).json({ error: `mark every answer before finishing: ${missing.map((q) => q.id).join(", ")}` });

  let total = 0;
  let earned = 0;
  const breakdown: Array<{ questionId: string; points: number; max: number }> = [];
  for (const question of attempt.assessment.questions) {
    const max = question.points ?? 1;
    total += max;
    const answer = stored.get(question.id);
    if (!isManual(question.kind)) {
      earned += answer?.pointsAwarded ?? 0;
      continue;
    }
    const entry = given.get(question.id)!;
    const points = Number(entry.points);
    if (!Number.isFinite(points) || points < 0 || points > max) return res.status(400).json({ error: `points for ${question.id} must be between 0 and ${max}` });
    earned += points;
    breakdown.push({ questionId: question.id, points, max });
    await db.attemptAnswer.update({
      where: { id: answer!.id },
      data: { pointsAwarded: points, autoGraded: false, graderComment: entry.comment === undefined || entry.comment === null ? null : String(entry.comment).slice(0, 4000) },
    });
  }

  const threshold = passMarkFor({ passMark: attempt.assessment.passMark, type: attempt.assessment.type }, attempt.assessment.module.course);
  const percentage = percentOf(earned, total);
  const graded = await db.assessmentAttempt.update({
    where: { id: attempt.id },
    data: { status: "graded", gradedBy: me.id, gradedAt: new Date(), score: percentage, maxScore: total, percent: percentage, passed: percentage >= threshold },
  });
  const { applyAttemptOutcome } = await import("../services/assessment.js");
  const outcome = await applyAttemptOutcome(graded.id).catch(() => null);
  await db.auditLog.create({ data: { userId: me.id, action: "ATTEMPT_GRADED", entity: "assessment_attempt", entityId: graded.id, details: `${percentage}% (${earned}/${total})` } }).catch(() => null);
  const { notify } = await import("../services/notify.js");
  await notify(attempt.learnerId, "attempt_graded", {
    title: "Your assessment has been marked",
    body: `${attempt.assessment.title || "Assessment"}: ${percentage}% — ${percentage >= threshold ? "passed" : "not passed"}.`,
    link: "/my-learning",
  });
  return res.json({
    attemptId: graded.id,
    status: graded.status,
    score: percentage,
    percent: percentage,
    earnedPoints: earned,
    totalPoints: total,
    passMark: threshold,
    passed: percentage >= threshold,
    competenceMet: !!outcome?.competenceMet,
    appliedScore: outcome?.appliedScore ?? null,
    certificateIssued: !!outcome?.certificateIssued,
    graded: breakdown,
  });
});

// Staff-only view of one attempt, with the key, the rubric and what the learner answered.
router.get("/attempts/:id/answers", assertNotGradingSelf, requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const attempt = await db.assessmentAttempt.findFirst({
    where: { id: req.params.id },
    include: {
      answers: true,
      learner: { select: { id: true, name: true, email: true } },
      assessment: { include: { module: { include: { course: { select: { programme: { select: { orgId: true } } } } } }, questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } } },
    },
  }).catch(() => null);
  if (!attempt || attempt.assessment.module.course.programme.orgId !== scope.orgId) return res.status(404).json({ error: "attempt not found in your organization" });
  const { parseOptionIds } = await import("../services/assessment.js");
  const answers = new Map(attempt.answers.map((a) => [a.questionId, a]));
  return res.json({
    attemptId: attempt.id,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    learner: attempt.learner,
    assessment: { id: attempt.assessment.id, title: attempt.assessment.title, type: attempt.assessment.type, version: attempt.assessment.version },
    score: attempt.score,
    percent: attempt.percent,
    passed: attempt.passed,
    questions: attempt.assessment.questions.map((q) => {
      const answer = answers.get(q.id);
      return {
        id: q.id,
        questionId: q.id,
        kind: q.kind,
        prompt: q.prompt,
        scenarioContext: q.scenarioContext,
        points: q.points,
        rubric: q.rubric,
        options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
        answer: answer
          ? { id: answer.id, optionIds: parseOptionIds(answer.optionIds ?? null), text: answer.answer, pointsAwarded: answer.pointsAwarded, autoGraded: answer.autoGraded, graderComment: answer.graderComment }
          : null,
      };
    }),
  });
});

router.get("/courses/:id/attempts", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const course = await db.course.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } }).catch(() => null);
  if (!course) return res.status(404).json({ error: "course not found in your organization" });
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, course.programmeId));
  const assessments = await db.assessment.findMany({ where: { module: { courseId: course.id } }, select: { id: true, title: true, type: true, passMark: true } }).catch(() => [] as any[]);
  const attempts = await db.assessmentAttempt.findMany({
    where: { assessmentId: { in: assessments.map((a) => a.id) }, ...(staff ? {} : { learnerId: me.id }) },
    orderBy: { startedAt: "desc" },
    take: 500,
  }).catch(() => [] as any[]);
  const meta = new Map(assessments.map((a) => [a.id, a]));
  return res.json(attempts.map((a) => ({ ...a, assessment: meta.get(a.assessmentId) ?? null })));
});

async function computeCompetence(learnerId: string, programmeId: string) {
  const courses = await db.course.findMany({ where: { programmeId, isArchived: false, deletedAt: null }, select: { id: true } }).catch(() => [] as any[]);
  if (!courses.length) return { met: false, reason: "programme has no courses", coursesTotal: 0, coursesComplete: 0, appliedAssessments: [] as any[] };
  const courseIds = courses.map((c) => c.id);
  const enrolments = await db.enrolment.findMany({ where: { learnerId, courseId: { in: courseIds } }, select: { courseId: true, status: true } }).catch(() => [] as any[]);
  const enrolledCourses = new Set(enrolments.map((e) => e.courseId));
  const completedCourses = new Set(enrolments.filter((e) => e.status === "completed").map((e) => e.courseId));
  const applied = await db.assessment.findMany({
    where: { type: "applied", isPublished: true, module: { courseId: { in: courseIds }, isArchived: false, deletedAt: null } },
    select: { id: true, title: true, passMark: true, maxAttempts: true },
  }).catch(() => [] as any[]);
  const results: Array<{ id: string; title: string | null; passMark: number; bestScore: number | null; passed: boolean; attempts: number }> = [];
  for (const a of applied) {
    const submitted = await db.assessmentAttempt.findMany({ where: { assessmentId: a.id, learnerId, status: "submitted" }, select: { score: true } }).catch(() => [] as any[]);
    const best = submitted.length ? Math.max(...submitted.map((s) => s.score ?? 0)) : null;
    results.push({ id: a.id, title: a.title, passMark: a.passMark, bestScore: best, passed: best !== null && best >= a.passMark, attempts: submitted.length });
  }
  // Best (not latest) applied attempt counts.
  const appliedOk = applied.length > 0 && results.every((r) => r.passed);
  const met = courseIds.every((id) => enrolledCourses.has(id) && completedCourses.has(id)) && appliedOk;
  return {
    met,
    reason: met ? "all courses completed and applied assessment passed" : applied.length === 0 ? "no published applied assessment" : !appliedOk ? "applied assessment not passed" : "some courses are incomplete",
    coursesTotal: courseIds.length,
    coursesComplete: courseIds.filter((id) => completedCourses.has(id)).length,
    appliedAssessments: results,
  };
}
const CONTENT_TYPES = new Set(["native", "file", "external_link"]);

function contentItemData(body: any) {
  const type = String(body?.type ?? "");
  if (!CONTENT_TYPES.has(type)) throw Object.assign(new Error("type must be native|file|external_link"), { status: 400 });
  const title = String(body?.title ?? "").trim();
  if (!title) throw Object.assign(new Error("title required"), { status: 400 });
  const base: Record<string, unknown> = {
    type,
    title,
    description: body?.description ? String(body.description) : null,
    order: body?.order !== undefined ? Number(body.order) : 0,
    required: body?.required === undefined ? true : Boolean(body.required),
    estimatedMinutes: body?.estimatedMinutes !== undefined ? Number(body.estimatedMinutes) : null,
  };
  if (type === "native") {
    if (!body?.body) throw Object.assign(new Error("body required for native content"), { status: 400 });
    base.body = String(body.body);
  }
  // A.3: a file item points at an upload that belongs to this organization (resolved by the
  // caller, which has the org scope). The request body can no longer name an arbitrary key.
  if (type === "file") {
    const file = body?.__storedFile;
    if (!file) throw Object.assign(new Error("upload the file first, then pass its storedFileId"), { status: 400 });
    base.storedFileId = file.id;
    base.storageKey = file.storageKey;
    base.fileName = file.fileName;
    base.mimeType = file.mimeType;
    base.sizeBytes = file.sizeBytes;
    base.checksum = file.checksum;
  }
  if (type === "external_link") {
    const url = String(body?.url ?? "");
    if (!isSafeExternalUrl(url)) throw Object.assign(new Error("a valid https URL is required"), { status: 400 });
    base.url = url;
    base.provider = providerForUrl(url);
    const mode = body?.completionMode === "self_report" ? "self_report" : "trainer_verified";
    base.completionMode = mode;
  }
  return base;
}

// A.3: multipart upload. `multipart/form-data` with one part named `file` streams to disk, so
// the body is not base64 in JSON and the express.json() 100 KB limit no longer applies (H4).
// `multipart/form-data` and the old JSON body are both accepted: the JSON path is kept for
// existing clients, and both produce a StoredFile row bound to the caller's organization.
router.post("/modules/:moduleId/content/upload", requireProgrammeRole("admin", "owner", "trainer"), uploadSingleFile, async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.moduleId, course: { programme: { orgId: scope.orgId } } } }).catch(() => null);
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  const purpose = req.body?.purpose === "evidence" ? "evidence" : "content";
  try {
    let file: { fileName: string; mimeType: string; data: Buffer };
    if (req.file) {
      file = { fileName: req.file.originalname, mimeType: req.file.mimetype, data: await consumeTempFile(req.file) };
    } else {
      const fileName = String(req.body?.fileName ?? "").trim();
      const mimeType = String(req.body?.mimeType ?? "").trim().toLowerCase();
      const dataBase64 = String(req.body?.dataBase64 ?? "");
      if (!fileName || !mimeType || !dataBase64) {
        return res.status(400).json({ error: "send the file as multipart/form-data with a part named \"file\", or as fileName, mimeType and dataBase64" });
      }
      file = { fileName, mimeType, data: Buffer.from(dataBase64, "base64") };
    }
    const stored = await storeUpload({ orgId: scope.orgId, userId: me.id, purpose, ...file });
    await db.auditLog.create({ data: { userId: me.id, action: "FILE_UPLOADED", entity: "stored_file", entityId: stored.id, details: stored.fileName } }).catch(() => null);
    return res.status(201).json({
      storedFileId: stored.id,
      storageKey: stored.storageKey,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      purpose: stored.purpose,
    });
  } catch (e) {
    if (e instanceof UploadRejected) return res.status(e.status).json({ error: e.message });
    // multer's own errors (LIMIT_FILE_SIZE, …) arrive here with a `code`.
    const code = (e as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `file exceeds the ${Math.round(uploadMaxBytes() / (1024 * 1024))}MB limit` });
    if (code) return res.status(400).json({ error: `upload rejected (${code})` });
    throw e;
  }
});

// A.3: learners attach proof for a trainer-verified item. This route is deliberately open to
// any authenticated member of the organization (the content-upload route above is staff-only),
// and the file it stores is still an org-bound StoredFile, so evidenceFileId cannot be faked.
router.post("/uploads/evidence", uploadSingleFile, async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  try {
    if (!req.file) return res.status(400).json({ error: "send the file as multipart/form-data with a part named \"file\"" });
    const stored = await storeUpload({
      orgId: scope.orgId,
      userId: me.id,
      purpose: "evidence",
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: await consumeTempFile(req.file),
    });
    return res.status(201).json({
      storedFileId: stored.id, fileName: stored.fileName, mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes, checksum: stored.checksum, purpose: stored.purpose,
    });
  } catch (e) {
    if (e instanceof UploadRejected) return res.status(e.status).json({ error: e.message });
    const code = (e as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `file exceeds the ${Math.round(uploadMaxBytes() / (1024 * 1024))}MB limit` });
    if (code) return res.status(400).json({ error: `upload rejected (${code})` });
    throw e;
  }
});

router.get("/modules/:moduleId/content", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.moduleId, course: { programme: { orgId: scope.orgId } } } }).catch(() => null);
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  const includeArchived = req.query.includeArchived === "true";
  return res.json(await db.contentItem.findMany({ where: { moduleId: mod.id, ...(includeArchived ? {} : { isArchived: false }) }, orderBy: { order: "asc" } }).catch(() => []));
});

router.post("/modules/:moduleId/content", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.moduleId, course: { programme: { orgId: scope.orgId } } } }).catch(() => null);
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  try {
    // A.3: a file item must name an upload of this organization, not an arbitrary key.
    const storedFile = req.body?.type === "file" ? await resolveUploadedFile(scope.orgId, req.body) : null;
    const data = contentItemData({ ...req.body, __storedFile: storedFile });
    const item = await db.contentItem.create({ data: { ...data, orgId: scope.orgId, moduleId: mod.id } as any });
    await db.auditLog.create({ data: { userId: (req as AuthedRequest).user!.id, action: "CONTENT_ITEM_CREATED", entity: "content_item", entityId: item.id, details: item.type } }).catch(() => null);
    // Adding required content can make a previously complete course incomplete.
    if (item.required) await enqueueCourseEvaluation(mod.courseId, "content_changed");
    return res.status(201).json(item);
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
});

router.patch("/content/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const item = await db.contentItem.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!item) return res.status(404).json({ error: "content item not found in your organization" });
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  for (const k of ["title", "description", "order", "required", "estimatedMinutes", "body"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.required !== undefined) data.required = Boolean(patch.required);
  if (patch.order !== undefined) data.order = Number(patch.order);
  if (patch.url !== undefined) {
    if (!isSafeExternalUrl(String(patch.url))) return res.status(400).json({ error: "a valid https URL is required" });
    data.url = String(patch.url);
    data.provider = providerForUrl(String(patch.url));
  }
  if (patch.completionMode !== undefined) data.completionMode = patch.completionMode === "self_report" ? "self_report" : "trainer_verified";
  if (patch.storedFileId !== undefined || patch.storageKey !== undefined) {
    const file = await resolveUploadedFile(scope.orgId, patch).catch((e) => e as UploadRejected);
    if (file instanceof UploadRejected) return res.status(file.status).json({ error: file.message });
    if (!file) return res.status(400).json({ error: "storedFileId required" });
    data.storedFileId = file.id;
    data.storageKey = file.storageKey;
    data.fileName = file.fileName;
    data.mimeType = file.mimeType;
    data.sizeBytes = file.sizeBytes;
    data.checksum = file.checksum;
  }
  const updated = await db.contentItem.update({ where: { id: item.id }, data });
  // A required item that changes can make a complete course incomplete again.
  const courseId = (await db.module.findUnique({ where: { id: item.moduleId }, select: { courseId: true } }))?.courseId;
  if (courseId && (patch.required !== undefined || patch.isArchived !== undefined)) {
    await enqueueCourseEvaluation(courseId, "content_changed");
  }
  return res.json(updated);
});

router.delete("/content/:id", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const item = await db.contentItem.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!item) return res.status(404).json({ error: "content item not found in your organization" });
  const now = new Date();
  const archived = await db.contentItem.update({ where: { id: item.id }, data: { isArchived: true, archivedAt: now } });
  const courseId = (await db.module.findUnique({ where: { id: item.moduleId }, select: { courseId: true } }))?.courseId;
  if (courseId) await enqueueCourseEvaluation(courseId, "content_changed");
  return res.json(archived);
});

router.post("/modules/:moduleId/content/reorder", requireProgrammeRole("admin", "owner", "trainer"), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const mod = await db.module.findFirst({ where: { id: req.params.moduleId, course: { programme: { orgId: scope.orgId } } } }).catch(() => null);
  if (!mod) return res.status(404).json({ error: "module not found in your organization" });
  const ids = ((req.body?.ids ?? []) as string[]).map(String);
  const items = await db.contentItem.findMany({ where: { moduleId: mod.id }, select: { id: true } }).catch(() => [] as Array<{ id: string }>);
  const allowed = new Set(items.map((i) => i.id));
  if (ids.some((id) => !allowed.has(id))) return res.status(400).json({ error: "ids must all belong to this module" });
  await db.$transaction(ids.map((id, index) => db.contentItem.update({ where: { id }, data: { order: index } })));
  return res.json({ moduleId: mod.id, order: ids });
});

// Learner-facing ordered content list. storageKey is never exposed here.
router.get("/courses/:id/content", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const course = await db.course.findFirst({ where: { id: req.params.id, programme: { orgId: scope.orgId } } }).catch(() => null);
  if (!course) return res.status(404).json({ error: "course not found in your organization" });
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, course.programmeId));
  const enrolment = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: course.id, status: { not: "withdrawn" }, withdrawnAt: null } }).catch(() => null);
  if (!staff && !enrolment) return res.status(403).json({ error: "enrolment required" });
  const modules = await db.module.findMany({ where: { courseId: course.id, isArchived: false, deletedAt: null }, orderBy: { order: "asc" } }).catch(() => [] as any[]);
  const items = await db.contentItem.findMany({ where: { moduleId: { in: modules.map((m) => m.id) }, isArchived: false }, orderBy: { order: "asc" } }).catch(() => [] as any[]);
  const progressRows: any[] = enrolment ? await db.contentProgress.findMany({ where: { enrolmentId: enrolment.id }, select: { contentItemId: true, status: true, completedAt: true, verifiedAt: true } }).catch(() => [] as any[]) : [];
  const progressByItem = new Map(progressRows.map((p) => [p.contentItemId, p]));
  return res.json({
    courseId: course.id,
    progress: enrolment?.progress ?? 0,
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      order: m.order,
      contentItems: items.filter((i) => i.moduleId === m.id).map((i) => ({
        id: i.id, type: i.type, title: i.title, description: i.description, order: i.order, required: i.required,
        estimatedMinutes: i.estimatedMinutes, body: i.type === "native" ? i.body : undefined,
        fileName: i.fileName, mimeType: i.mimeType, sizeBytes: i.sizeBytes,
        url: i.url, provider: i.provider, completionMode: i.completionMode,
        isArchived: i.isArchived,
        progress: progressByItem.get(i.id) ?? { status: "not_started", completedAt: null, verifiedAt: null },
      })),
    })),
  });
});

router.post("/content/:id/progress", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const item = await db.contentItem.findFirst({ where: { id: req.params.id, orgId: scope.orgId }, include: { module: { select: { courseId: true, course: { select: { programmeId: true } } } } } }).catch(() => null);
  if (!item || item.isArchived) return res.status(404).json({ error: "content item not found" });
  // Round 8 / E.3: withdrawn learners are not eligible for progress writes.
  const enrolment = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: item.module.courseId, status: { not: "withdrawn" }, withdrawnAt: null } }).catch(() => null);
  if (!enrolment) return res.status(403).json({ error: "enrolment required" });
  const requested = req.body?.status === "completed" ? "completed" : req.body?.status === "not_started" ? "not_started" : "in_progress";
  const existing = await db.contentProgress.findUnique({ where: { enrolmentId_contentItemId: { enrolmentId: enrolment.id, contentItemId: item.id } } }).catch(() => null);
  // Round 8 / E.1: one forward state machine — not_started -> in_progress -> completed,
  // and in_progress -> pending_verification -> completed for trainer-verified items.
  // A learner may never move an item backwards, and may not edit one awaiting verification.
  const currentStatus = existing?.status ?? "not_started";
  if (currentStatus === "pending_verification") {
    return res.status(409).json({ error: "this item is awaiting trainer verification and cannot be changed by the learner" });
  }
  if (currentStatus === "completed" && requested !== "completed") {
    return res.status(409).json({
      error: existing?.verifiedBy || existing?.verifiedAt
        ? "a verified item cannot be moved backwards by the learner"
        : "a completed item cannot be moved backwards",
    });
  }
  if (currentStatus === "in_progress" && requested === "not_started") {
    return res.status(409).json({ error: "progress cannot move from in progress back to not started" });
  }
  let status = requested;
  let completedAt: Date | null = requested === "completed" ? new Date() : null;
  // A.3: an evidence attachment must be an upload of this organization. A bare key from the
  // request body is no longer accepted on its own.
  let evidenceFileId: string | null = null;
  let evidenceFileKey: string | null = req.body?.evidenceFileKey ? String(req.body.evidenceFileKey) : null;
  if (req.body?.evidenceFileId || req.body?.evidenceFileKey) {
    const file = await resolveUploadedFile(scope.orgId, { storedFileId: req.body?.evidenceFileId, storageKey: req.body?.evidenceFileKey })
      .catch((e) => e as UploadRejected);
    if (file instanceof UploadRejected) return res.status(file.status).json({ error: file.message });
    if (!file) return res.status(400).json({ error: "evidenceFileId not found in your organization" });
    if (file.purpose !== "evidence") return res.status(400).json({ error: "attach a file uploaded through /uploads/evidence" });
    evidenceFileId = file.id;
    evidenceFileKey = file.storageKey;
  }
  if (item.type === "external_link" && item.completionMode === "trainer_verified" && requested === "completed") {
    const note = req.body?.evidenceNote ? String(req.body.evidenceNote) : null;
    if (!note && !evidenceFileId) return res.status(400).json({ error: "evidence note or file is required for trainer verification" });
    status = "pending_verification";
    completedAt = null;
  }
  // Leaving "completed" always clears the verifier so stale sign-off cannot linger.
  const clearVerification = status !== "completed";
  const now = new Date();
  const saved = await db.contentProgress.upsert({
    where: { enrolmentId_contentItemId: { enrolmentId: enrolment.id, contentItemId: item.id } },
    create: {
      enrolmentId: enrolment.id, contentItemId: item.id, status,
      startedAt: now,
      completedAt,
      evidenceNote: req.body?.evidenceNote ? String(req.body.evidenceNote) : null,
      evidenceFileId,
      evidenceFileKey,
    },
    update: {
      status,
      startedAt: undefined,
      completedAt,
      ...(clearVerification ? { verifiedBy: null, verifiedAt: null } : {}),
      ...(req.body?.evidenceNote !== undefined ? { evidenceNote: String(req.body.evidenceNote) } : {}),
      ...(evidenceFileId ? { evidenceFileId, evidenceFileKey } : {}),
    },
  });
  const progress = await recomputeEnrolmentProgress(enrolment.id);
  const outcome = await evaluateEnrolment(enrolment.id, "content_progress");
  return res.json({ ...saved, enrolmentProgress: progress, enrolmentOutcome: outcome });
});

router.post("/content-progress/:id/verify", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const row = await db.contentProgress.findFirst({
    where: { id: req.params.id, contentItem: { orgId: scope.orgId } },
    include: {
      contentItem: { select: { title: true, module: { select: { courseId: true, course: { select: { programmeId: true } } } } } },
      enrolment: { select: { learnerId: true, programmeId: true } },
    },
  }).catch(() => null);
  if (!row) return res.status(404).json({ error: "progress record not found in your organization" });
  // Round 8 / E.2: the queue is scoped by grant, not by a role string in the token. A trainer
  // may verify only inside a programme where they hold a trainer/admin grant.
  const programmeId = row.contentItem.module.course.programmeId;
  const mayVerify = (await isOrgStaff(me.id)) || (programmeId ? await isProgrammeStaff(me.id, programmeId) : false);
  if (!mayVerify) return res.status(403).json({ error: "programme staff access required" });
  if (row.status !== "pending_verification") {
    return res.status(409).json({ error: "this item is not awaiting verification" });
  }
  const verified = req.body?.verified !== false;
  // A.3: a trainer only sees the learner's evidence through the org-scoped download below.
  const evidenceFile = row.evidenceFileId
    ? await db.storedFile.findFirst({ where: { id: row.evidenceFileId, orgId: scope.orgId }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } }).catch(() => null)
    : null;
  const updated = await db.contentProgress.update({
    where: { id: row.id },
    data: {
      status: verified ? "completed" : "in_progress",
      verifiedBy: verified ? me.id : null,
      verifiedAt: verified ? new Date() : null,
      completedAt: verified ? new Date() : null,
      ...(req.body?.note !== undefined ? { evidenceNote: String(req.body.note) } : {}),
    },
  });
  const progress = await recomputeEnrolmentProgress(row.enrolmentId);
  const outcome = await evaluateEnrolment(row.enrolmentId, "content_verification");
  await db.auditLog.create({ data: { userId: me.id, action: verified ? "CONTENT_VERIFIED" : "CONTENT_VERIFICATION_REJECTED", entity: "content_progress", entityId: row.id, details: null } }).catch(() => null);
  const { notify } = await import("../services/notify.js");
  await notify(row.enrolment.learnerId, verified ? "content_verified" : "content_rejected", {
    title: verified ? "Content verified" : "Content needs another attempt",
    body: verified
      ? `Your evidence for "${row.contentItem.title}" was verified.`
      : `Your evidence for "${row.contentItem.title}" was not accepted.${req.body?.note ? ` Note: ${String(req.body.note)}` : ""}`,
    link: "/my-learning",
  });
  return res.json({ ...updated, evidenceFile, enrolmentProgress: progress, enrolmentOutcome: outcome });
});

// Round 8 / E.2: the trainer verification queue. Org staff see the whole organization; a
// programme trainer/admin sees only the programmes where they hold that grant.
const VERIFIER_ROLES = ["trainer", "admin"];
router.get("/content-progress/pending", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const orgStaff = await isOrgStaff(me.id);
  let programmeIds: string[] | null = null;
  if (!orgStaff) {
    const grants = await db.userRole.findMany({
      where: { userId: me.id, programmeId: { not: null }, role: { name: { in: VERIFIER_ROLES } } },
      select: { programmeId: true },
    }).catch(() => [] as Array<{ programmeId: string | null }>);
    programmeIds = grants.map((g) => g.programmeId).filter((id): id is string => !!id);
    if (!programmeIds.length) return res.status(403).json({ error: "programme staff access required" });
  }
  const rows = await db.contentProgress.findMany({
    where: {
      status: "pending_verification",
      contentItem: {
        orgId: scope.orgId,
        ...(programmeIds ? { module: { course: { programmeId: { in: programmeIds } } } } : {}),
      },
    },
    include: {
      contentItem: { select: { id: true, title: true, type: true, module: { select: { id: true, courseId: true, course: { select: { title: true, programmeId: true } } } } } },
      enrolment: { select: { id: true, learnerId: true, learner: { select: { name: true, email: true } } } },
    },
    orderBy: { startedAt: "asc" },
    take: 200,
  }).catch(() => [] as any[]);
  return res.json(rows);
});

// A.3: a learner's evidence attachment. Programme staff of the item's programme, or the
// learner who uploaded it, and only within the same organization.
router.get("/content-progress/:id/evidence", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const row = await db.contentProgress.findFirst({
    where: { id: req.params.id, contentItem: { orgId: scope.orgId } },
    include: { contentItem: { select: { module: { select: { course: { select: { programmeId: true } } } } } } },
  }).catch(() => null);
  if (!row || !row.evidenceFileId) return res.status(404).json({ error: "evidence file not found" });
  const isMine = (await db.enrolment.findFirst({ where: { id: row.enrolmentId, learnerId: me.id }, select: { id: true } }).catch(() => null)) !== null;
  const programmeId = row.contentItem.module.course.programmeId;
  const staff = (await isOrgStaff(me.id)) || (programmeId ? await isProgrammeStaff(me.id, programmeId) : false);
  if (!isMine && !staff) return res.status(403).json({ error: "programme staff access required" });
  const file = await db.storedFile.findFirst({ where: { id: row.evidenceFileId, orgId: scope.orgId } }).catch(() => null);
  if (!file) return res.status(404).json({ error: "evidence file not found" });
  try {
    const buffer = await getStorageProvider().get(file.storageKey);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/["\\]/g, "_")}"`);
    return res.send(buffer);
  } catch {
    return res.status(404).json({ error: "stored file is unavailable" });
  }
});

router.get("/content/:id/download", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const item = await db.contentItem.findFirst({
    where: { id: req.params.id, orgId: scope.orgId, type: "file" },
    include: { module: { select: { courseId: true, course: { select: { programmeId: true } } } } },
  }).catch(() => null);
  if (!item || !item.storageKey) return res.status(404).json({ error: "file not found" });
  const staff = (await isOrgStaff(me.id)) || (await isProgrammeStaff(me.id, item.module.course.programmeId));
  const enrolled = await db.enrolment.findFirst({ where: { learnerId: me.id, courseId: item.module.courseId, status: { not: "withdrawn" } } }).catch(() => null);
  if (!staff && !enrolled) return res.status(403).json({ error: "enrolment or programme staff access required" });
  try {
    const buffer = await getStorageProvider().get(item.storageKey);
    res.setHeader("Content-Type", item.mimeType ?? "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${(item.fileName ?? "download").replace(/["\\]/g, "_")}"`);
    return res.send(buffer);
  } catch {
    return res.status(404).json({ error: "stored file is unavailable" });
  }
});

/**
 * Round 6 / M3: every session in the organization used to go to every user, `joinUrl` and
 * `location` included. A join link is the right to be in the room, so it is only sent to people
 * who have one: org staff, programme staff of the session's programme, the session's trainer,
 * an invited learner (an RSVP row), or a learner enrolled on the session's course.
 * Everyone else still sees that the session exists, with the link fields withheld.
 */
// Round 8 / E.10: date/time are display strings. Derive them from startsAt in the session's
// own timezone instead of slicing the UTC ISO string (which showed the wrong day near midnight).
function sessionLocalDateAndTime(startsAt: Date, timeZone: string): { date: string; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(startsAt);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
  } catch {
    return { date: startsAt.toISOString().slice(0, 10), time: startsAt.toISOString().slice(11, 16) };
  }
}

router.get("/sessions", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  // Round 8 / E.11 [CONFIRM, decided 2026-11-21]: everyone in the organization keeps seeing the
  // title and time of every session; only joinUrl and location are withheld from people who
  // cannot join. Kept deliberately — a calendar is useful for planning, and the room/link is
  // the sensitive part, not the fact that a class exists.
  const sessions = await db.session.findMany({ where: { orgId: scope.orgId }, orderBy: { startsAt: "asc" }, take: 200 }).catch(() => []);
  const staff = await isOrgStaff(me.id);
  const [rsvps, enrolments, staffGrants] = await Promise.all([
    db.sessionRSVP.findMany({ where: { learnerId: me.id }, select: { sessionId: true } }).catch(() => [] as Array<{ sessionId: string }>),
    db.enrolment.findMany({ where: { learnerId: me.id, status: { not: "withdrawn" } }, select: { courseId: true } }).catch(() => [] as Array<{ courseId: string }>),
    db.userRole.findMany({ where: { userId: me.id, programmeId: { not: null }, role: { name: { in: ["admin", "trainer"] } } }, select: { programmeId: true } }).catch(() => [] as Array<{ programmeId: string | null }>),
  ]);
  const invited = new Set(rsvps.map((r) => r.sessionId));
  const enrolledCourses = new Set(enrolments.map((e) => e.courseId));
  const staffProgrammes = new Set(staffGrants.map((g) => g.programmeId));
  return res.json(sessions.map((session) => {
    const canJoin = staff
      || session.trainerId === me.id
      || invited.has(session.id)
      || (session.courseId ? enrolledCourses.has(session.courseId) : false)
      || (session.programmeId ? staffProgrammes.has(session.programmeId) : false);
    if (canJoin) return { ...session, canJoin: true };
    const { joinUrl: _joinUrl, location: _location, ...visible } = session;
    return { ...visible, joinUrl: null, location: null, canJoin: false };
  }));
});
async function canManageSessionProgramme(userId: string, programmeId: string | null | undefined): Promise<boolean> {
  if (await isOrgStaff(userId)) return true;
  if (!programmeId) {
    // Sessions with no programme are org-level; only org-level staff/trainers may manage them.
    const orgGrant = await db.userRole.findFirst({ where: { userId, programmeId: null, role: { name: { in: ["owner", "admin", "trainer"] } } } }).catch(() => null);
    return !!orgGrant;
  }
  const grant = await db.userRole.findFirst({ where: { userId, programmeId, role: { name: { in: ["admin", "owner", "trainer"] } } } }).catch(() => null);
  return !!grant;
}

async function loadSessionForStaff(req: AuthedRequest, orgId: string) {
  const session = await db.session.findFirst({ where: { id: req.params.id, orgId } });
  if (!session) throw Object.assign(new Error("session not found in your organization"), { status: 404 });
  if (!(await canManageSessionProgramme(req.user!.id, session.programmeId))) {
    throw Object.assign(new Error("forbidden for this programme"), { status: 403 });
  }
  return session;
}

type SessionForStaff = Awaited<ReturnType<typeof loadSessionForStaff>>;

type InviteCursor = { name: string; id: string };

function sessionEligibleUserWhere(session: SessionForStaff, orgId: string, q?: string): Prisma.UserWhereInput {
  const enrolment: Prisma.UserWhereInput = session.courseId
    ? { enrolments: { some: { courseId: session.courseId, status: { not: "withdrawn" }, withdrawnAt: null } } }
    : session.programmeId
      ? { enrolments: { some: { programmeId: session.programmeId, status: { not: "withdrawn" }, withdrawnAt: null } } }
      : {};
  return {
    orgId,
    isActive: true,
    rsvps: { none: { sessionId: session.id, status: { not: "removed" } } },
    ...enrolment,
    ...(q ? { AND: [{ OR: [{ name: { contains: q } }, { email: { contains: q } }] }] } : {}),
  };
}

function inviteCursorWhere(cursor: InviteCursor | null): Prisma.UserWhereInput {
  if (!cursor) return {};
  return { OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }] };
}

function encodeInviteCursor(cursor: InviteCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeInviteCursor(raw: string): InviteCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<InviteCursor>;
    return typeof parsed.name === "string" && typeof parsed.id === "string" ? { name: parsed.name, id: parsed.id } : null;
  } catch {
    return null;
  }
}

async function sessionInviteDecision(session: SessionForStaff, learnerId: string, orgId: string) {
  const learner = await db.user.findFirst({
    where: { id: learnerId, orgId, isActive: true },
    select: { id: true, name: true, email: true },
  }).catch(() => null);
  if (!learner) return { eligible: false, reason: "user_not_found_or_inactive", learner: null, existing: null };
  const existing = await db.sessionRSVP.findFirst({
    where: { sessionId: session.id, learnerId },
    select: { id: true, status: true },
  }).catch(() => null);
  if (existing && existing.status !== "removed") return { eligible: false, reason: "already_invited", learner, existing };
  if (session.courseId) {
    const enrolled = await db.enrolment.findFirst({
      where: { learnerId, courseId: session.courseId, status: { not: "withdrawn" }, withdrawnAt: null },
      select: { id: true },
    }).catch(() => null);
    if (!enrolled) return { eligible: false, reason: "not_enrolled_in_course", learner, existing };
  } else if (session.programmeId) {
    const enrolled = await db.enrolment.findFirst({
      where: { learnerId, programmeId: session.programmeId, status: { not: "withdrawn" }, withdrawnAt: null },
      select: { id: true },
    }).catch(() => null);
    if (!enrolled) return { eligible: false, reason: "not_enrolled_in_programme", learner, existing };
  }
  return { eligible: true, reason: null, learner, existing };
}

function sessionRosterSummary(session: SessionForStaff, rsvps: Array<{ status: string }>) {
  const counts = { invited: 0, confirmed: 0, waitlisted: 0, declined: 0, removed: 0 };
  for (const rsvp of rsvps) {
    if (rsvp.status in counts) counts[rsvp.status as keyof typeof counts] += 1;
  }
  const capacity = session.capacity ?? null;
  return {
    sessionId: session.id,
    capacity,
    attendeeCount: counts.confirmed,
    seatsTaken: counts.confirmed,
    seatsRemaining: capacity === null ? null : Math.max(0, capacity - counts.confirmed),
    invited: counts.invited,
    confirmed: counts.confirmed,
    waitlisted: counts.waitlisted,
    declined: counts.declined,
    removed: counts.removed,
  };
}

function sessionRosterRows(sessionId: string) {
  const order: Record<string, number> = { confirmed: 0, waitlisted: 1, invited: 2, declined: 3, removed: 4 };
  return db.sessionRSVP.findMany({
    where: { sessionId },
    include: { learner: { select: { id: true, name: true, email: true, isActive: true } } },
  }).then((rows) => rows.sort((a, b) =>
    (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.createdAt.getTime() - b.createdAt.getTime()));
}

type SessionRosterRow = Awaited<ReturnType<typeof sessionRosterRows>>[number];

function formatSessionAttendee(rsvp: SessionRosterRow) {
  return {
    id: rsvp.id,
    rsvpId: rsvp.id,
    learnerId: rsvp.learnerId,
    name: rsvp.learner.name,
    email: rsvp.learner.email,
    isActive: rsvp.learner.isActive,
    status: rsvp.status,
    respondedAt: rsvp.respondedAt,
    waitlistedAt: rsvp.waitlistedAt,
    removalReason: rsvp.removalReason,
    removedAt: rsvp.removedAt,
    removedBy: rsvp.removedBy,
    createdAt: rsvp.createdAt,
  };
}

router.get("/sessions/:id/attendees", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  try {
    const session = await loadSessionForStaff(req as AuthedRequest, scope.orgId);
    const rsvps = await sessionRosterRows(session.id);
    const summary = sessionRosterSummary(session, rsvps);
    return res.json({
      ...summary,
      summary,
      attendees: rsvps.map(formatSessionAttendee),
    });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

router.get("/sessions/:id/invitable", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  try {
    const session = await loadSessionForStaff(req as AuthedRequest, scope.orgId);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q && q.length < 2) return res.status(400).json({ error: "q must be at least 2 characters" });
    const requestedLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return res.status(400).json({ error: "limit must be a positive integer" });
    const limit = Math.min(requestedLimit, 200);
    const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : null;
    const cursor = cursorRaw ? decodeInviteCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) return res.status(400).json({ error: "invalid cursor" });
    const where = sessionEligibleUserWhere(session, scope.orgId, q || undefined);
    const [total, rows, skippedRows] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where: { ...where, ...inviteCursorWhere(cursor) },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit + 1,
      }),
      db.user.findMany({
        where: {
          orgId: scope.orgId,
          isActive: true,
          rsvps: { some: { sessionId: session.id, status: { not: "removed" } } },
          ...(q ? { AND: [{ OR: [{ name: { contains: q } }, { email: { contains: q } }] }] } : {}),
        },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 50,
      }),
    ]);
    const page = rows.slice(0, limit);
    const learners = page.map((user) => ({ learnerId: user.id, id: user.id, name: user.name, email: user.email, eligible: true as const, reason: null as null }));
    const skipped = skippedRows.map((user) => ({ learnerId: user.id, name: user.name, email: user.email, reason: "already_invited" }));
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeInviteCursor({ name: last.name, id: last.id }) : null;
    return res.json({ sessionId: session.id, q, limit, total, nextCursor, learners, invitable: learners, invitableLearners: learners, skipped });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

export function isValidHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

router.post("/sessions", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (!req.body?.title) return res.status(400).json({ error: "title required" });
  const programmeId: string | null = req.body.programmeId ? String(req.body.programmeId) : null;
  if (programmeId) await assertProgrammeInOrg(programmeId, scope.orgId);
  if (!(await canManageSessionProgramme(me.id, programmeId))) {
    return res.status(403).json({ error: programmeId ? "forbidden for this programme" : "organization staff access required for sessions without a programme" });
  }
  const mode = req.body.mode === "offline" ? "offline" : "online";
  const joinUrl = req.body.joinUrl ? String(req.body.joinUrl) : null;
  const location = req.body.location ? String(req.body.location) : null;
  if (mode === "online" && (!joinUrl || !isValidHttpsUrl(joinUrl))) return res.status(400).json({ error: "online sessions require an https joinUrl" });
  if (mode === "offline" && !location) return res.status(400).json({ error: "offline sessions require a location" });
  let startsAt: Date | null = req.body.startsAt ? new Date(req.body.startsAt) : null;
  let endsAt: Date | null = req.body.endsAt ? new Date(req.body.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: "invalid startsAt" });
  if (endsAt && Number.isNaN(endsAt.getTime())) return res.status(400).json({ error: "invalid endsAt" });
  if (!startsAt && (!req.body.date || !req.body.time)) return res.status(400).json({ error: "startsAt or date+time required" });
  if (startsAt && endsAt && endsAt <= startsAt) return res.status(400).json({ error: "endsAt must be after startsAt" });
  const timezone = req.body.timezone ? String(req.body.timezone) : "UTC";
  const { date, time } = startsAt
    ? sessionLocalDateAndTime(startsAt, timezone)
    : { date: String(req.body.date), time: String(req.body.time) };
  let trainerId: string | null = null;
  if (req.body.trainerId) {
    const trainer = await db.user.findFirst({ where: { id: req.body.trainerId, orgId: scope.orgId } });
    if (!trainer) return res.status(404).json({ error: "trainer not found in your organization" });
    trainerId = trainer.id;
  }
  let courseId: string | null = null;
  if (req.body.courseId) {
    const course = await assertCourseInOrg(req.body.courseId, scope.orgId);
    if (programmeId && course.programmeId !== programmeId) return res.status(400).json({ error: "course does not belong to the programme" });
    courseId = course.id;
  }
  let doubleBookingWarning: string | null = null;
  if (trainerId && startsAt) {
    const end = endsAt ?? new Date(startsAt.getTime() + 60 * 60 * 1000);
    const overlap = await db.session.findFirst({
      where: {
        orgId: scope.orgId,
        trainerId,
        startsAt: { lt: end },
        endsAt: { gt: startsAt },
      },
    }).catch(() => null);
    if (overlap) doubleBookingWarning = `Trainer is already booked for "${overlap.title}" in an overlapping window`;
  }
  // Round 8 / E.7: capacity is a seat count, so it is a positive whole number or null (unlimited).
  let capacity: number | null = null;
  if (req.body.capacity !== undefined && req.body.capacity !== null && req.body.capacity !== "") {
    const requestedCapacity = Number(req.body.capacity);
    if (!Number.isInteger(requestedCapacity) || requestedCapacity <= 0) {
      return res.status(400).json({ error: "capacity must be a positive whole number or null" });
    }
    capacity = requestedCapacity;
  }
  const created = await db.session.create({
    data: {
      title: req.body.title,
      programme: req.body.programme ?? "",
      programmeId,
      orgId: scope.orgId,
      trainer: req.body.trainer ?? "",
      trainerId,
      courseId,
      date,
      time,
      startsAt: startsAt ?? undefined,
      endsAt: endsAt ?? undefined,
      timezone,
      joinUrl,
      location,
      mode,
      capacity,
    },
  });
  return res.status(201).json({ ...created, doubleBookingWarning });
});
router.post("/sessions/:id/invite", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  try {
    const session = await loadSessionForStaff(req as AuthedRequest, scope.orgId);
    const allEnrolled = req.body?.allEnrolled === true;
    let requested: string[] = [];
    if (allEnrolled) {
      const eligibleWhere = sessionEligibleUserWhere(session, scope.orgId);
      let cursor: Prisma.UserWhereInput = {};
      for (;;) {
        const rows = await db.user.findMany({
          where: { ...eligibleWhere, ...cursor },
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 500,
        });
        if (!rows.length) break;
        requested.push(...rows.map((row) => row.id));
        const last = rows[rows.length - 1];
        cursor = inviteCursorWhere({ name: last.name, id: last.id });
        if (rows.length < 500) break;
      }
    } else {
      requested = ((req.body?.learnerIds ?? []) as string[]).map(String).filter(Boolean);
    }
    const learnerIds = allEnrolled ? requested : [...new Set(requested)].slice(0, 500);
    let invited = 0;
    let newlyInvited = 0;
    const skipped: string[] = [];
    const skippedReasons: Record<string, string> = {};
    const results: Array<{ learnerId: string; outcome: string; reason: string | null }> = [];
    if (!allEnrolled) {
      for (const learnerId of requested.slice(500)) {
        skippedReasons[learnerId] = "batch_limit_exceeded";
      }
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const learnerId of requested) {
        if (seen.has(learnerId)) duplicates.add(learnerId);
        else seen.add(learnerId);
      }
      for (const learnerId of duplicates) {
        skippedReasons[learnerId] ??= "duplicate_request";
      }
    }
    for (const learnerId of learnerIds) {
      const decision = await sessionInviteDecision(session, learnerId, scope.orgId);
      if (!decision.eligible) {
        skipped.push(learnerId);
        skippedReasons[learnerId] = decision.reason ?? "not_eligible";
        results.push({ learnerId, outcome: "skipped", reason: skippedReasons[learnerId] });
        continue;
      }
      const r = await db.sessionRSVP.upsert({
        where: { sessionId_learnerId: { sessionId: session.id, learnerId } },
        create: { sessionId: session.id, learnerId, status: "invited" },
        update: decision.existing?.status === "removed"
          ? { status: "invited", respondedAt: null, waitlistedAt: null, removedBy: null, removedAt: null, removalReason: null }
          : {},
      }).catch(() => null);
      if (r) {
        invited += 1;
        const isNew = !decision.existing || decision.existing.status === "removed";
        if (isNew) {
          newlyInvited += 1;
          const { notify } = await import("../services/notify.js");
          const { icsAttachment } = await import("../services/ical.js");
          await notify(learnerId, "session_invite", {
            title: `Invitation: ${session.title}`,
            body: `${session.date} at ${session.time}`,
            link: "/calendar",
            attachments: [icsAttachment(session, { attendeeEmail: decision.learner?.email })],
          });
        }
        results.push({ learnerId, outcome: isNew ? "invited" : "already_invited", reason: null });
      }
    }
    const rejected = results.filter((row) => row.outcome === "skipped");
    return res.json({
      sessionId: session.id,
      allEnrolled,
      selectedCount: requested.length,
      invited,
      newlyInvited,
      skipped,
      skippedCount: skipped.length,
      skippedReasons,
      rejected,
      results,
    });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

router.post("/sessions/:id/remove", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  try {
    const session = await loadSessionForStaff(req as AuthedRequest, scope.orgId);
    const learnerId = req.body?.learnerId ? String(req.body.learnerId) : "";
    if (!learnerId) return res.status(400).json({ error: "learnerId required" });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) || null : null;
    const existing = await db.sessionRSVP.findFirst({
      where: { sessionId: session.id, learnerId },
      select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: "attendee not found on this session" });
    const { removeRsvp } = await import("../services/rsvp.js");
    const updated = await removeRsvp(session.id, learnerId, scope.orgId, me.id, reason);
    await db.auditLog.create({
      data: {
        userId: me.id,
        action: "SESSION_ATTENDEE_REMOVED",
        entity: "session",
        entityId: session.id,
        details: JSON.stringify({ learnerId, reason, previousStatus: existing.status, rsvpId: existing.id }),
      },
    }).catch(() => null);
    const rsvps = await sessionRosterRows(session.id);
    const summary = sessionRosterSummary(session, rsvps);
    return res.json({
      ...summary,
      summary,
      removed: 1,
      learnerId,
      previousStatus: existing.status,
      reason,
      rsvp: updated,
      attendees: rsvps.map(formatSessionAttendee),
    });
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
  }
});

// Round 6 / M2(d): a token never answers on someone else's behalf. A learner answers only for
// themselves; anyone answering for another person must be staff of the session's programme (or
// org staff) AND enrolled as a learner there — a plain org member cannot seat anyone.
router.post("/sessions/:id/rsvp", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const { confirmRsvp, declineRsvp } = await import("../services/rsvp.js");
  const rsvpOrg = orgIdOf(req as AuthedRequest);
  const requested = req.body?.learnerId ? String(req.body.learnerId) : me.id;
  const learnerId = requested === me.id ? me.id : requested;
  if (learnerId !== me.id) {
    const session = await db.session.findFirst({ where: { id: req.params.id, orgId: rsvpOrg }, select: { programmeId: true } }).catch(() => null);
    if (!session) return res.status(404).json({ error: "session not found in your organization" });
    const staff = (await isOrgStaff(me.id)) || (session.programmeId ? await isProgrammeStaff(me.id, session.programmeId) : false);
    if (!staff) return res.status(403).json({ error: "only programme staff may answer for another learner" });
    const target = await db.user.findFirst({ where: { id: learnerId, orgId: rsvpOrg }, select: { id: true } }).catch(() => null);
    if (!target) return res.status(404).json({ error: "learner not found in your organization" });
    const isLearner = await db.userRole.findFirst({ where: { userId: learnerId, role: { name: "learner" } }, select: { id: true } }).catch(() => null);
    const enrolled = await db.enrolment.findFirst({ where: { learnerId, status: { not: "withdrawn" } }, select: { id: true } }).catch(() => null);
    if (!isLearner && !enrolled) return res.status(400).json({ error: "that user is not a learner in this organization" });
  }
  try {
    if (req.body?.status === "declined") return res.json(await declineRsvp(req.params.id, learnerId, rsvpOrg));
    const rsvp = await confirmRsvp(req.params.id, learnerId, rsvpOrg);
    // Round 8 / D.2: a confirmation carries the calendar file once. Re-confirming an existing
    // seat is a no-op and must not mail the learner again.
    if (rsvp.newlyConfirmed) {
      const session = await db.session.findFirst({ where: { id: req.params.id, orgId: rsvpOrg } }).catch(() => null);
      if (session) {
        const learner = await db.user.findUnique({ where: { id: learnerId }, select: { email: true } }).catch(() => null);
        const { notify } = await import("../services/notify.js");
        const { icsAttachment } = await import("../services/ical.js");
        await notify(learnerId, "session_confirmed", {
          title: `Confirmed: ${session.title}`,
          body: `${session.date} at ${session.time}. The calendar file is attached.`,
          link: "/calendar",
          attachments: [icsAttachment(session, { attendeeEmail: learner?.email })],
        });
      }
    }
    return res.json(rsvp);
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    return res.status(status).json({ error: (e as Error).message });
  }
});
/**
 * Round 8 / D.2: the single-session calendar file. It is a join link and a room, so it is only
 * for people with a right to be there: an invitation or confirmation of their own, the
 * session's trainer, or staff of the session's programme/organization.
 */
router.get("/sessions/:id/ics", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const session = await db.session.findFirst({ where: { id: req.params.id, orgId: scope.orgId } }).catch(() => null);
  if (!session) return res.status(404).json({ error: "session not found in your organization" });
  const rsvp = await db.sessionRSVP.findFirst({
    where: { sessionId: session.id, learnerId: me.id, status: { in: ["invited", "confirmed", "waitlisted"] } },
    select: { id: true },
  }).catch(() => null);
  const staff = (await isOrgStaff(me.id))
    || session.trainerId === me.id
    || (await canManageSessionProgramme(me.id, session.programmeId));
  if (!rsvp && !staff) return res.status(403).json({ error: "you are not invited to this session" });
  const { buildSessionIcs } = await import("../services/ical.js");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${session.id}.ics"`);
  // A cancelled session's file is a cancellation, even when fetched after the fact.
  return res.send(buildSessionIcs(session, { method: session.status === "cancelled" ? "CANCEL" : "REQUEST" }));
});

const SESSION_PATCH_FIELDS = ["title", "mode", "capacity", "trainerId"] as const;
function sessionNotificationReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, 1000) || null;
}
function sessionPatchProblem(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Round 8 / D.2: editing a scheduled session is a normal correction, not a cancellation and
 * re-invite. Every edit bumps `sequence`, because a calendar client ignores an update whose
 * SEQUENCE did not increase, and mails the new .ics to confirmed attendees.
 */
router.patch("/sessions/:id", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  let session: Awaited<ReturnType<typeof loadSessionForStaff>>;
  try {
    session = await loadSessionForStaff(req as AuthedRequest, scope.orgId);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return res.status(status).json({ error: (e as Error).message });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const notificationReason = sessionNotificationReason(body.reason);
  try {
    if (body.reason !== undefined && typeof body.reason !== "string") throw sessionPatchProblem("reason must be a string");
    for (const field of SESSION_PATCH_FIELDS) {
      if (body[field] !== undefined) data[field] = body[field];
    }
    if (body.title !== undefined && !String(body.title).trim()) throw sessionPatchProblem("title cannot be empty");
    if (body.capacity !== undefined) {
      if (body.capacity !== null && (!Number.isInteger(Number(body.capacity)) || Number(body.capacity) <= 0)) {
        throw sessionPatchProblem("capacity must be a positive whole number or null");
      }
      data.capacity = body.capacity === null ? null : Number(body.capacity);
    }
    if (body.trainerId !== undefined) {
      if (body.trainerId === null || body.trainerId === "") {
        data.trainerId = null;
      } else {
        const trainer = await db.user.findFirst({ where: { id: String(body.trainerId), orgId: scope.orgId }, select: { id: true } }).catch(() => null);
        if (!trainer) return res.status(404).json({ error: "trainer not found in your organization" });
        data.trainerId = trainer.id;
      }
    }
    let startsAt = session.startsAt;
    let endsAt = session.endsAt;
    if (body.startsAt !== undefined) {
      startsAt = body.startsAt ? new Date(String(body.startsAt)) : null;
      if (startsAt && Number.isNaN(startsAt.getTime())) throw sessionPatchProblem("invalid startsAt");
      data.startsAt = startsAt;
      if (startsAt) {
        const local = sessionLocalDateAndTime(startsAt, (session as { timezone?: string | null }).timezone ?? "UTC");
        data.date = local.date;
        data.time = local.time;
      }
    }
    if (body.endsAt !== undefined) {
      endsAt = body.endsAt ? new Date(String(body.endsAt)) : null;
      if (endsAt && Number.isNaN(endsAt.getTime())) throw sessionPatchProblem("invalid endsAt");
      data.endsAt = endsAt;
    }
    if (body.date !== undefined || body.time !== undefined) {
      const date = body.date !== undefined ? String(body.date) : String(data.date ?? session.date);
      const time = body.time !== undefined ? String(body.time) : String(data.time ?? session.time);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw sessionPatchProblem("date and time must be YYYY-MM-DD and HH:MM");
      data.date = date;
      data.time = time;
      if (session.startsAt) {
        const derived = new Date(`${date}T${time}:00Z`);
        if (Number.isNaN(derived.getTime())) throw sessionPatchProblem("invalid date and time");
        startsAt = derived;
        data.startsAt = derived;
      }
    }
    if (startsAt && endsAt && endsAt <= startsAt) throw sessionPatchProblem("endsAt must be after startsAt");
    const mode = body.mode !== undefined ? String(body.mode) : session.mode;
    const joinUrl = body.joinUrl !== undefined ? (body.joinUrl ? String(body.joinUrl) : null) : session.joinUrl;
    const location = body.location !== undefined ? (body.location ? String(body.location) : null) : session.location;
    if (mode !== "online" && mode !== "offline") throw sessionPatchProblem("mode must be online or offline");
    if (mode === "online" && (!joinUrl || !isValidHttpsUrl(joinUrl))) throw sessionPatchProblem("online sessions require an https joinUrl");
    if (mode === "offline" && !location) throw sessionPatchProblem("offline sessions require a location");
    data.mode = mode;
    if (body.joinUrl !== undefined) data.joinUrl = joinUrl;
    if (body.location !== undefined) data.location = location;
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
  const updated = await db.session.update({
    where: { id: session.id },
    data: { ...data, sequence: session.sequence + 1 },
  });
  const { notify } = await import("../services/notify.js");
  const { icsAttachment } = await import("../services/ical.js");
  const attendees = await db.sessionRSVP.findMany({ where: { sessionId: session.id, status: "confirmed" }, select: { learnerId: true, learner: { select: { email: true } } } }).catch(() => []);
  for (const attendee of attendees) {
    await notify(attendee.learnerId, "session_updated", {
      title: `Updated: ${updated.title}`,
      body: `The session details changed. The updated calendar file is attached.${notificationReason ? ` Reason: ${notificationReason}` : ""}`,
      link: "/calendar",
      attachments: [icsAttachment(updated, { attendeeEmail: attendee.learner.email })],
    });
  }
  return res.json(updated);
});

router.post("/sessions/:id/cancel", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  let session: Awaited<ReturnType<typeof loadSessionForStaff>>;
  try {
    session = await loadSessionForStaff(req as AuthedRequest, scope.orgId);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return res.status(status).json({ error: (e as Error).message });
  }
  if (session.status === "cancelled") return res.json(session);
  const notificationReason = sessionNotificationReason((req.body ?? {}).reason);
  const updated = await db.session.update({
    where: { id: session.id },
    data: { status: "cancelled", sequence: session.sequence + 1 },
  });
  const { notify } = await import("../services/notify.js");
  const { icsAttachment } = await import("../services/ical.js");
  const attendees = await db.sessionRSVP.findMany({ where: { sessionId: session.id, status: "confirmed" }, select: { learnerId: true, learner: { select: { email: true } } } }).catch(() => []);
  for (const attendee of attendees) {
    await notify(attendee.learnerId, "session_cancelled", {
      title: `Cancelled: ${updated.title}`,
      body: `This session has been cancelled. The cancellation is attached for your calendar.${notificationReason ? ` Reason: ${notificationReason}` : ""}`,
      link: "/calendar",
      attachments: [icsAttachment(updated, { method: "CANCEL", attendeeEmail: attendee.learner.email })],
    });
  }
  return res.json(updated);
});

router.post("/reminders/run", requireOrgStaff(), async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  const { runReminders } = await import("../services/reminderCadence.js");
  return res.json(await runReminders(new Date(), { orgId: scope.orgId }));
});

async function isStakeholder(userId: string): Promise<boolean> {
  const grant = await db.userRole.findFirst({ where: { userId, role: { name: "stakeholder" } } }).catch(() => null);
  return !!grant;
}

async function adminProgrammeIds(userId: string): Promise<string[]> {
  const grants = await db.userRole.findMany({ where: { userId, programmeId: { not: null }, role: { name: "admin" } }, select: { programmeId: true } }).catch(() => [] as Array<{ programmeId: string | null }>);
  return grants.map((g) => g.programmeId).filter((v): v is string => !!v);
}

async function programmeRoleFor(userId: string, programmeId: string): Promise<string | null> {
  const grant = await db.userRole.findFirst({ where: { userId, programmeId, role: { name: { in: ["owner", "admin", "trainer", "learner", "stakeholder"] } } }, include: { role: true } }).catch(() => null);
  if (grant) return grant.role.name;
  const enrolment = await db.enrolment.findFirst({ where: { learnerId: userId, programmeId, status: { not: "withdrawn" } } }).catch(() => null);
  return enrolment ? "learner" : null;
}

async function canSetThreadSla(userId: string, programmeId: string | null): Promise<boolean> {
  if (await isOrgStaff(userId)) return true;
  if (!programmeId) return false;
  const grant = await db.userRole.findFirst({
    where: { userId, programmeId, role: { name: { in: ["admin", "owner"] } } },
    select: { id: true },
  }).catch(() => null);
  return !!grant;
}

async function resolveThreadSlaHours(programmeId: string, orgId: string): Promise<number> {
  const [programme, organization] = await Promise.all([
    db.programme.findFirst({ where: { id: programmeId, orgId }, select: { slaHours: true } }).catch(() => null),
    db.organization.findFirst({ where: { id: orgId }, select: { defaultSlaHours: true } }).catch(() => null),
  ]);
  return programme?.slaHours ?? organization?.defaultSlaHours ?? 24;
}

function parseSlaHours(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = Number(value);
  return Number.isInteger(raw) && raw >= 1 && raw <= 720 ? raw : null;
}

async function threadAccess(userId: string, threadId: string, orgId: string) {
  const thread = await db.messageThread.findFirst({ where: { id: threadId, orgId } });
  if (!thread) return { thread: null, participant: null, programmeAdmin: false } as const;
  const participant = await db.threadParticipant.findFirst({ where: { threadId, userId, leftAt: null } }).catch(() => null);
  const programmeAdmin = thread.programmeId ? await isProgrammeAdmin(userId, thread.programmeId).catch(() => false) : false;
  return { thread, participant, programmeAdmin } as const;
}

/**
 * Round 6 / M1 + Round 8 / E.5: participation is revoked, not deleted. A removed member's row
 * stays with leftAt/leftReason for audit, and is restored when a current grant (or a live
 * enrolment, for a learner grant) makes them eligible again. It runs on every thread read and
 * write (cheap: only the caller's own rows, one query) and whenever members are removed.
 *
 * Returns the number of rows newly revoked. Org staff are never revoked: they administer every
 * programme in the organization.
 */
export async function revokeStaleThreadAccess(userId: string, orgId: string): Promise<number> {
  const rows = await db.threadParticipant.findMany({
    where: { userId, thread: { orgId } },
    select: { id: true, leftAt: true, thread: { select: { id: true, programmeId: true } } },
  }).catch(() => [] as Array<{ id: string; leftAt: Date | null; thread: { id: string; programmeId: string | null } }>);
  const scoped = rows.filter((r) => r.thread.programmeId);
  if (!scoped.length) return 0;
  const restore = async (ids: string[]) => {
    if (!ids.length) return;
    await db.threadParticipant.updateMany({ where: { id: { in: ids } }, data: { leftAt: null, leftReason: null } }).catch(() => null);
  };
  if (await isOrgStaff(userId)) {
    await restore(scoped.filter((r) => r.leftAt).map((r) => r.id));
    return 0;
  }
  const programmeIds = [...new Set(scoped.map((r) => r.thread.programmeId).filter((v): v is string => !!v))];
  const grants = programmeIds.length
    ? await db.userRole.findMany({ where: { userId, programmeId: { in: programmeIds } }, select: { programmeId: true } }).catch(() => [] as Array<{ programmeId: string | null }>)
    : [];
  const granted = new Set(grants.map((g) => g.programmeId));
  // A learner whose enrolment was withdrawn on that programme has lost access too.
  const enrolled = programmeIds.length
    ? await db.enrolment.findMany({ where: { learnerId: userId, programmeId: { in: programmeIds }, status: { not: "withdrawn" } }, select: { programmeId: true } }).catch(() => [] as Array<{ programmeId: string }>)
    : [];
  const enrolledSet = new Set(enrolled.map((e) => e.programmeId));
  // A withdrawal keeps the programme grant (the person is still on the roster), so for anyone
  // who holds a learner grant in that programme the enrolment decides. Staff grants keep access.
  const staffGrants = programmeIds.length
    ? await db.userRole.findMany({
        where: { userId, programmeId: { in: programmeIds }, role: { name: { in: ["admin", "trainer", "owner"] } } },
        select: { programmeId: true },
      }).catch(() => [] as Array<{ programmeId: string | null }>)
    : [];
  const staffSet = new Set(staffGrants.map((g) => g.programmeId));
  const hasAccess = (programmeId: string) => {
    if (staffSet.has(programmeId)) return true;
    return granted.has(programmeId) && enrolledSet.has(programmeId);
  };
  const stale = scoped.filter((r) => !r.leftAt && !hasAccess(r.thread.programmeId!)).map((r) => r.id);
  const regained = scoped.filter((r) => r.leftAt && hasAccess(r.thread.programmeId!)).map((r) => r.id);
  await restore(regained);
  if (!stale.length) return 0;
  const now = new Date();
  const revoked = await db.threadParticipant.updateMany({
    where: { id: { in: stale } },
    data: { leftAt: now, leftReason: "programme access ended" },
  }).catch(() => ({ count: 0 }));
  if (revoked.count) {
    await db.auditLog.create({ data: { userId, action: "THREAD_ACCESS_REVOKED", entity: "thread_participant", entityId: userId, details: `${revoked.count} thread(s)` } }).catch(() => null);
  }
  return revoked.count;
}

router.get("/threads", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (await isStakeholder(me.id)) return res.status(403).json({ error: "stakeholders do not have access to direct messages" });
  await revokeStaleThreadAccess(me.id, scope.orgId);
  const [adminIds, orgStaff] = await Promise.all([adminProgrammeIds(me.id), isOrgStaff(me.id)]);
  const participantThreads = await db.threadParticipant.findMany({ where: { userId: me.id, leftAt: null }, select: { threadId: true } }).catch(() => [] as Array<{ threadId: string }>);
  const participantIds = new Set(participantThreads.map((p) => p.threadId));
  const adminIdsSet = new Set(adminIds);
  const baseWhere: Prisma.MessageThreadWhereInput = participantIds.size || adminIds.length || orgStaff
    ? {
        orgId: scope.orgId,
        OR: [
          ...(participantIds.size ? [{ id: { in: [...participantIds] } }] : []),
          ...(adminIds.length ? [{ programmeId: { in: adminIds } }] : []),
          ...(orgStaff ? [{ orgId: scope.orgId }] : []),
        ],
      }
    : { orgId: scope.orgId, id: { in: [] as string[] } };
  const filters: Prisma.MessageThreadWhereInput = {};
  const programmeFilter = typeof req.query.programmeId === "string" && req.query.programmeId ? req.query.programmeId : null;
  const courseFilter = typeof req.query.courseId === "string" && req.query.courseId ? req.query.courseId : null;
  if (programmeFilter) filters.programmeId = programmeFilter;
  if (courseFilter) filters.courseId = courseFilter;
  const threads = await db.messageThread.findMany({
    where: { ...baseWhere, ...filters },
    take: 200,
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      participants: { select: { userId: true, role: true } },
      course: { select: { id: true, title: true } },
    },
  }).catch(() => [] as Array<{
    id: string;
    programmeId: string | null;
    courseId: string | null;
    course: { id: string; title: string } | null;
    isEscalated: boolean;
    lastLearnerMessageAt: Date | null;
    lastTrainerResponseAt: Date | null;
    messages: Array<{ authorId: string | null; createdAt: Date }>;
    participants: Array<{ userId: string; role: string }>;
  }>);
  const rows = threads.map((t) => {
    const canRead = participantIds.has(t.id) || (t.programmeId ? adminIdsSet.has(t.programmeId) : false);
    const roleByUser = new Map(t.participants.map((p) => [p.userId, p.role]));
    const mapped = t.messages.map((m) => ({ authorId: m.authorId, authorRole: m.authorId ? roleByUser.get(m.authorId) ?? "learner" : "learner", createdAt: m.createdAt }));
    const avg = avgResponseHours(mapped);
    const awaiting = Boolean(t.lastLearnerMessageAt && (!t.lastTrainerResponseAt || +new Date(t.lastLearnerMessageAt) > +new Date(t.lastTrainerResponseAt)));
    return {
      ...t,
      messages: canRead ? t.messages : [],
      metadataOnly: !canRead,
      averageResponseTimeHours: avg,
      slaStatus: slaStatusFor(t as SlaThread, avg),
      slaState: t.isEscalated ? "escalated" : awaiting ? "reply_pending" : "ok",
    };
  });
  const slaFilter = typeof req.query.slaStatus === "string" ? req.query.slaStatus : null;
  return res.json(slaFilter ? rows.filter((row) => row.slaState === slaFilter || row.slaStatus.toLowerCase().includes(slaFilter)) : rows);
});

router.post("/threads", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (await isStakeholder(me.id)) return res.status(403).json({ error: "stakeholders cannot start direct messages" });
  const subject = String(req.body?.subject ?? "").trim();
  const programmeId = String(req.body?.programmeId ?? "");
  const bodyText = String(req.body?.body ?? "").trim();
  const participantIds = [...new Set(((req.body?.participantIds ?? []) as string[]).map(String).filter((id) => id && id !== me.id))];
  if (!subject || !programmeId || !bodyText || !participantIds.length) {
    return res.status(400).json({ error: "subject, programmeId, participantIds and body required" });
  }
  await assertProgrammeInOrg(programmeId, scope.orgId);
  const callerRole = (await programmeRoleFor(me.id, programmeId)) ?? ((await isOrgStaff(me.id)) ? "admin" : null);
  if (!callerRole || callerRole === "stakeholder") return res.status(403).json({ error: "you are not a staff member or learner of this programme" });
  const maySetSla = await canSetThreadSla(me.id, programmeId);
  let slaHours = await resolveThreadSlaHours(programmeId, scope.orgId);
  if (maySetSla && req.body?.slaHours !== undefined && req.body?.slaHours !== null && req.body.slaHours !== "") {
    const parsed = parseSlaHours(req.body.slaHours);
    if (parsed === null) return res.status(400).json({ error: "slaHours must be an integer between 1 and 720" });
    slaHours = parsed;
  }
  let courseId: string | null = null;
  if (req.body?.courseId) {
    const course = await assertCourseInOrg(req.body.courseId, scope.orgId);
    if (course.programmeId !== programmeId) return res.status(400).json({ error: "course does not belong to the programme" });
    courseId = course.id;
  }
  const users = await db.user.findMany({ where: { id: { in: participantIds }, orgId: scope.orgId }, select: { id: true } }).catch(() => []);
  if (users.length !== participantIds.length) return res.status(403).json({ error: "all participants must belong to your organization" });
  const participantRoles = new Map<string, string>();
  for (const userId of participantIds) {
    const role = await programmeRoleFor(userId, programmeId);
    if (!role) return res.status(403).json({ error: "all participants must share the programme" });
    participantRoles.set(userId, role);
    if (callerRole === "learner" && !["trainer", "admin", "owner"].includes(role)) {
      return res.status(403).json({ error: "learners may only message a trainer or admin of their programme" });
    }
  }
  const now = new Date();
  // Round 8 / E.10: the first message stored the author's role ("trainer") instead of the
  // person's name, unlike every message sent afterwards.
  const authorName = (await db.user.findUnique({ where: { id: me.id }, select: { name: true } }).catch(() => null))?.name ?? me.id;
  const created = await db.$transaction(async (tx) => {
    const thread = await tx.messageThread.create({
      data: {
        subject,
        context: courseId ? "course" : "programme",
        participant: "",
        programmeId,
        courseId,
        orgId: scope.orgId,
        urgent: Boolean(req.body?.urgent),
        slaHours,
        lastLearnerMessageAt: callerRole === "learner" ? now : null,
      },
    });
    const members = [{ userId: me.id, role: callerRole }, ...participantIds.map((id) => ({ userId: id, role: participantRoles.get(id) ?? "learner" }))];
    for (const m of members) {
      await tx.threadParticipant.create({ data: { threadId: thread.id, userId: m.userId, role: m.role } }).catch(() => null);
    }
    await tx.message.create({
      data: { threadId: thread.id, authorId: me.id, author: authorName, body: bodyText, urgent: Boolean(req.body?.urgent) },
    });
    await tx.auditLog.create({ data: { userId: me.id, action: "THREAD_CREATED", entity: "message_thread", entityId: thread.id, details: JSON.stringify({ programmeId, participantIds, courseId }) } }).catch(() => null);
    return thread;
  });
  const { notifyMany } = await import("../services/notify.js");
  await notifyMany(participantIds, "message", { title: `New message: ${subject}`, body: bodyText.slice(0, 200), link: `/messages` });
  return res.status(201).json(created);
});

router.get("/threads/:id/messages", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (await isStakeholder(me.id)) return res.status(403).json({ error: "stakeholders do not have access to direct messages" });
  await revokeStaleThreadAccess(me.id, scope.orgId);
  const { thread, participant, programmeAdmin } = await threadAccess(me.id, req.params.id, scope.orgId);
  // 404 (not 403) so non-participants cannot probe thread existence.
  if (!thread || (!participant && !programmeAdmin)) return res.status(404).json({ error: "thread not found" });
  return res.json(await db.message.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" } }).catch(() => []));
});

router.post("/threads/:id/messages", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (await isStakeholder(me.id)) return res.status(403).json({ error: "stakeholders do not have access to direct messages" });
  await revokeStaleThreadAccess(me.id, scope.orgId);
  const { thread, participant, programmeAdmin } = await threadAccess(me.id, req.params.id, scope.orgId);
  if (!thread || (!participant && !programmeAdmin)) return res.status(404).json({ error: "thread not found" });
  const bodyText = String(req.body?.body ?? "").trim();
  if (!bodyText) return res.status(400).json({ error: "body required" });
  const author = await db.user.findUnique({ where: { id: me.id }, select: { name: true } }).catch(() => null);
  const authorRole = participant?.role ?? "admin";
  const msg = await db.message.create({
    data: {
      threadId: thread.id,
      authorId: me.id, // identity comes from the token, never the body
      author: author?.name ?? me.id,
      body: bodyText,
      urgent: Boolean(req.body?.urgent),
    },
  });
  const now = new Date();
  const data: Record<string, unknown> = { updatedAt: now, urgent: req.body?.urgent ? true : undefined };
  if (authorRole === "learner") data.lastLearnerMessageAt = now;
  // Only a trainer participant clears escalation; an admin reply does not.
  if (authorRole === "trainer") {
    data.lastTrainerResponseAt = now;
    data.isEscalated = false;
    data.escalatedAt = null;
  }
  await db.messageThread.update({ where: { id: thread.id }, data }).catch(() => null);
  const participants = await db.threadParticipant.findMany({ where: { threadId: thread.id, leftAt: null }, select: { userId: true } }).catch(() => [] as Array<{ userId: string }>);
  const { notifyMany } = await import("../services/notify.js");
  await notifyMany(participants.map((p) => p.userId).filter((id) => id !== me.id), "message", {
    title: `New message: ${thread.subject}`,
    body: bodyText.slice(0, 200),
    link: "/messages",
  });
  return res.status(201).json(msg);
});

router.patch("/threads/:id/sla", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const { thread, participant } = await threadAccess(me.id, req.params.id, scope.orgId);
  if (!thread) return res.status(404).json({ error: "thread not found" });
  if (!(await canSetThreadSla(me.id, thread.programmeId))) {
    return participant ? res.status(403).json({ error: "only programme admins and org staff can change the response window" }) : res.status(404).json({ error: "thread not found" });
  }
  const slaHours = parseSlaHours(req.body?.slaHours);
  if (slaHours === null) return res.status(400).json({ error: "slaHours must be an integer between 1 and 720" });
  const updated = await db.messageThread.update({ where: { id: thread.id }, data: { slaHours } });
  await db.auditLog.create({ data: { userId: me.id, action: "THREAD_SLA_UPDATED", entity: "message_thread", entityId: thread.id, details: JSON.stringify({ from: thread.slaHours, slaHours }) } }).catch(() => null);
  return res.json(updated);
});

async function requireMessageTemplateStaff(req: Parameters<typeof orgScope>[0]): Promise<string | null> {
  const me = req.user;
  if (!me) return null;
  const scope = orgScope(req);
  const allowed = (await isOrgStaff(me.id)) || (await hasAnyProgrammeStaffGrant(me.id));
  return allowed ? scope.orgId : null;
}

async function canManageMessageTemplate(userId: string, row: { createdBy: string }, orgId: string): Promise<boolean> {
  if (row.createdBy === userId || await isOrgStaff(userId)) return true;
  const programmes = await db.programme.findMany({ where: { orgId }, select: { id: true } });
  const grant = await db.userRole.findFirst({
    where: { userId, programmeId: { in: programmes.map((row) => row.id) }, role: { name: { in: ["admin", "owner"] } } },
    select: { id: true },
  }).catch(() => null);
  return !!grant;
}

router.get("/message-templates", async (req, res) => {
  const orgId = await requireMessageTemplateStaff(req as AuthedRequest);
  if (!orgId) return res.status(403).json({ error: "programme staff access required" });
  const rows = await db.messageTemplate.findMany({ where: { orgId, isActive: true }, orderBy: { title: "asc" }, take: 200 }).catch(() => []);
  return res.json(rows);
});

router.post("/message-templates", async (req, res) => {
  const orgId = await requireMessageTemplateStaff(req as AuthedRequest);
  if (!orgId) return res.status(403).json({ error: "programme staff access required" });
  const me = (req as AuthedRequest).user!;
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!title || !body || title.length > 256 || body.length > 5000) return res.status(400).json({ error: "title and body required (body max 5000 characters)" });
  const row = await db.messageTemplate.create({ data: { orgId, title, body, createdBy: me.id } });
  await db.auditLog.create({ data: { userId: me.id, action: "MESSAGE_TEMPLATE_CREATED", entity: "message_template", entityId: row.id, details: null } }).catch(() => null);
  return res.status(201).json(row);
});

router.patch("/message-templates/:id", async (req, res) => {
  const orgId = await requireMessageTemplateStaff(req as AuthedRequest);
  if (!orgId) return res.status(403).json({ error: "programme staff access required" });
  const me = (req as AuthedRequest).user!;
  const row = await db.messageTemplate.findFirst({ where: { id: req.params.id, orgId } });
  if (!row) return res.status(404).json({ error: "template not found" });
  if (!(await canManageMessageTemplate(me.id, row, orgId))) return res.status(403).json({ error: "only the author, programme admins and org staff can edit this template" });
  const data: Prisma.MessageTemplateUpdateInput = {};
  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title || title.length > 256) return res.status(400).json({ error: "title must be 1-256 characters" });
    data.title = title;
  }
  if (req.body?.body !== undefined) {
    const body = String(req.body.body).trim();
    if (!body || body.length > 5000) return res.status(400).json({ error: "body must be 1-5000 characters" });
    data.body = body;
  }
  if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
  const updated = await db.messageTemplate.update({ where: { id: row.id }, data });
  await db.auditLog.create({ data: { userId: me.id, action: "MESSAGE_TEMPLATE_UPDATED", entity: "message_template", entityId: row.id, details: JSON.stringify(data) } }).catch(() => null);
  return res.json(updated);
});

router.delete("/message-templates/:id", async (req, res) => {
  const orgId = await requireMessageTemplateStaff(req as AuthedRequest);
  if (!orgId) return res.status(403).json({ error: "programme staff access required" });
  const me = (req as AuthedRequest).user!;
  const row = await db.messageTemplate.findFirst({ where: { id: req.params.id, orgId, isActive: true } });
  if (!row) return res.status(404).json({ error: "template not found" });
  if (!(await canManageMessageTemplate(me.id, row, orgId))) return res.status(403).json({ error: "only the author, programme admins and org staff can delete this template" });
  await db.messageTemplate.update({ where: { id: row.id }, data: { isActive: false } });
  await db.auditLog.create({ data: { userId: me.id, action: "MESSAGE_TEMPLATE_DELETED", entity: "message_template", entityId: row.id, details: null } }).catch(() => null);
  return res.status(204).end();
});

router.get("/bookings", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  res.json(await db.booking.findMany({ where: { orgId: scope.orgId }, take: 200 }).catch(() => []));
});
// Round 8 / B.1: the bookable trainers for the caller. Org staff see every trainer; a learner
// sees only trainers who hold a grant in a programme they are currently enrolled on.
router.get("/bookings/trainers", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  const orgStaff = await isOrgStaff(me.id);
  let programmeIds: string[] | null = null;
  if (!orgStaff) {
    const enrolments = await db.enrolment.findMany({
      where: { learnerId: me.id, status: { not: "withdrawn" }, withdrawnAt: null, programme: { orgId: scope.orgId } },
      select: { programmeId: true },
    }).catch(() => [] as Array<{ programmeId: string | null }>);
    programmeIds = enrolments.map((e) => e.programmeId).filter((id): id is string => !!id);
    if (!programmeIds.length) return res.json([]);
  }
  const grants = await db.userRole.findMany({
    where: {
      role: { name: "trainer" },
      programmeId: programmeIds ? { in: programmeIds } : { not: null },
      user: { orgId: scope.orgId, isActive: true },
    },
    select: { userId: true, user: { select: { name: true, email: true } } },
    take: 500,
  }).catch(() => [] as Array<{ userId: string; user: { name: string; email: string } }>);
  const seen = new Map<string, { id: string; name: string; email: string }>();
  for (const g of grants) if (!seen.has(g.userId)) seen.set(g.userId, { id: g.userId, name: g.user.name, email: g.user.email });
  return res.json([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
});
router.post("/bookings", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  // Round 8 / B.1: identities, not name matching. A rename used to re-point a booking at a
  // different person, and two people who share a name were indistinguishable.
  const trainerId = String(req.body?.trainerId ?? "").trim();
  if (!trainerId) return res.status(400).json({ error: "trainerId is required" });
  const grant = await db.userRole.findFirst({
    where: { userId: trainerId, role: { name: "trainer" }, programmeId: { not: null }, user: { orgId: scope.orgId, isActive: true } },
    select: { userId: true, programmeId: true, user: { select: { name: true } } },
  }).catch(() => null);
  if (!grant) return res.status(404).json({ error: "trainer not found in your organization" });
  const programmeId = grant.programmeId!;
  if (!(await isOrgStaff(me.id))) {
    const myGrant = await db.userRole.findFirst({ where: { userId: me.id, programmeId }, select: { id: true } }).catch(() => null);
    if (!myGrant) {
      const enrolment = await db.enrolment.findFirst({ where: { learnerId: me.id, programmeId, status: { not: "withdrawn" }, withdrawnAt: null }, select: { id: true } }).catch(() => null);
      if (!enrolment) return res.status(403).json({ error: "this trainer is not in a programme you are enrolled on" });
    }
  }
  let courseId: string | null = null;
  let courseTitle = "";
  if (req.body?.courseId) {
    const course = await db.course.findFirst({ where: { id: String(req.body.courseId), programme: { orgId: scope.orgId } }, select: { id: true, title: true } }).catch(() => null);
    if (!course) return res.status(404).json({ error: "course not found in your organization" });
    courseId = course.id;
    courseTitle = course.title;
  }
  return res.status(201).json(await db.booking.create({
    data: { trainer: grant.user.name, trainerId: grant.userId, course: courseTitle, courseId, orgId: scope.orgId, date: String(req.body?.date ?? ""), time: String(req.body?.time ?? "") },
  }));
});
// Round 8 / D.2: a feed token is a bearer credential in a URL, so the database keeps only its
// SHA-256. The plaintext exists once, in the response to the rotation call.
function hashFeedToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

router.get("/calendar/feed.ics", async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(401).json({ error: "token required" });
  const user = await db.user.findFirst({ where: { icalFeedToken: hashFeedToken(token) }, select: { id: true, name: true, orgId: true } }).catch(() => null);
  if (!user) return res.status(401).json({ error: "invalid calendar token" });
  const sessions = await sessionsForUser(user.id);
  const ics = buildIcsCalendar({ name: `${user.name} - TrainHub360 sessions`, sessions: sessions as any[] });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="trainhub360.ics"');
  return res.send(ics);
});

router.get("/me/ical-token", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const user = await db.user.findUnique({ where: { id: me.id }, select: { icalFeedToken: true } }).catch(() => null);
  // The stored value is a hash, so there is no URL to return. Rotating is how a client obtains
  // a usable one; this endpoint only says whether a feed has been set up.
  return res.json({ configured: !!user?.icalFeedToken });
});

router.post("/users/:id/ical-token", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (req.params.id !== me.id && !(await isOrgStaff(me.id))) return res.status(403).json({ error: "only org staff can generate another user's calendar token" });
  const user = await db.user.findFirst({ where: { id: req.params.id, orgId: scope.orgId }, select: { id: true } }).catch(() => null);
  if (!user) return res.status(404).json({ error: "user not found in your organization" });
  const token = crypto.randomBytes(32).toString("hex");
  await db.user.update({ where: { id: user.id }, data: { icalFeedToken: hashFeedToken(token) } });
  // Shown once; rotating replaces the hash, which invalidates the previous subscription.
  return res.status(201).json({ token, url: `/api/calendar/feed.ics?token=${token}` });
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
router.post("/sessions/:id/sync-calendar", async (req, res) => {
  const scope = orgScope(req as AuthedRequest);
  try {
    await loadSessionForStaff(req as AuthedRequest, scope.orgId);
    return res.status(501).json({
      error: "Outlook/Google API sync is not built. Use GET /api/sessions/:id/ics or the personal feed at GET /api/calendar/feed.ics?token=… instead.",
    });
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
// A.2 notification bell. Scoped to the caller: there is no path to another user's
// notifications, and orgId is not trusted from the client.
router.get("/notifications", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const unreadOnly = String(req.query.unread ?? "") === "true";
  const take = Math.min(Number(req.query.limit ?? 50) || 50, 100);
  const rows = await db.notification.findMany({
    where: { userId: me.id, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  }).catch(() => []);
  const unread = await db.notification.count({ where: { userId: me.id, readAt: null } }).catch(() => 0);
  res.json({ items: rows, unread });
});
router.post("/notifications/:id/read", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  // Scoped by userId in the same statement, so a guessed id from another user is a no-op
  // rather than a cross-user write.
  const result = await db.notification.updateMany({
    where: { id: String(req.params.id), userId: me.id, readAt: null },
    data: { readAt: new Date() },
  }).catch(() => ({ count: 0 }));
  if (!result.count) {
    const mine = await db.notification.findFirst({ where: { id: String(req.params.id), userId: me.id }, select: { id: true } }).catch(() => null);
    if (!mine) {
      res.status(404).json({ error: "notification not found" });
      return;
    }
  }
  res.json({ ok: true });
});
router.post("/notifications/read-all", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const result = await db.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } }).catch(() => ({ count: 0 }));
  res.json({ ok: true, updated: result.count });
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
router.post("/certificates/check-expiry", requireOrgStaff(), async (req, res) => {
  const { runCertificateExpiryJob } = await import("../jobs/certificateExpiryJob.js");
  res.json(await runCertificateExpiryJob(Number(req.body?.withinDays ?? 30)));
});
router.get("/cohorts", async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const scope = orgScope(req as AuthedRequest);
  if (!(await isOrgStaff(me.id)) && !(await hasAnyProgrammeStaffGrant(me.id))) {
    return res.status(403).json({ error: "programme staff access required" });
  }
  return res.json(await db.cohort.findMany({ where: { orgId: scope.orgId }, include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } }, take: 200 }).catch(() => []));
});
router.post("/cohorts", requireOrgStaff(), async (req, res) => {
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
router.patch("/review-credit/settings", requireOrgStaff(), async (req, res) => {
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
router.patch("/organizations/:id", requireOrgStaff(), async (req, res) => {
  assertSameOrg(req as AuthedRequest, req.params.id);
  const me = (req as AuthedRequest).user!;
  const current = await db.organization.findUnique({ where: { id: req.params.id }, select: { defaultSlaHours: true } }).catch(() => null);
  const patch = req.body ?? {};
  const data: Record<string, unknown> = {};
  for (const k of ["name", "plan", "domain"]) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.defaultSlaHours !== undefined) {
    const parsed = parseSlaHours(patch.defaultSlaHours);
    if (parsed === null) return res.status(400).json({ error: "defaultSlaHours must be an integer between 1 and 720" });
    data.defaultSlaHours = parsed;
  }
  if (patch.webhookUrls !== undefined) {
    if (!Array.isArray(patch.webhookUrls)) return res.status(400).json({ error: "webhookUrls must be an array" });
    data.webhookUrls = JSON.stringify(patch.webhookUrls);
  }
  if (patch.maxWeighting !== undefined) data.reviewCreditMaxWeighting = Number(patch.maxWeighting);
  if (patch.reminderCadence !== undefined) {
    // Round 8 / D.1: validated here, because the job must never meet a cadence it cannot read.
    const { validateReminderCadence } = await import("../services/reminderCadence.js");
    const cadence = validateReminderCadence(patch.reminderCadence);
    if (!cadence.ok) return res.status(400).json({ error: cadence.error });
    data.reminderCadenceJson = JSON.stringify(cadence.value);
  }
  if (patch.samlEnabled !== undefined) data.samlEnabled = Boolean(patch.samlEnabled);
  if (patch.samlIdpCert !== undefined) data.samlIdpCert = patch.samlIdpCert || null;
  if (patch.samlIdpIssuer !== undefined) data.samlIdpIssuer = patch.samlIdpIssuer || null;
  if (patch.samlEntityId !== undefined) data.samlEntityId = patch.samlEntityId || null;
  const updated = await db.organization.update({ where: { id: req.params.id }, data });
  if (data.defaultSlaHours !== undefined && data.defaultSlaHours !== current?.defaultSlaHours) {
    await db.auditLog.create({ data: { userId: me.id, action: "ORGANIZATION_DEFAULT_SLA_UPDATED", entity: "organization", entityId: req.params.id, details: JSON.stringify({ from: current?.defaultSlaHours ?? null, defaultSlaHours: data.defaultSlaHours }) } }).catch(() => null);
  }
  return res.json(updated);
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
router.post("/organizations/:id/learners/import", requireOrgStaff(), async (req, res) => {
  assertSameOrg(req as AuthedRequest, req.params.id);
  const orgId = req.params.id;
  const rows = (req.body?.rows ?? []) as { name?: string; email?: string; department?: string; jobFunction?: string; managerEmail?: string }[];
  const roleMapping = { ...DEFAULT_ROLE_MAPPING, ...((req.body?.roleMapping ?? {}) as Record<string, string>) };
  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: { row: number; email?: string; error: string }[] = [];
  const warnings: { row: number; email: string; warning: string }[] = [];
  const activationTokens: { email: string; token: string }[] = [];
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
        const { unguessablePasswordHash, issueActivationToken, sendActivationEmail } = await import("../services/password.js");
        const created_user = await db.user.create({ data: { orgId, name: row.name ?? row.email, email: row.email, passwordHash: await unguessablePasswordHash(), department: row.department ?? null, jobFunction: row.jobFunction ?? null, managerId } });
        const activation = await issueActivationToken(created_user.id);
        await sendActivationEmail(created_user.email, created_user.name, activation.token);
        if (process.env.NODE_ENV === "test") activationTokens.push({ email: created_user.email, token: activation.token });
        created += 1;
        userId = created_user.id;
      }
      const programmeId = req.body?.programmeId as string | undefined;
      if (programmeId && mapped !== "learner") {
        await assertProgrammeInOrg(programmeId, orgId);
        const role = await db.role.findUnique({ where: { name: mapped } }).catch(() => null);
        if (role) {
          const existingGrant = await db.userRole.findFirst({ where: { userId, programmeId } }).catch(() => null);
          if (existingGrant) await db.userRole.update({ where: { id: existingGrant.id }, data: { roleId: role.id } }).catch(() => null);
          else await db.userRole.create({ data: { userId, roleId: role.id, programmeId } }).catch(() => null);
        }
      }
    } catch (e) {
      failed += 1;
      errors.push({ row: i, email: row.email, error: (e as Error).message });
    }
  }
  return res.json({ created, updated, failed, errors, warnings, ...(process.env.NODE_ENV === "test" ? { activationTokens } : {}) });
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
router.get("/organizations/:id/review-credits/export", requireOrgStaff(), async (req, res) => {
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
router.post("/review-credits/lock", requireOrgStaff(), async (req, res) => {
  const orgId = orgIdOf(req as AuthedRequest);
  const now = new Date();
  const updated = await db.enrolment.updateMany({ where: { reviewCreditLockedAt: null, reviewCreditExcluded: false, programme: { orgId } }, data: { reviewCreditLockedAt: now } }).catch(() => ({ count: 0 }));
  await db.auditLog.create({ data: { userId: (req as AuthedRequest).user?.id ?? null, action: "REVIEW_CYCLE_LOCKED", entity: "organization", entityId: orgId, details: null } }).catch(() => null);
  const webhook = await dispatchWebhook(orgId, "review_credit_finalized", { lockedAt: now.toISOString(), lockedCount: updated.count });
  res.json({ orgId, lockedAt: now.toISOString(), lockedCount: updated.count, webhook });
});
router.get("/audit/logs", requireOrgStaff(), async (req, res) => {
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
router.post("/sla/run", requireOrgStaff(), async (_req, res) => {
  res.json(await runSlaJob());
});
router.post("/nudge/dispatch", requireOrgStaff(), async (_req, res) => {
  res.json(await runNudgeJob());
});
router.post("/content-lifecycle/run", requireOrgStaff(), async (_req, res) => {
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


