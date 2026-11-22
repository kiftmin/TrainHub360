-- Round 9 / Phase 1.2: how an enrolment came to be completed.
--
-- The certificate rule now requires a completion source, so a status set by hand cannot stand in
-- for evidence. Existing completed enrolments are backfilled by the same rule evaluateEnrolment
-- uses: "assessment" when the content is complete and every live applied assessment is passed,
-- "manual" otherwise.

IF COL_LENGTH('dbo.enrolments', 'completion_source') IS NULL
BEGIN
  ALTER TABLE dbo.enrolments ADD completion_source NVARCHAR(20) NULL
END
GO

UPDATE enrolments
SET completion_source = CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM dbo.content_items ci
      JOIN dbo.modules m ON m.id = ci.module_id
      WHERE m.course_id = enrolments.course_id
        AND m.is_archived = 0
        AND ci.is_archived = 0
        AND ci.required = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.content_progress cp
          WHERE cp.enrolment_id = enrolments.id AND cp.content_item_id = ci.id AND cp.status = 'completed'
        )
    )
    AND EXISTS (
      SELECT 1 FROM dbo.assessments a
      JOIN dbo.modules m2 ON m2.id = a.module_id
      WHERE m2.course_id = enrolments.course_id
        AND m2.is_archived = 0 AND m2.deleted_at IS NULL
        AND a.type = 'applied' AND a.is_published = 1
        AND a.is_archived = 0 AND a.deleted_at IS NULL AND a.superseded_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM dbo.assessments a
      JOIN dbo.modules m3 ON m3.id = a.module_id
      LEFT JOIN dbo.courses c ON c.id = m3.course_id
      WHERE m3.course_id = enrolments.course_id
        AND m3.is_archived = 0 AND m3.deleted_at IS NULL
        AND a.type = 'applied' AND a.is_published = 1
        AND a.is_archived = 0 AND a.deleted_at IS NULL AND a.superseded_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM (SELECT assessment_id, enrolment_id, status, [percent] AS pc FROM dbo.assessment_attempts) aa
          WHERE aa.assessment_id = a.id AND aa.enrolment_id = enrolments.id
            AND aa.status IN ('submitted', 'graded')
            AND aa.pc IS NOT NULL
            AND aa.pc >= ISNULL(a.pass_mark, ISNULL(c.applied_threshold, 70))
        )
    )
    THEN 'assessment'
    ELSE 'manual'
  END
WHERE enrolments.status = 'completed' AND enrolments.completion_source IS NULL
GO
