import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth.js";
import { db } from "../db.js";

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    return next();
  };
}

const ROLE_PRIORITY = ["owner", "admin", "trainer", "stakeholder", "learner"];

// A person may hold several roles (§4). The JWT carries a single scalar role for
// cheap checks, so resolve it deterministically: highest privilege wins, and an
// org-wide grant (programmeId null) wins over a programme-scoped one.
export async function resolveRole(userId: string): Promise<string> {
  const grants = await db.userRole
    .findMany({ where: { userId }, include: { role: true } })
    .catch(() => [] as Array<{ programmeId: string | null; role: { name: string } }>);
  if (!grants.length) return "learner";
  const rank = (name: string) => {
    const i = ROLE_PRIORITY.indexOf(name);
    return i === -1 ? ROLE_PRIORITY.length : i;
  };
  grants.sort((a, b) => {
    const diff = rank(a.role.name) - rank(b.role.name);
    if (diff !== 0) return diff;
    return (a.programmeId === null ? 0 : 1) - (b.programmeId === null ? 0 : 1);
  });
  return grants[0].role.name;
}

async function resolveProgrammeId(req: AuthedRequest): Promise<string | null> {
  const params = req.params as Record<string, string | undefined>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof params.programmeId === "string") return params.programmeId;
  if (typeof body.programmeId === "string") return body.programmeId;
  if (typeof body.courseId === "string") {
    const c = await db.course.findUnique({ where: { id: body.courseId }, select: { programmeId: true } }).catch(() => null);
    if (c) return c.programmeId;
  }
  if (typeof body.moduleId === "string") {
    const m = await db.module.findUnique({ where: { id: body.moduleId }, select: { course: { select: { programmeId: true } } } }).catch(() => null);
    if (m) return m.course.programmeId;
  }
  if (typeof params.moduleId === "string") {
    const m = await db.module.findUnique({ where: { id: params.moduleId }, select: { course: { select: { programmeId: true } } } }).catch(() => null);
    if (m) return m.course.programmeId;
  }
  if (typeof params.contentId === "string") {
    const c = await db.contentItem.findUnique({ where: { id: params.contentId }, select: { module: { select: { course: { select: { programmeId: true } } } } } }).catch(() => null);
    if (c) return c.module.course.programmeId;
  }
  if (typeof params.id === "string") {
    if (req.path.includes("/programmes/")) return params.id;
    if (req.path.includes("/courses/")) {
      const c = await db.course.findUnique({ where: { id: params.id }, select: { programmeId: true } }).catch(() => null);
      if (c) return c.programmeId;
    }
    if (req.path.includes("/modules/")) {
      const m = await db.module.findUnique({ where: { id: params.id }, select: { course: { select: { programmeId: true } } } }).catch(() => null);
      if (m) return m.course.programmeId;
    }
    if (req.path.includes("/assessments/")) {
      const a = await db.assessment.findUnique({ where: { id: params.id }, select: { module: { select: { course: { select: { programmeId: true } } } } } }).catch(() => null);
      if (a) return a.module.course.programmeId;
    }
    // An attempt has no programmeId of its own: it is reached through its assessment, which is
    // the only description of who may act on it.
    if (req.path.includes("/attempts/")) {
      const attempt = await db.assessmentAttempt
        .findUnique({ where: { id: params.id }, select: { assessment: { select: { module: { select: { course: { select: { programmeId: true } } } } } } } })
        .catch(() => null);
      if (attempt) return attempt.assessment.module.course.programmeId;
    }
    if (req.path.includes("/enrolments/")) {
      const e = await db.enrolment.findUnique({ where: { id: params.id }, select: { programmeId: true } }).catch(() => null);
      if (e?.programmeId) return e.programmeId;
    }
    if (req.path.includes("/content-progress/")) {
      const cp = await db.contentProgress.findUnique({ where: { id: params.id }, select: { contentItem: { select: { module: { select: { course: { select: { programmeId: true } } } } } } } }).catch(() => null);
      if (cp) return cp.contentItem.module.course.programmeId;
    }
    if (req.path.includes("/attempts/")) {
      const at = await db.assessmentAttempt.findUnique({ where: { id: params.id }, select: { assessment: { select: { module: { select: { course: { select: { programmeId: true } } } } } } } }).catch(() => null);
      if (at) return at.assessment.module.course.programmeId;
    }
    if (req.path.includes("/questions/")) {
      const q = await db.question.findUnique({ where: { id: params.id }, select: { assessment: { select: { module: { select: { course: { select: { programmeId: true } } } } } } } }).catch(() => null);
      if (q) return q.assessment.module.course.programmeId;
    }
    if (req.path.includes("/content/")) {
      const c = await db.contentItem.findUnique({ where: { id: params.id }, select: { module: { select: { course: { select: { programmeId: true } } } } } }).catch(() => null);
      if (c) return c.module.course.programmeId;
    }
  }
  return null;
}

export async function isProgrammeStaff(userId: string, programmeId: string): Promise<boolean> {
  const grant = await db.userRole
    .findFirst({ where: { userId, programmeId, role: { name: { in: ["trainer", "admin"] } } } })
    .catch(() => null);
  return !!grant;
}

export async function isOrgStaff(userId: string): Promise<boolean> {
  const grant = await db.userRole
    .findFirst({ where: { userId, programmeId: null, role: { name: { in: ["owner", "admin"] } } } })
    .catch(() => null);
  return !!grant;
}

export async function isOrgOwner(userId: string): Promise<boolean> {
  const grant = await db.userRole
    .findFirst({ where: { userId, programmeId: null, role: { name: "owner" } } })
    .catch(() => null);
  return !!grant;
}

// Any admin/owner grant (org-wide or programme-scoped). Used to let programme
// administrators read the org directory so they can add existing people to
// their programme without provisioning new accounts.
export async function hasAdminGrant(userId: string): Promise<boolean> {
  const grant = await db.userRole
    .findFirst({ where: { userId, role: { name: { in: ["owner", "admin"] } } } })
    .catch(() => null);
  return !!grant;
}

// Org-wide settings (billing/plan, SAML, audit log, review-credit cycle,
// bulk import) are owned by organization staff — a programme-scoped admin must
// not reach them (proposal §4 IT-vs-L&D separation, §6).
export function requireOrgStaff() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (!(await isOrgStaff(req.user.id))) return res.status(403).json({ error: "organization staff access required" });
    return next();
  };
}

// DB-backed guard: a programme must always keep at least one admin grant.
// Returns/throws a 409 so routes cannot remove the last admin by accident.
export async function assertNotLastProgrammeAdmin(programmeId: string, userId: string, removingRole?: string): Promise<void> {
  if (removingRole && removingRole !== "admin") return;
  const grant = await db.userRole.findFirst({ where: { userId, programmeId, role: { name: "admin" } } }).catch(() => null);
  if (!grant) return;
  const adminCount = await db.userRole.count({ where: { programmeId, role: { name: "admin" } } }).catch(() => 0);
  if (adminCount <= 1) {
    const err = new Error("cannot remove the last programme admin — appoint another admin first") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
}

// DB-backed guard: an organization must always keep at least one active owner.
export async function assertNotLastOrgOwner(orgId: string, userId: string): Promise<void> {
  const grants = await db.userRole.findMany({
    where: { userId, programmeId: null, role: { name: "owner" }, user: { orgId } },
    select: { id: true },
  }).catch(() => []);
  if (!grants.length) return;
  const owners = await db.userRole.findMany({
    where: { programmeId: null, role: { name: "owner" }, user: { orgId, isActive: true } },
    select: { userId: true },
  }).catch(() => [] as Array<{ userId: string }>);
  const distinct = new Set(owners.map((o) => o.userId));
  if (distinct.size <= 1 && distinct.has(userId)) {
    const err = new Error("cannot remove or deactivate the last organization owner") as Error & { status?: number };
    err.status = 409;
    throw err;
  }
}

// Only an org owner may modify another owner's org-wide role or deactivate them.
export async function canModifyOwner(actorId: string): Promise<boolean> {
  return isOrgOwner(actorId);
}

// Round 6 / M1: a programme admin grant is not the only way to administer a programme — an
// org-wide owner/admin grant covers every programme (the same rule requireProgrammeRole uses).
// Reading threads used the programme grant alone, so org staff saw only metadata for their own
// programmes' threads while requireProgrammeRole let them manage them.
export async function isProgrammeAdmin(userId: string, programmeId: string): Promise<boolean> {
  if (await isOrgStaff(userId)) return true;
  const grant = await db.userRole
    .findFirst({ where: { userId, programmeId, role: { name: "admin" } } })
    .catch(() => null);
  return !!grant;
}

export async function hasAnyProgrammeStaffGrant(userId: string): Promise<boolean> {
  const grant = await db.userRole
    .findFirst({ where: { userId, programmeId: { not: null }, role: { name: { in: ["admin", "owner", "trainer"] } } } })
    .catch(() => null);
  return !!grant;
}

export async function trainerProgrammeIds(userId: string, orgId: string): Promise<string[]> {
  const grants = await db.userRole.findMany({
    where: {
      userId,
      programmeId: { not: null },
      role: { name: "trainer" },
      user: { orgId, isActive: true },
    },
    select: { programmeId: true },
  });
  const grantedIds = [...new Set(grants.map((grant) => grant.programmeId).filter((id): id is string => !!id))];
  if (grantedIds.length === 0) return [];
  const programmes = await db.programme.findMany({ where: { id: { in: grantedIds }, orgId }, select: { id: true } });
  return programmes.map((programme) => programme.id);
}

export function requireOrgStaffOrProgrammeAdmin() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (await isOrgStaff(req.user.id)) return next();
    const grant = await db.userRole
      .findFirst({ where: { userId: req.user.id, programmeId: { not: null }, role: { name: "admin" } } })
      .catch(() => null);
    if (!grant) return res.status(403).json({ error: "programme admin access required" });
    return next();
  };
}

export function requireOrgOwner() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (!(await isOrgOwner(req.user.id))) return res.status(403).json({ error: "organization owner access required" });
    return next();
  };
}

// Checks that the caller holds one of `roles` FOR THE SPECIFIC PROGRAMME in
// the request (params/body, or resolved through the target entity).
//
// Explicit allowance (not a gap): a caller with an org-wide `owner`/`admin`
// grant — a UserRole row with programmeId NULL — bypasses the per-programme
// check so org owners can act across programmes (§4: one person can hold
// multiple roles). Programme-scoped admins do NOT bypass: their grant only
// covers their own programme. Business decision (Phase 2.3, confirmed
// 2026-09-12): the `owner` bypass stays — owners are NOT hard-blocked from
// training content.
export function requireProgrammeRole(...roles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const me = req.user;
    if (!me) return res.status(401).json({ error: "unauthorized" });
    if (await isOrgStaff(me.id)) return next();
    const programmeId = await resolveProgrammeId(req).catch(() => null);
    if (!programmeId) return res.status(400).json({ error: "programme context required" });
    const grant = await db.userRole
      .findFirst({ where: { userId: me.id, programmeId, role: { name: { in: roles } } } })
      .catch(() => null);
    if (!grant) return res.status(403).json({ error: "forbidden for this programme" });
    return next();
  };
}
