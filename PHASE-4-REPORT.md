# Phase 4 — server-graded attempts, review queue, certificates

Everything a learner's score means is now decided on the server. A client can start an attempt,
save answers and submit, but it can never say what an answer is worth, and it never sees a key or
a rubric.

## What was built

### 1. The assessment builder is versioned

- `Assessment` gains `publishedAt` and `supersedesId`; `Question` gains `acceptedAnswers`.
- **Publishing freezes the paper.** `POST /assessments/:id/publish` stamps `publishedAt`. Any later
  edit — a new question, a reorder, a `PATCH`, a `DELETE` — clones the assessment into a new row
  (`version + 1`, `supersedesId` → the old row) and applies the change there. The old row keeps its
  attempts and its published snapshot, but stops being live (`isPublished: false`,
  `publishedAt: null`), so nobody can start it again. "Live" therefore means exactly
  `isPublished && publishedAt !== null && !isArchived && deletedAt === null`.
- Publish refuses a paper that cannot be graded: a recall assessment cannot carry a scenario, an
  applied one must, and objective questions need exactly one correct option (`publishProblem()`).
- `PUT /assessments/:id/questions/order` reorders within the current version.

### 2. Attempts are graded server-side, never from the client

- `POST /assessments/:id/attempts` checks eligibility (enrolment, live assessment, `maxAttempts`)
  and **resumes** an attempt that is already open instead of counting a new one.
- `PUT /attempts/:id/answers` saves what the learner typed or picked, and enforces the time limit.
- `POST /attempts/:id/submit` grades every objective question with `gradeObjective()`:
  - `single_choice`, `multi_choice`, `true_false` and short answer are objective;
  - a choice question is correct only when **every** correct option is picked and **none** wrong
    one is; `single_choice`/`true_false` must have exactly one pick;
  - short answer is correct when it matches `acceptedAnswers` (case/space-insensitive).
- Anything with a manual question (`scenario`, `short_answer` without accepted forms) goes to
  status `grading`, and **a partial grade is not a result**: `score`, `percent` and `passed` stay
  `null` until a person finishes it, so nothing downstream reads it as a pass or a fail.

### 3. The review queue

- `GET /assessments/grading/queue` lists attempts waiting for a marker, scoped to the programmes
  the caller actually holds a grant on.
- `GET /attempts/:id/answers` is the staff view: the key, the rubric and what was answered.
  `GET /attempts/:id` gives the learner view — no `isCorrect`, no rubric.
- `POST /attempts/:id/grade` refuses to finish until **every** manual question is marked, and
  refuses an already-graded attempt with `409` (a correction is a new attempt, not a rewrite).
- `assertNotGradingSelf` middleware: you cannot mark your own attempt — `403` on your own, `404`
  across organizations, and a live programme grant is required.

### 4. Competence, scores and certificates

- `applyAttemptOutcome()` recomputes the enrolment after every graded attempt:
  - **best applied score, never the latest** — a worse later attempt cannot revoke competence;
  - the review-credit score is recalculated from the new applied score;
  - **competence** = every live applied assessment of the course met **and** the content finished
    (`completionDate` or status `completed`).
- A competent, completed enrolment on a validity-window or compliance course issues a
  `Certificate` that records the `attemptId` that earned it (`issueCertificateForEnrolment(id,
  attemptId)`); a certificate issued earlier from a staff status change is attached to the attempt
  once the evidence exists, instead of being issued twice.

## Files

| File | Change |
| --- | --- |
| `lib/db/prisma/schema.prisma` | `publishedAt`, `supersedesId`, `acceptedAnswers`, `AttemptAnswer.optionIds`, uniqueness on `(attemptId, questionId)`, `Certificate.attemptId`, indexes |
| `lib/db/prisma/migrations/20261121_phase4_assessment_builder/migration.sql` | GO-split, guarded migration — applied |
| `lib/api/src/services/assessment.ts` | grading, versioning, outcome, competence |
| `lib/api/src/services/certificates.ts` | `attemptId` on issue |
| `lib/api/src/middleware/grading.ts` | `assertNotGradingSelf` |
| `lib/api/src/middleware/rbac.ts` | resolves `/attempts/:id` to its programme |
| `lib/api/src/routes/index.ts` | 12 new routes; the legacy `POST /courses/:id/attempts` now answers `410` |
| `lib/api/tests/phase-4.test.js` | 17 cases |

## Verification

- API build clean; workspace typecheck clean; frontend typecheck clean.
- `phase-4.test.js`: **17/17**.
- Full API suite: **139 tests, 138 passing.** The one failure (`auth.test.js` → "correct password
  succeeds") passes on its own and is a test-isolation issue in the runner, not a login bug: the
  per-IP login throttle lives in each test process and CI runs every file from `127.0.0.1`, so a
  neighbouring file's failed logins can land in the same bucket. See "Open" below.
- `content-assessment.test.js` was updated to the new question shape (`kind`, `points`) because
  the builder no longer accepts the pre-Phase-4 payload.

## Open

1. **`auth.test.js` throttle isolation.** The suite runs files in one process group on CI; the fix
   is to have every file reset the throttle in `before()` (as `a2-gaps.test.js` does) or to key the
   bucket by `NODE_TEST_CONTEXT`. Not a product bug — but the suite should be green.
2. `openapi.yaml` does not yet carry the Phase 4 routes, so codegen has not been re-run for them.
3. Still open from earlier rounds: Phase 3 trainer verification UI and the three-tab builder, the
   S3/Azure `StorageProvider` with a real `scanUpload`, Phase 5.4/5.5 (reminder cadence, `.ics`
   export), Phase E verification UI, and the round-6 low items.
