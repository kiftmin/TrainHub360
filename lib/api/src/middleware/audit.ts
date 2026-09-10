import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth.js";
export const auditEntries: { userId?: string; action: string; entity: string; at: string }[] = [];
export function auditMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const entry = { userId: req.user?.id, action: `${req.method} ${req.path}`, entity: req.path, at: new Date().toISOString() };
    auditEntries.push(entry);
    import("../db.js").then(({ db }) =>
      db.auditLog.create({ data: { userId: entry.userId ?? null, action: entry.action, entity: entry.entity, entityId: null, details: null } }).catch(() => null)
    ).catch(() => null);
  }
  next();
}

