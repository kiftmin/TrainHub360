-- Round 8: the enrolment outcome, score sources, membership history and reminder fixes.
--
-- Deployments built with `prisma db push` need this applied before the API that expects it runs;
-- like the earlier migrations, every statement is its own GO-delimited batch because SQL Server
-- compiles a whole batch before executing it, so a step that references a column added earlier in
-- the same batch would not compile.
--
-- Nothing here destroys data. The new columns are nullable or defaulted, so existing rows keep
-- their meaning: an existing enrolment's score came from its assessments, which is the new
-- default, and an existing thread participant is still a member until an access check says
-- otherwise (left_at stays null).

-- 1. Assessments: a later version marks this one superseded without unpublishing it, so attempts
--    already open on this version can still be saved and graded.
IF COL_LENGTH('dbo.assessments', 'superseded_at') IS NULL
  ALTER TABLE dbo.assessments ADD superseded_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.assessments', 'superseded_by_id') IS NULL
  ALTER TABLE dbo.assessments ADD superseded_by_id NVARCHAR(64) NULL;
GO

-- 2. Enrolments: where the score came from, the pending result an override holds back, and the
--    moment the content itself was finished (completion is still not competence).
IF COL_LENGTH('dbo.enrolments', 'applied_score_source') IS NULL
  ALTER TABLE dbo.enrolments ADD applied_score_source NVARCHAR(1000) NOT NULL CONSTRAINT DF_enrolments_applied_score_source DEFAULT 'assessment';
GO
IF COL_LENGTH('dbo.enrolments', 'applied_score_override_reason') IS NULL
  ALTER TABLE dbo.enrolments ADD applied_score_override_reason NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.enrolments', 'applied_score_overridden_by') IS NULL
  ALTER TABLE dbo.enrolments ADD applied_score_overridden_by NVARCHAR(64) NULL;
GO
IF COL_LENGTH('dbo.enrolments', 'applied_score_overridden_at') IS NULL
  ALTER TABLE dbo.enrolments ADD applied_score_overridden_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.enrolments', 'pending_assessment_score') IS NULL
  ALTER TABLE dbo.enrolments ADD pending_assessment_score FLOAT NULL;
GO
IF COL_LENGTH('dbo.enrolments', 'pending_assessment_score_at') IS NULL
  ALTER TABLE dbo.enrolments ADD pending_assessment_score_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.enrolments', 'content_completed_at') IS NULL
  ALTER TABLE dbo.enrolments ADD content_completed_at DATETIME2 NULL;
GO
-- An enrolment that is already complete had its content finished by the time staff signed it off,
-- so seed the new column from the completion date rather than leaving it empty.
UPDATE dbo.enrolments SET content_completed_at = completion_date
WHERE content_completed_at IS NULL AND completion_date IS NOT NULL;
GO

-- 3. Thread participants: revoking keeps the row for audit, re-adding clears it.
IF COL_LENGTH('dbo.thread_participants', 'left_at') IS NULL
  ALTER TABLE dbo.thread_participants ADD left_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.thread_participants', 'left_reason') IS NULL
  ALTER TABLE dbo.thread_participants ADD left_reason NVARCHAR(512) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'thread_participants_user_id_idx' AND object_id = OBJECT_ID('dbo.thread_participants'))
  CREATE INDEX thread_participants_user_id_idx ON dbo.thread_participants (user_id);
GO

-- 4. Session RSVPs: promotion follows when the learner joined the waitlist, not when they last
--    responded. Rows already waiting are seeded from the response time they do have.
IF COL_LENGTH('dbo.session_rsvps', 'waitlisted_at') IS NULL
  ALTER TABLE dbo.session_rsvps ADD waitlisted_at DATETIME2 NULL;
GO
UPDATE dbo.session_rsvps SET waitlisted_at = COALESCE(responded_at, created_at)
WHERE status = 'waitlisted' AND waitlisted_at IS NULL;
GO
