IF COL_LENGTH(N'dbo.sessions', N'cancellation_reason') IS NULL
  ALTER TABLE dbo.sessions ADD cancellation_reason NVARCHAR(1000) NULL;
GO
