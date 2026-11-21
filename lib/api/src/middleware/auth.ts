import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
export interface AuthedRequest extends Request { user?: { id: string; role: string; orgId?: string; tokenVersion?: number } }

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.path === "/api/healthz" || req.path === "/api/auth/login" || req.path === "/api/auth/sso") return next();
  if (req.method === "POST" && req.path === "/api/organizations") return next();
  if (req.method === "POST" && (req.path === "/api/auth/forgot-password" || req.path === "/api/auth/reset-password" || req.path === "/api/auth/activate")) return next();
  // Personal calendar feed is authenticated by its own opaque token, not a bearer session.
  if (req.method === "GET" && req.path === "/api/calendar/feed.ics") return next();
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  let payload: { sub: string; role: string; orgId?: string; tv?: number };
  try {
    payload = jwt.verify(h.slice(7), process.env.JWT_SECRET ?? "dev-secret") as { sub: string; role: string; orgId?: string; tv?: number };
  } catch { return res.status(401).json({ error: "invalid token" }); }

  // Fail closed: a DB outage is a 503, never an unauthenticated request. A
  // missing/inactive account or stale token version is a 401. This also makes
  // role changes and deactivation apply to live sessions immediately.
  let account: { isActive: boolean; tokenVersion: number } | null;
  try {
    account = await db.user.findUnique({ where: { id: payload.sub }, select: { isActive: true, tokenVersion: true } });
  } catch {
    return res.status(503).json({ error: "authentication service unavailable" });
  }
  if (!account || account.isActive === false) return res.status(401).json({ error: "account is not active" });
  if ((payload.tv ?? 0) !== account.tokenVersion) return res.status(401).json({ error: "session expired — please log in again" });
  req.user = { id: payload.sub, role: payload.role, orgId: payload.orgId, tokenVersion: account.tokenVersion };
  next();
}
export function signToken(user: { id: string; role: string; orgId?: string; tokenVersion?: number }) {
  return jwt.sign({ sub: user.id, role: user.role, orgId: user.orgId, tv: user.tokenVersion ?? 0 }, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "8h" });
}
