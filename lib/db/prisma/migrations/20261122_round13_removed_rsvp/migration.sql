-- Round 13 / Phase 4.1: staff removal is not a learner decline.

IF COL_LENGTH('dbo.session_rsvps', 'removed_by') IS NULL
BEGIN
  ALTER TABLE dbo.session_rsvps ADD removed_by NVARCHAR(64) NULL;
END;
GO

IF COL_LENGTH('dbo.session_rsvps', 'removed_at') IS NULL
BEGIN
  ALTER TABLE dbo.session_rsvps ADD removed_at DATETIME2 NULL;
END;
GO

IF COL_LENGTH('dbo.session_rsvps', 'removal_reason') IS NULL
BEGIN
  ALTER TABLE dbo.session_rsvps ADD removal_reason NVARCHAR(1000) NULL;
END;
GO
