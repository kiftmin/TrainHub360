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
    if (req.path.includes("/enrolments/")) {
      const e = await db.enrolment.findUnique({ where: { id: params.id }, select: { programmeId: true } }).catch(() => null);
      if (e?.programmeId) return e.programmeId;
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
