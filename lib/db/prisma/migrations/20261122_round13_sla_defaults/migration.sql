-- Round 13 / Phase 2: response-SLA defaults.
--
-- Guarded so `prisma:baseline` can apply this after `prisma db push` on both fresh and existing
-- databases. The organization default is 24 hours; a programme may override it.

IF COL_LENGTH('dbo.organizations', 'default_sla_hours') IS NULL
  ALTER TABLE dbo.organizations ADD default_sla_hours INT NOT NULL CONSTRAINT DF_organizations_default_sla_hours DEFAULT 24;
GO

IF COL_LENGTH('dbo.programmes', 'sla_hours') IS NULL
  ALTER TABLE dbo.programmes ADD sla_hours INT NULL;
GO
