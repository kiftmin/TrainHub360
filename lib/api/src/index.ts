import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./routes/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { auditMiddleware } from "./middleware/audit.js";
import { scheduleKpiJob } from "./jobs/kpiJob.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(authMiddleware);
app.use(auditMiddleware);
app.use("/api", router);
app.use("/api", (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] request failed:", err instanceof Error ? err.message : err);
  if (res.headersSent) return;
  const status = typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
    ? (err as { status: number }).status
    : 503;
  const message = err instanceof Error ? err.message : "service unavailable";
  res.status(status).json(status === 503 ? { error: "service unavailable", hint: "MSSQL unreachable — check DATABASE_URL and network" } : { error: message });
});

process.on("unhandledRejection", (e) => console.error("[api] unhandled rejection (server stays up):", e));
process.on("uncaughtException", (e) => console.error("[api] uncaught exception (server stays up):", e));

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => console.log(`TrainHub360 API on :${port}`));
  scheduleKpiJob();
}
export default app;


