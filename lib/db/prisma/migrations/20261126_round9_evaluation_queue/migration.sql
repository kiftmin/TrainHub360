-- Round 9 / Phase 3.3: course-wide re-evaluation runs in a queue, not inside the request.
--
-- Publishing a paper or adding a required item used to loop over every enrolment of the course
-- while the trainer waited. The route now writes one job row and returns; the worker takes 50
-- enrolments per tick. One pending job per course is enough — a second trigger while one is due
-- only means "recalculate this course", which the row already says.
IF OBJECT_ID('dbo.evaluation_jobs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.evaluation_jobs (
    id          NVARCHAR(1000) NOT NULL CONSTRAINT PK_evaluation_jobs PRIMARY KEY,
    course_id   NVARCHAR(1000) NOT NULL,
    trigger_name NVARCHAR(1000) NOT NULL,
    status      NVARCHAR(1000) NOT NULL CONSTRAINT DF_evaluation_jobs_status DEFAULT 'pending',
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_evaluation_jobs_created_at DEFAULT SYSUTCDATETIME(),
    started_at  DATETIME2 NULL,
    finished_at DATETIME2 NULL,
    processed   INT NOT NULL CONSTRAINT DF_evaluation_jobs_processed DEFAULT 0,
    total       INT NOT NULL CONSTRAINT DF_evaluation_jobs_total DEFAULT 0,
    last_error  NVARCHAR(MAX) NULL
  );
END
GO
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_evaluation_jobs_course_id_status' AND object_id = OBJECT_ID('dbo.evaluation_jobs'))
  CREATE INDEX IX_evaluation_jobs_course_id_status ON dbo.evaluation_jobs (course_id, status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_evaluation_jobs_status_created_at' AND object_id = OBJECT_ID('dbo.evaluation_jobs'))
  CREATE INDEX IX_evaluation_jobs_status_created_at ON dbo.evaluation_jobs (status, created_at);
GO
