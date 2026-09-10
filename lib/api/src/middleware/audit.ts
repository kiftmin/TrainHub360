import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth.js";
export const auditEntries: { userId?: string; action: string; entity: string; at: string }[] = [];
export function auditMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    auditEntries.push({ userId: req.user?.id, action: `${req.method} ${req.path}`, entity: req.path, at: new Date().toISOString() });
  }
  next();
}

