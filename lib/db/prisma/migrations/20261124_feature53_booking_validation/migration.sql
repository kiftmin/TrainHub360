CREATE OR ALTER VIEW dbo.v_feature53_booking_migration_review AS
SELECT
  b.id,
  b.org_id,
  b.trainer_id,
  b.learner_id,
  b.starts_at,
  b.ends_at,
  b.time_zone,
  b.status,
  CASE WHEN b.time_zone = N'UTC' THEN 1 ELSE 0 END AS timezone_unverified,
  CASE WHEN b.trainer_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM dbo.bookings other
    WHERE other.id <> b.id
      AND other.status = N'confirmed'
      AND other.trainer_id = b.trainer_id
      AND other.starts_at < COALESCE(b.ends_at, DATEADD(MINUTE, CASE WHEN b.duration_minutes BETWEEN 1 AND 480 THEN b.duration_minutes ELSE 30 END, b.starts_at))
      AND COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) > b.starts_at
  ) THEN 1 ELSE 0 END AS trainer_overlap,
  CASE WHEN b.learner_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM dbo.bookings other
    WHERE other.id <> b.id
      AND other.status = N'confirmed'
      AND other.learner_id = b.learner_id
      AND other.starts_at < COALESCE(b.ends_at, DATEADD(MINUTE, CASE WHEN b.duration_minutes BETWEEN 1 AND 480 THEN b.duration_minutes ELSE 30 END, b.starts_at))
      AND COALESCE(other.ends_at, DATEADD(MINUTE, CASE WHEN other.duration_minutes BETWEEN 1 AND 480 THEN other.duration_minutes ELSE 30 END, other.starts_at)) > b.starts_at
  ) THEN 1 ELSE 0 END AS learner_overlap,
  CASE
    WHEN b.status = N'legacy_conflict' THEN N'legacy duplicate start conflict; interval review required'
    WHEN b.time_zone = N'UTC' THEN N'UTC backfill source timezone unverified; interval review required'
    ELSE N'no automated migration concern detected'
  END AS review_reason
FROM dbo.bookings b
WHERE b.starts_at IS NOT NULL;
