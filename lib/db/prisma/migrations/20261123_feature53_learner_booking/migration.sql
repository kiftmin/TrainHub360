IF COL_LENGTH('dbo.bookings', 'learner_id') IS NULL
  ALTER TABLE dbo.bookings ADD learner_id NVARCHAR(450) NULL;
GO
IF COL_LENGTH('dbo.bookings', 'starts_at') IS NULL
  ALTER TABLE dbo.bookings ADD starts_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.bookings', 'ends_at') IS NULL
  ALTER TABLE dbo.bookings ADD ends_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.bookings', 'time_zone') IS NULL
  ALTER TABLE dbo.bookings ADD time_zone NVARCHAR(64) NOT NULL CONSTRAINT DF_bookings_time_zone DEFAULT N'UTC';
GO
IF COL_LENGTH('dbo.bookings', 'duration_minutes') IS NULL
  ALTER TABLE dbo.bookings ADD duration_minutes INT NOT NULL CONSTRAINT DF_bookings_duration_minutes DEFAULT 30;
GO
IF COL_LENGTH('dbo.bookings', 'cancelled_at') IS NULL
  ALTER TABLE dbo.bookings ADD cancelled_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.bookings', 'cancelled_by') IS NULL
  ALTER TABLE dbo.bookings ADD cancelled_by NVARCHAR(450) NULL;
GO
IF COL_LENGTH('dbo.bookings', 'cancellation_reason') IS NULL
  ALTER TABLE dbo.bookings ADD cancellation_reason NVARCHAR(1000) NULL;
GO
IF COL_LENGTH('dbo.bookings', 'availability_id') IS NULL
  ALTER TABLE dbo.bookings ADD availability_id NVARCHAR(450) NULL;
GO
IF OBJECT_ID('dbo.trainer_availability', 'U') IS NULL
  CREATE TABLE dbo.trainer_availability (
    id NVARCHAR(450) NOT NULL CONSTRAINT PK_trainer_availability PRIMARY KEY,
    trainer_id NVARCHAR(450) NOT NULL,
    org_id NVARCHAR(450) NOT NULL,
    programme_id NVARCHAR(450) NULL,
    course_id NVARCHAR(450) NULL,
    day_of_week INT NOT NULL,
    start_time NVARCHAR(5) NOT NULL,
    end_time NVARCHAR(5) NOT NULL,
    time_zone NVARCHAR(64) NOT NULL CONSTRAINT DF_trainer_availability_time_zone DEFAULT N'UTC',
    slot_minutes INT NOT NULL CONSTRAINT DF_trainer_availability_slot_minutes DEFAULT 30,
    is_active BIT NOT NULL CONSTRAINT DF_trainer_availability_is_active DEFAULT 1,
    valid_from DATE NULL,
    valid_to DATE NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_trainer_availability_created_at DEFAULT SYSUTCDATETIME()
  );
GO
IF OBJECT_ID('dbo.trainer_availability_exceptions', 'U') IS NULL
  CREATE TABLE dbo.trainer_availability_exceptions (
    id NVARCHAR(450) NOT NULL CONSTRAINT PK_trainer_availability_exceptions PRIMARY KEY,
    trainer_id NVARCHAR(450) NOT NULL,
    org_id NVARCHAR(450) NOT NULL,
    programme_id NVARCHAR(450) NULL,
    course_id NVARCHAR(450) NULL,
    date DATE NOT NULL,
    starts_at DATETIME2 NULL,
    ends_at DATETIME2 NULL,
    is_available BIT NOT NULL CONSTRAINT DF_trainer_availability_exceptions_is_available DEFAULT 0,
    reason NVARCHAR(1000) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_trainer_availability_exceptions_created_at DEFAULT SYSUTCDATETIME()
  );
GO
UPDATE dbo.bookings
SET duration_minutes = CASE
  WHEN duration LIKE '%h%' THEN COALESCE(TRY_CAST(REPLACE(duration, 'h', '') AS INT), 1) * 60
  WHEN duration LIKE '%m%' THEN COALESCE(TRY_CAST(REPLACE(duration, 'm', '') AS INT), 30)
  ELSE 30
END
WHERE duration_minutes = 30 AND duration IS NOT NULL AND duration NOT IN ('', '30m');
GO
UPDATE dbo.bookings
SET starts_at = TRY_CONVERT(DATETIME2(0), CONVERT(NVARCHAR(20), date) + N'T' + CASE WHEN LEN(LTRIM(RTRIM(CONVERT(NVARCHAR(10), time)))) = 5 THEN LTRIM(RTRIM(CONVERT(NVARCHAR(10), time))) + N':00' ELSE LTRIM(RTRIM(CONVERT(NVARCHAR(10), time))) END)
WHERE starts_at IS NULL AND date IS NOT NULL AND time IS NOT NULL;
GO
UPDATE dbo.bookings
SET ends_at = DATEADD(MINUTE, CASE WHEN duration_minutes BETWEEN 1 AND 480 THEN duration_minutes ELSE 30 END, starts_at)
WHERE ends_at IS NULL AND starts_at IS NOT NULL;
GO
UPDATE dbo.bookings
SET status = N'legacy_conflict'
WHERE status = N'confirmed' AND starts_at IS NOT NULL AND id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY trainer_id, starts_at ORDER BY starts_at, id) AS rn
    FROM dbo.bookings
    WHERE status = N'confirmed' AND starts_at IS NOT NULL AND trainer_id IS NOT NULL
  ) ranked WHERE rn > 1
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_learner_starts_at' AND object_id = OBJECT_ID('dbo.bookings'))
  CREATE INDEX IX_bookings_learner_starts_at ON dbo.bookings (learner_id, starts_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_trainer_starts_status' AND object_id = OBJECT_ID('dbo.bookings'))
  CREATE INDEX IX_bookings_trainer_starts_status ON dbo.bookings (trainer_id, starts_at, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_bookings_one_confirmed_per_trainer_start' AND object_id = OBJECT_ID('dbo.bookings'))
  CREATE UNIQUE INDEX UX_bookings_one_confirmed_per_trainer_start ON dbo.bookings (trainer_id, starts_at) WHERE status = N'confirmed' AND starts_at IS NOT NULL AND trainer_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_trainer_availability_trainer_day_active' AND object_id = OBJECT_ID('dbo.trainer_availability'))
  CREATE INDEX IX_trainer_availability_trainer_day_active ON dbo.trainer_availability (trainer_id, day_of_week, is_active);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_trainer_availability_exceptions_trainer_date' AND object_id = OBJECT_ID('dbo.trainer_availability_exceptions'))
  CREATE INDEX IX_trainer_availability_exceptions_trainer_date ON dbo.trainer_availability_exceptions (trainer_id, date);
GO
