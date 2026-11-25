IF COL_LENGTH(N'dbo.bookings', N'timezone_provenance') IS NULL
  ALTER TABLE dbo.bookings ADD timezone_provenance NVARCHAR(32) NULL;
GO
UPDATE dbo.bookings
SET timezone_provenance = CASE WHEN time_zone = N'UTC' THEN N'ASSUMED_UTC_BACKFILL' ELSE N'UNVERIFIED_LEGACY' END
WHERE timezone_provenance IS NULL;
GO
UPDATE dbo.bookings
SET starts_at = TRY_CONVERT(DATETIME2(0), CONVERT(NVARCHAR(20), date) + N'T' + CASE WHEN LEN(LTRIM(RTRIM(CONVERT(NVARCHAR(10), time)))) = 5 THEN LTRIM(RTRIM(CONVERT(NVARCHAR(10), time))) + N':00' ELSE LTRIM(RTRIM(CONVERT(NVARCHAR(10), time))) END)
WHERE starts_at IS NULL AND date IS NOT NULL AND time IS NOT NULL;
GO
UPDATE dbo.bookings
SET ends_at = DATEADD(MINUTE, CASE WHEN duration_minutes BETWEEN 1 AND 480 THEN duration_minutes ELSE 30 END, starts_at)
WHERE ends_at IS NULL AND starts_at IS NOT NULL;
GO
CREATE OR ALTER VIEW dbo.v_feature53_booking_migration_review AS
SELECT
  b.id,
  b.org_id,
  b.trainer_id,
  b.learner_id,
  b.date,
  b.time,
  b.duration,
  b.duration_minutes,
  b.starts_at,
  b.ends_at,
  b.time_zone,
  b.timezone_provenance,
  b.status,
  CASE
    WHEN b.timezone_provenance IN (N'VERIFIED_TRAINER_ZONE', N'VERIFIED_SOURCE') THEN N'verified'
    WHEN b.timezone_provenance = N'ASSUMED_UTC_BACKFILL' THEN N'assumed_utc'
    WHEN b.timezone_provenance = N'UNVERIFIED_LEGACY' OR b.timezone_provenance IS NULL THEN N'unverified'
    ELSE N'unknown'
  END AS timezone_status,
  CASE WHEN b.timezone_provenance IN (N'VERIFIED_TRAINER_ZONE', N'VERIFIED_SOURCE') THEN 1 ELSE 0 END AS timezone_verified,
  CASE WHEN b.timezone_provenance = N'ASSUMED_UTC_BACKFILL' THEN 1 ELSE 0 END AS timezone_assumed,
  CASE WHEN b.timezone_provenance NOT IN (N'VERIFIED_TRAINER_ZONE', N'VERIFIED_SOURCE') OR b.timezone_provenance IS NULL THEN 1 ELSE 0 END AS timezone_unverified,
  CASE WHEN b.learner_id IS NULL OR LTRIM(RTRIM(b.learner_id)) = N'' THEN 1 ELSE 0 END AS missing_learner,
  CASE WHEN b.duration_minutes IS NULL OR b.duration_minutes NOT BETWEEN 1 AND 480 THEN 1 ELSE 0 END AS invalid_duration,
  CASE WHEN b.starts_at IS NULL OR bnd.effective_end IS NULL OR bnd.effective_end <= b.starts_at THEN 1 ELSE 0 END AS invalid_interval,
  CASE WHEN b.timezone_provenance IN (N'ASSUMED_UTC_BACKFILL', N'UNVERIFIED_LEGACY')
    AND (
      b.date IS NULL OR b.time IS NULL OR LTRIM(RTRIM(b.date)) = N'' OR LTRIM(RTRIM(b.time)) = N''
      OR legacy.legacy_start IS NULL
      OR (b.starts_at IS NOT NULL AND b.starts_at <> legacy.legacy_start)
    ) THEN 1 ELSE 0 END AS incomplete_legacy_value,
  CASE WHEN b.status = N'confirmed' AND b.trainer_id IS NOT NULL AND bnd.effective_end IS NOT NULL AND EXISTS (
    SELECT 1
    FROM dbo.bookings other
    CROSS APPLY (
      SELECT COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) AS other_end
    ) obnd
    WHERE other.id <> b.id
      AND other.status = N'confirmed'
      AND other.trainer_id = b.trainer_id
      AND other.starts_at < bnd.effective_end
      AND obnd.other_end > b.starts_at
  ) THEN 1 ELSE 0 END AS trainer_overlap,
  CASE WHEN b.status = N'confirmed' AND b.learner_id IS NOT NULL AND bnd.effective_end IS NOT NULL AND EXISTS (
    SELECT 1
    FROM dbo.bookings other
    CROSS APPLY (
      SELECT COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) AS other_end
    ) obnd
    WHERE other.id <> b.id
      AND other.status = N'confirmed'
      AND other.learner_id = b.learner_id
      AND other.starts_at < bnd.effective_end
      AND obnd.other_end > b.starts_at
  ) THEN 1 ELSE 0 END AS learner_overlap,
  CONVERT(NVARCHAR(MAX), CONCAT_WS(N'; ',
    CASE
      WHEN b.timezone_provenance IN (N'VERIFIED_TRAINER_ZONE', N'VERIFIED_SOURCE') THEN N'timezone verified from booking source'
      WHEN b.timezone_provenance = N'ASSUMED_UTC_BACKFILL' THEN N'timezone assumed as UTC by migration; original date/time preserved'
      WHEN b.timezone_provenance = N'UNVERIFIED_LEGACY' OR b.timezone_provenance IS NULL THEN N'timezone unknown; original date/time preserved'
      ELSE N'timezone provenance unknown'
    END,
    CASE WHEN b.status <> N'confirmed' THEN CONCAT(N'inactive status: ', b.status) END,
    CASE WHEN b.starts_at IS NULL OR bnd.effective_end IS NULL OR bnd.effective_end <= b.starts_at THEN N'invalid or missing timestamp interval' END,
    CASE WHEN b.duration_minutes IS NULL OR b.duration_minutes NOT BETWEEN 1 AND 480 THEN N'invalid duration' END,
    CASE WHEN b.learner_id IS NULL OR LTRIM(RTRIM(b.learner_id)) = N'' THEN N'missing learner ownership' END,
    CASE WHEN b.timezone_provenance IN (N'ASSUMED_UTC_BACKFILL', N'UNVERIFIED_LEGACY')
      AND (
        b.date IS NULL OR b.time IS NULL OR LTRIM(RTRIM(b.date)) = N'' OR LTRIM(RTRIM(b.time)) = N''
        OR legacy.legacy_start IS NULL
        OR (b.starts_at IS NOT NULL AND b.starts_at <> legacy.legacy_start)
      ) THEN N'incomplete or inconsistent legacy date/time' END,
    CASE WHEN b.status = N'confirmed' AND b.trainer_id IS NOT NULL AND bnd.effective_end IS NOT NULL AND EXISTS (
      SELECT 1 FROM dbo.bookings other
      WHERE other.id <> b.id AND other.status = N'confirmed' AND other.trainer_id = b.trainer_id
        AND other.starts_at < bnd.effective_end
        AND COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) > b.starts_at
    ) THEN N'confirmed trainer interval overlap' END,
    CASE WHEN b.status = N'confirmed' AND b.learner_id IS NOT NULL AND bnd.effective_end IS NOT NULL AND EXISTS (
      SELECT 1 FROM dbo.bookings other
      WHERE other.id <> b.id AND other.status = N'confirmed' AND other.learner_id = b.learner_id
        AND other.starts_at < bnd.effective_end
        AND COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) > b.starts_at
    ) THEN N'confirmed learner interval overlap' END,
    CASE WHEN b.status = N'confirmed'
      AND b.timezone_provenance IN (N'VERIFIED_TRAINER_ZONE', N'VERIFIED_SOURCE')
      AND b.learner_id IS NOT NULL AND LTRIM(RTRIM(b.learner_id)) <> N''
      AND b.starts_at IS NOT NULL AND bnd.effective_end IS NOT NULL AND bnd.effective_end > b.starts_at
      AND b.duration_minutes BETWEEN 1 AND 480
      AND NOT EXISTS (
        SELECT 1 FROM dbo.bookings other
        WHERE other.id <> b.id AND other.status = N'confirmed'
          AND (other.trainer_id = b.trainer_id OR other.learner_id = b.learner_id)
          AND other.starts_at < bnd.effective_end
          AND COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) > b.starts_at
      )
      THEN N'no automated migration concern detected' END
  )) AS review_reason,
  CASE WHEN b.status = N'confirmed'
    AND b.timezone_provenance IN (N'VERIFIED_TRAINER_ZONE', N'VERIFIED_SOURCE')
    AND b.learner_id IS NOT NULL AND LTRIM(RTRIM(b.learner_id)) <> N''
    AND b.starts_at IS NOT NULL AND bnd.effective_end IS NOT NULL AND bnd.effective_end > b.starts_at
    AND b.duration_minutes BETWEEN 1 AND 480
    AND NOT EXISTS (
      SELECT 1 FROM dbo.bookings other
      WHERE other.id <> b.id AND other.status = N'confirmed'
        AND (other.trainer_id = b.trainer_id OR other.learner_id = b.learner_id)
        AND other.starts_at < bnd.effective_end
        AND COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) > b.starts_at
    )
    THEN 1 ELSE 0 END AS schedule_authoritative
FROM dbo.bookings b
CROSS APPLY (
  SELECT COALESCE(b.ends_at, DATEADD(MINUTE, CASE WHEN b.duration_minutes BETWEEN 1 AND 480 THEN b.duration_minutes ELSE 30 END, b.starts_at)) AS effective_end
) bnd
CROSS APPLY (
  SELECT TRY_CONVERT(DATETIME2(0), CONVERT(NVARCHAR(20), b.date) + N'T' + CASE WHEN LEN(LTRIM(RTRIM(CONVERT(NVARCHAR(10), b.time)))) = 5 THEN LTRIM(RTRIM(CONVERT(NVARCHAR(10), b.time))) + N':00' ELSE LTRIM(RTRIM(CONVERT(NVARCHAR(10), b.time))) END) AS legacy_start
) legacy;
GO
