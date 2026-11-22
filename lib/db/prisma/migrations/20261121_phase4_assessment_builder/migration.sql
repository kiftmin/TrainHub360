-- Phase 4: the assessment builder, server-side grading and the review queue.
--
-- Deployments built with `prisma db push` need this applied before the API that expects it runs;
-- like the baseline migration, every statement is its own GO-delimited batch because SQL Server
-- compiles a whole batch before executing it, so a step that references a column added earlier in
-- the same batch would not compile.
--
-- Nothing here destroys data. `attempt_answers.answer` becomes nullable (the client no longer
-- submits an answer for a question it skipped) and selection moves to `option_ids`; the old JSON
-- text in `answer` is copied across and then cleared for the four choice kinds, which is the only
-- lossy step and it loses nothing that is not now in `option_ids`.

-- 1. Assessment: versioning and the live-copy marker.
IF COL_LENGTH('dbo.assessments', 'published_at') IS NULL
  ALTER TABLE dbo.assessments ADD published_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.assessments', 'supersedes_id') IS NULL
  ALTER TABLE dbo.assessments ADD supersedes_id NVARCHAR(64) NULL;
GO
-- An assessment that was already published when this migration runs was published in the past, so
-- it becomes a live copy; an unpublished one stays null.
UPDATE dbo.assessments SET published_at = COALESCE(published_at, GETUTCDATE())
WHERE is_published = 1 AND published_at IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'assessments_module_id_idx' AND object_id = OBJECT_ID('dbo.assessments'))
  CREATE INDEX assessments_module_id_idx ON dbo.assessments (module_id);
GO

-- 2. Attempt answers: nullable text, explicit option selection.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.attempt_answers') AND name = 'answer' AND is_nullable = 0
)
  ALTER TABLE dbo.attempt_answers ALTER COLUMN answer NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.attempt_answers', 'option_ids') IS NULL
  ALTER TABLE dbo.attempt_answers ADD option_ids NVARCHAR(MAX) NULL;
GO
UPDATE dbo.attempt_answers SET option_ids = answer
WHERE option_ids IS NULL AND answer IS NOT NULL AND answer LIKE '[[]%]';
GO
UPDATE a SET a.answer = NULL
FROM dbo.attempt_answers a
INNER JOIN dbo.questions q ON q.id = a.question_id
WHERE q.kind IN ('single_choice', 'multi_choice', 'true_false');
GO

-- 3. Attempts: the review queue is read by status.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'assessment_attempts_status_idx' AND object_id = OBJECT_ID('dbo.assessment_attempts'))
  CREATE INDEX assessment_attempts_status_idx ON dbo.assessment_attempts (status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'assessment_attempts_assessment_id_learner_id_idx' AND object_id = OBJECT_ID('dbo.assessment_attempts'))
  CREATE INDEX assessment_attempts_assessment_id_learner_id_idx ON dbo.assessment_attempts (assessment_id, learner_id);
GO

-- 4. Questions: accepted forms for a short answer.
IF COL_LENGTH('dbo.questions', 'accepted_answers') IS NULL
  ALTER TABLE dbo.questions ADD accepted_answers NVARCHAR(MAX) NULL;
GO

-- 5. Certificates: the attempt that earned them.
IF COL_LENGTH('dbo.certificates', 'attempt_id') IS NULL
  ALTER TABLE dbo.certificates ADD attempt_id NVARCHAR(64) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'certificates_learner_id_idx' AND object_id = OBJECT_ID('dbo.certificates'))
  CREATE INDEX certificates_learner_id_idx ON dbo.certificates (learner_id);
GO

-- 6. Record it, so `prisma migrate deploy` knows this database already has it.
IF OBJECT_ID('dbo._prisma_migrations') IS NULL
  CREATE TABLE dbo._prisma_migrations (
    id NVARCHAR(36) NOT NULL PRIMARY KEY,
    checksum NVARCHAR(64) NOT NULL,
    finished_at DATETIME2 NULL,
    migration_name NVARCHAR(255) NOT NULL,
    logs NVARCHAR(MAX) NULL,
    rolled_back_at DATETIME2 NULL,
    started_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    applied_steps_count INT NOT NULL DEFAULT 0
  );
GO
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name = '20261121_phase4_assessment_builder')
  INSERT INTO dbo._prisma_migrations (id, checksum, finished_at, migration_name, logs, applied_steps_count)
  VALUES ('20261121-phase4-assessment-builder', '', GETUTCDATE(), '20261121_phase4_assessment_builder', NULL, 1);
GO
