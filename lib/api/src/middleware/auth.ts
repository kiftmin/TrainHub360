import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
export interface AuthedRequest extends Request { user?: { id: string; role: string; orgId?: string } }
export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.path === "/api/healthz" || req.path === "/api/auth/login" || req.path === "/api/auth/sso") return next();
  if (req.method === "POST" && req.path === "/api/organizations") return next();
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(h.slice(7), process.env.JWT_SECRET ?? "dev-secret") as { sub: string; role: string; orgId?: string };
    req.user = { id: payload.sub, role: payload.role, orgId: payload.orgId };
    next();
  } catch { return res.status(401).json({ error: "invalid token" }); }
}
export function signToken(user: { id: string; role: string; orgId?: string }) {
  return jwt.sign({ sub: user.id, role: user.role, orgId: user.orgId }, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "8h" });
}

