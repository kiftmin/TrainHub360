-- Round 9 / Phase 2.2: how a version that replaces a live paper was treated.
--
-- "minor" (a typo, wording, a clarified option) carries earlier results forward; "new_paper"
-- (different questions, correct answers or scoring) does not. Null means the question was never
-- asked of this row: a first version, or a draft still being edited.

IF COL_LENGTH('dbo.assessments', 'change_kind') IS NULL
BEGIN
  ALTER TABLE dbo.assessments ADD change_kind NVARCHAR(20) NULL
END
GO
