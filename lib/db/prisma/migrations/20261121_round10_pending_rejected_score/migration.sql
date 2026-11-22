-- Round 10 / 1.2: remember the automatic score a programme staff member rejected.
--
-- A repeated evaluation must not keep re-pending the same value after it was refused, but a
-- genuinely different computed score should still be offered for review.

IF COL_LENGTH('dbo.enrolments', 'pending_rejected_score') IS NULL
BEGIN
  ALTER TABLE dbo.enrolments ADD pending_rejected_score FLOAT NULL
END
GO
