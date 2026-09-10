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

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => console.log(`TrainHub360 API on :${port}`));
  scheduleKpiJob();
}
export default app;

