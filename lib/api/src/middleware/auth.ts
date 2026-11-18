import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
export interface AuthedRequest extends Request { user?: { id: string; role: string; orgId?: string } }
export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.path === "/api/healthz" || req.path === "/api/auth/login" || req.path === "/api/auth/sso") return next();
  if (req.method === "POST" && req.path === "/api/organizations") return next();
  if (req.method === "POST" && (req.path === "/api/auth/forgot-password" || req.path === "/api/auth/reset-password")) return next();
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  let payload: { sub: string; role: string; orgId?: string };
  try {
    payload = jwt.verify(h.slice(7), process.env.JWT_SECRET ?? "dev-secret") as { sub: string; role: string; orgId?: string };
  } catch { return res.status(401).json({ error: "invalid token" }); }
  // Deactivation must revoke live sessions, not just block future logins.
  const account = await db.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } }).catch(() => null);
  if (account?.isActive === false) return res.status(401).json({ error: "account deactivated — contact your organization administrator" });
  req.user = { id: payload.sub, role: payload.role, orgId: payload.orgId };
  next();
}
export function signToken(user: { id: string; role: string; orgId?: string }) {
  return jwt.sign({ sub: user.id, role: user.role, orgId: user.orgId }, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "8h" });
}

