-- Round 10 / Phase 2: make the course re-evaluation queue restart-safe.
--
-- A worker that dies mid-pass used to leave its job "running" forever. The job now reports a
-- heartbeat, and a job whose heartbeat goes stale is reclaimed (or failed after five attempts).
-- A filtered unique index enforces the real rule: at most one pending job per course, even if two
-- triggers arrive in the same instant. Old duplicate pending rows are collapsed before the index.
IF COL_LENGTH('dbo.evaluation_jobs', 'heartbeat_at') IS NULL
  ALTER TABLE dbo.evaluation_jobs ADD heartbeat_at DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.evaluation_jobs', 'attempts') IS NULL
  ALTER TABLE dbo.evaluation_jobs ADD attempts INT NOT NULL CONSTRAINT DF_evaluation_jobs_attempts DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_evaluation_jobs_status_heartbeat_at' AND object_id = OBJECT_ID('dbo.evaluation_jobs'))
  CREATE INDEX IX_evaluation_jobs_status_heartbeat_at ON dbo.evaluation_jobs (status, heartbeat_at);
GO

;WITH DuplicatePending AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY created_at, id) AS rn
  FROM dbo.evaluation_jobs
  WHERE status = 'pending'
)
DELETE FROM DuplicatePending WHERE rn > 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_evaluation_jobs_one_pending_per_course' AND object_id = OBJECT_ID('dbo.evaluation_jobs'))
  CREATE UNIQUE INDEX UX_evaluation_jobs_one_pending_per_course ON dbo.evaluation_jobs (course_id) WHERE status = 'pending';
GO
