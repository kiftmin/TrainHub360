IF OBJECT_ID(N'dbo.user_roles', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.key_constraints kc
             JOIN sys.tables t ON t.object_id = kc.parent_object_id
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             WHERE s.name = N'dbo' AND t.name = N'user_roles'
               AND kc.type = N'UQ' AND kc.name = N'user_roles_user_id_role_id_key')
  BEGIN
    ALTER TABLE [dbo].[user_roles] DROP CONSTRAINT [user_roles_user_id_role_id_key];
  END

  IF NOT EXISTS (SELECT 1 FROM sys.indexes i
                 JOIN sys.tables t ON t.object_id = i.object_id
                 JOIN sys.schemas s ON s.schema_id = t.schema_id
                 WHERE s.name = N'dbo' AND t.name = N'user_roles'
                   AND i.name = N'UX_user_roles_one_grant_per_programme')
  BEGIN
    CREATE UNIQUE INDEX [UX_user_roles_one_grant_per_programme]
      ON [dbo].[user_roles] ([user_id], [role_id], [programme_id])
      WHERE [programme_id] IS NOT NULL;
  END

  IF NOT EXISTS (SELECT 1 FROM sys.indexes i
                 JOIN sys.tables t ON t.object_id = i.object_id
                 JOIN sys.schemas s ON s.schema_id = t.schema_id
                 WHERE s.name = N'dbo' AND t.name = N'user_roles'
                   AND i.name = N'UX_user_roles_one_org_wide_grant')
  BEGIN
    CREATE UNIQUE INDEX [UX_user_roles_one_org_wide_grant]
      ON [dbo].[user_roles] ([user_id], [role_id])
      WHERE [programme_id] IS NULL;
  END
END
