IF COL_LENGTH('dbo.message_threads', 'course_id') IS NULL
BEGIN
  ALTER TABLE dbo.message_threads ADD course_id NVARCHAR(1000) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_message_threads_course' AND parent_object_id = OBJECT_ID('dbo.message_threads'))
BEGIN
  ALTER TABLE dbo.message_threads ADD CONSTRAINT FK_message_threads_course FOREIGN KEY (course_id) REFERENCES dbo.courses(id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_message_threads_scope' AND object_id = OBJECT_ID('dbo.message_threads'))
BEGIN
  CREATE INDEX IX_message_threads_scope ON dbo.message_threads (org_id, programme_id, course_id, updated_at);
END
GO

IF OBJECT_ID('dbo.message_templates', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.message_templates (
    id          NVARCHAR(1000) NOT NULL CONSTRAINT PK_message_templates PRIMARY KEY,
    org_id      NVARCHAR(1000) NOT NULL,
    title       NVARCHAR(256) NOT NULL,
    body        NVARCHAR(MAX) NOT NULL,
    created_by  NVARCHAR(1000) NOT NULL,
    is_active   BIT NOT NULL CONSTRAINT DF_message_templates_is_active DEFAULT 1,
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_message_templates_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NOT NULL CONSTRAINT DF_message_templates_updated_at DEFAULT SYSUTCDATETIME()
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_message_templates_organization' AND parent_object_id = OBJECT_ID('dbo.message_templates'))
BEGIN
  ALTER TABLE dbo.message_templates ADD CONSTRAINT FK_message_templates_organization FOREIGN KEY (org_id) REFERENCES dbo.organizations(id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_message_templates_org_active' AND object_id = OBJECT_ID('dbo.message_templates'))
BEGIN
  CREATE INDEX IX_message_templates_org_active ON dbo.message_templates (org_id, is_active);
END
GO
