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
import { Prisma } from "./db.js";
import { authMiddleware } from "./middleware/auth.js";
import { auditMiddleware } from "./middleware/audit.js";
import type { AuthedRequest } from "./middleware/auth.js";
import { scheduleKpiJob } from "./jobs/kpiJob.js";
import { scheduleContentLifecycleJob } from "./jobs/contentLifecycleJob.js";
import { scheduleCertificateExpiryJob } from "./jobs/certificateExpiryJob.js";
import { scheduleReminderJob } from "./jobs/sessionReminderJob.js";
import { scheduleSlaJob } from "./jobs/slaJob.js";
import { startEvaluationWorker } from "./services/evaluationQueue.js";
import { assertEmailConfiguration } from "./services/email.js";
import { parseTrustProxy } from "./config/proxy.js";

type StatusError = Error & { status?: unknown };

/** Errors that mean "the database is unreachable", not "the request was wrong". */
const DB_UNAVAILABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1017"]);

/**
 * A bare `code` string is not enough to call something a database outage: a foreign-key
 * violation (P2003) or a unique clash (P2002) also carries a `code` on some errors, and
 * treating those as 503 would hide a real request error. Only a generated Prisma client
 * error with a connectivity code counts.
 */
function isDbUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return DB_UNAVAILABLE_PRISMA_CODES.has((err as unknown as { code: string }).code);
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
// Round 8 / 3.2: off unless configured, so a spoofed X-Forwarded-For is ignored.
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
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
  // Round 7 gap 2: a production deployment that would log its mail, or point its links at
  // localhost, must not start. In development this only warns, so the console sender stays
  // usable. EMAIL_STRICT=false is the deliberate opt-out for a production box that really
  // does not send mail.
  assertEmailConfiguration();
  // Round 8 / 3.2: a production box behind a proxy that never set TRUST_PROXY throttles the
  // proxy's address, not the caller's. Warn loudly rather than pretend the limit is per client.
  if (process.env.NODE_ENV === "production" && parseTrustProxy(process.env.TRUST_PROXY) === false) {
    console.warn(
      "[api] TRUST_PROXY is not set. Behind a reverse proxy, the login throttle will see the " +
        "proxy's address for every request. Set TRUST_PROXY to the hop count, loopback, or the proxy CIDRs.",
    );
  }
  app.listen(port, () => console.log(`TrainHub360 API on :${port}`));
  scheduleKpiJob();
  scheduleContentLifecycleJob();
  scheduleCertificateExpiryJob();
  scheduleReminderJob();
  scheduleSlaJob();
  // Round 9 / 3.3: the course re-evaluation queue. In-process and database-backed, so a run
  // survives a restart; NODE_ENV=test drives it from the tests instead.
  startEvaluationWorker();
}
export default app;
