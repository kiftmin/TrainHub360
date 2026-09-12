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

// Checks that the caller holds one of `roles` FOR THE SPECIFIC PROGRAMME in
// the request (params/body, or resolved through the target entity).
//
// Explicit allowance (not a gap): a caller with an org-wide `owner`/`admin`
// grant — a UserRole row with programmeId NULL — bypasses the per-programme
// check so org owners can act across programmes (§4: one person can hold
// multiple roles). Programme-scoped admins do NOT bypass: their grant only
// covers their own programme. Whether `owner` should be hard-blocked from
// training content entirely is an open product decision (see Phase 2.3); until
// it is confirmed, the org-wide bypass stands and is logged here deliberately.
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
