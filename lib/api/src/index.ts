import "dotenv/config";
// Round 6 / A.1: Express 4.21 does not forward rejected promises from `async` handlers
// to the error middleware. Many handlers call throwing helpers (assertProgrammeInOrg,
// assertCourseInOrg, assertNotLastProgrammeAdmin) outside a try/catch, so without this
// import those requests hang and the failure only surfaces as an unhandled rejection.
// This import MUST stay above the Router import: it patches express.Router before any
// router is created. (Alternative considered: Express 5, which forwards natively; not
// taken because it changes error semantics across every route.)
import "express-async-errors";
import express from "express";
import cors from "cors";
import { router } from "./routes/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { auditMiddleware } from "./middleware/audit.js";
import type { AuthedRequest } from "./middleware/auth.js";
import { scheduleKpiJob } from "./jobs/kpiJob.js";
import { scheduleContentLifecycleJob } from "./jobs/contentLifecycleJob.js";
import { scheduleCertificateExpiryJob } from "./jobs/certificateExpiryJob.js";
import { scheduleSessionReminderJob } from "./jobs/sessionReminderJob.js";

type StatusError = Error & { status?: unknown };

/** Errors that mean "the database is unreachable", not "the request was wrong". */
const DB_UNAVAILABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1017"]);

function isDbUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && DB_UNAVAILABLE_PRISMA_CODES.has(code);
}

/**
 * Central error handler. Mapping rules (round 6 / A.1):
 *   - an error carrying a numeric `status` is the handler's intended 4xx/5xx, and its
 *     message is safe to return (these are written for the caller);
 *   - Prisma connectivity failures (P1001/P1002/P1017) are 503 with the MSSQL hint;
 *   - anything else is a programming error: log it, return a generic 500. It must never
 *     become a 503 hint, and it must never leak its message to the caller.
 */
export const errorMiddleware: express.ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err === "object" && err !== null && typeof (err as StatusError).status === "number"
      ? ((err as StatusError).status as number)
      : undefined;

  if (res.headersSent) return;

  if (status !== undefined) {
    const message = err instanceof Error ? err.message : "request failed";
    if (status >= 500) console.error(`[api] request failed (${status}):`, message);
    res.status(status).json({ error: message });
    return;
  }

  if (isDbUnavailable(err)) {
    console.error("[api] database unavailable:", err instanceof Error ? err.message : err);
    res.status(503).json({ error: "service unavailable", hint: "MSSQL unreachable — check DATABASE_URL and network" });
    return;
  }

  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: "internal server error" });
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(authMiddleware);
app.use(auditMiddleware);
app.use("/api", (req, res, next) => {
  const user = (req as AuthedRequest).user;
  if (user?.role === "stakeholder" && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    return res.status(403).json({ error: "stakeholders are read-only" });
  }
  return next();
});
app.use("/api", router);
app.use("/api", errorMiddleware);

// Logging only. Requests must never depend on these to finish: with express-async-errors
// above, a rejected handler promise is answered by errorMiddleware, not by these hooks.
process.on("unhandledRejection", (e) => console.error("[api] unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[api] uncaught exception:", e));

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => console.log(`TrainHub360 API on :${port}`));
  scheduleKpiJob();
  scheduleContentLifecycleJob();
  scheduleCertificateExpiryJob();
  scheduleSessionReminderJob();
}
export default app;
