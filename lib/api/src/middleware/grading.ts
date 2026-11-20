// A queued attempt belongs to a learner, so marking it is the one place where a trainer's own work
// can be mistaken for a learner's. These guards run before the route's requireProgrammeRole:
//
//   * you are never a grader of your own attempt (otherwise a trainer could mark their own
//     scenario), and
//   * removing your own trainer grant must not be a way around that, so your live programme grant
//     is checked rather than the token's role.
//
// The route then re-checks ownership inside the handler, because a guard in middleware alone is
// the kind of thing a later refactor drops.
import type { NextFunction, Response } from "express";
import { db } from "../db.js";
import type { AuthedRequest } from "./auth.js";

export async function assertNotGradingSelf(req: AuthedRequest, res: Response, next: NextFunction) {
  const me = req.user;
  if (!me) return res.status(401).json({ error: "unauthorized" });
  const attempt = await db.assessmentAttempt
    .findUnique({
      where: { id: req.params.id },
      select: { learnerId: true, assessment: { select: { module: { select: { course: { select: { programmeId: true } } } } } } },
    })
    .catch(() => null);
  if (!attempt) return res.status(404).json({ error: "attempt not found" });
  if (attempt.learnerId === me.id) return res.status(403).json({ error: "you cannot grade your own attempt" });
  // Another organization's attempt answers exactly as a missing one does, so this route cannot be
  // used to learn that an id exists elsewhere.
  const programme = await db.programme.findUnique({ where: { id: attempt.assessment.module.course.programmeId }, select: { orgId: true } }).catch(() => null);
  if (!programme || programme.orgId !== me.orgId) return res.status(404).json({ error: "attempt not found" });
  // The programme grant must be live: a token minted while someone was a trainer cannot be used
  // to grade after the grant is removed.
  const programmeId = attempt.assessment.module.course.programmeId;
  const grant = await db.userRole
    .findFirst({ where: { userId: me.id, programmeId, role: { name: { in: ["trainer", "admin", "owner"] } } } })
    .catch(() => null);
  if (!grant) return res.status(403).json({ error: "forbidden for this programme" });
  return next();
}
