-- Round 13 / Phase 1: one active certificate per enrolment, and database-level dedupe keys
-- for the other side effects of completing an enrolment.
--
-- Every statement is guarded because setup pushes the Prisma schema first and then applies the
-- migration-only objects through `prisma:baseline`. The duplicate cleanup runs before the unique
-- index so an existing database with two active certificates can still be migrated.

IF COL_LENGTH('dbo.notifications', 'dedupe_key') IS NULL
  ALTER TABLE dbo.notifications ADD dedupe_key NVARCHAR(200) NULL;
GO

IF COL_LENGTH('dbo.recognitions', 'dedupe_key') IS NULL
  ALTER TABLE dbo.recognitions ADD dedupe_key NVARCHAR(200) NULL;
GO

-- Keep the earliest certificate and revoke the rest. The audit rows make the repair visible.
IF OBJECT_ID('tempdb..#round13_duplicate_certificates') IS NOT NULL DROP TABLE #round13_duplicate_certificates;
GO

;WITH Ranked AS (
  SELECT id, enrolment_id, learner_id, course_id,
         ROW_NUMBER() OVER (PARTITION BY enrolment_id ORDER BY issued_at, id) AS rn
  FROM dbo.certificates
  WHERE status = 'active' AND enrolment_id IS NOT NULL
)
SELECT id, enrolment_id, learner_id, course_id
INTO #round13_duplicate_certificates
FROM Ranked WHERE rn > 1;
GO

DECLARE @revoked INT = 0;
DECLARE @enrolments INT = 0;
SELECT @revoked = COUNT(*), @enrolments = COUNT(DISTINCT enrolment_id) FROM #round13_duplicate_certificates;
UPDATE c
SET status = 'revoked'
FROM dbo.certificates c
JOIN #round13_duplicate_certificates d ON d.id = c.id;
INSERT INTO dbo.audit_logs (id, user_id, action, entity, entity_id, timestamp, details)
SELECT CONVERT(NVARCHAR(1000), NEWID()), NULL, N'CERTIFICATE_DUPLICATE_REVOKED', N'certificate', d.id, SYSUTCDATETIME(),
       CONCAT(N'enrolment=', d.enrolment_id, N' learner=', d.learner_id, N' course=', d.course_id)
FROM #round13_duplicate_certificates d;
PRINT CONCAT(N'Round 13 certificate cleanup: ', @revoked, N' duplicate certificates revoked across ', @enrolments, N' enrolments.');
SELECT @revoked AS revoked_certificates, @enrolments AS affected_enrolments;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_certificates_one_active_per_enrolment' AND object_id = OBJECT_ID('dbo.certificates'))
  CREATE UNIQUE INDEX UX_certificates_one_active_per_enrolment ON dbo.certificates (enrolment_id) WHERE status = 'active' AND enrolment_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_notifications_one_per_user_dedupe_key' AND object_id = OBJECT_ID('dbo.notifications'))
  CREATE UNIQUE INDEX UX_notifications_one_per_user_dedupe_key ON dbo.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_recognitions_one_per_user_dedupe_key' AND object_id = OBJECT_ID('dbo.recognitions'))
  CREATE UNIQUE INDEX UX_recognitions_one_per_user_dedupe_key ON dbo.recognitions (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
GO
