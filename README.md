# TrainHub360

Corporate training platform proving training worked, not just that it happened.

## Database: SQL Server
`lib/db/prisma/schema.prisma` targets your MSSQL instance via Prisma (`provider = "sqlserver"`).

1. Copy env template: `cp .env.example .env` and set the real SA password in `DATABASE_URL`:
   `sqlserver://69.30.247.60:1433;database=TrainHub360;user=sa;password=<SECRET>;trustServerCertificate=true`
2. Generate + push schema:
   `pnpm --filter @workspace/db run prisma:generate`
   `pnpm --filter @workspace/db run prisma:push`
3. Run API: `PORT=4000 pnpm --filter @workspace/api run dev`
4. Health: `GET /api/healthz` (liveness) � `GET /api/readyz` (includes MSSQL `SELECT 1` check)

### Running the API tests
The suite needs a real SQL Server. Use a **separate database** from your working one:

```bash
# .env in the repo root (gitignored)
DATABASE_URL="sqlserver://localhost:1433;database=TrainHub360_Test;user=trainhub_test;password=…;trustServerCertificate=true"
```

```bash
pnpm install
pnpm --filter @workspace/db run prisma:generate
pnpm --filter @workspace/db run prisma:push        # creates the schema in that database
pnpm --filter @workspace/api run build             # tests import from dist/
pnpm --filter @workspace/api run test
```

A healthy run reports **0 skipped**. Without `DATABASE_URL` the database tests are skipped
with a single warning; with `CI=true` a missing `DATABASE_URL` is a hard failure, so CI can
never go green while most of the suite never ran.

CI does this automatically: `.github/workflows/ci.yml` starts a SQL Server 2022 service
container, pushes the schema and runs the same suite (`DATABASE_URL` is set in the job env).

Never commit `.env` or the SA password � it is gitignored. CI uses a placeholder URL.

## API
Spec: `lib/api-spec/openapi.yaml`. Regenerate clients:
`pnpm --filter @workspace/api-spec run codegen`

### Schema migrations

**Until 2026-11-20** this repository deployed with `prisma db push` and had no migration
history. That is no longer the whole story: there is now a baseline migration,
`lib/db/prisma/migrations/20261120_baseline_user_role_primary_key/`, and a runner that switches
an existing database over to it. `db push` still creates the schema in a fresh development or CI
database; `prisma migrate deploy` is what an existing deployment should use from now on.

**Existing deployment (has data, no `_prisma_migrations` table)** — one time, with `DATABASE_URL`
loaded:

```sh
set -a && . ./.env && set +a
node lib/db/scripts/migrate-baseline.cjs --dry-run   # shows what it would do
node lib/db/scripts/migrate-baseline.cjs             # runs the baseline, records it as applied
pnpm --filter @workspace/db exec prisma migrate status
```

The runner is safe to re-run: every step in the baseline is guarded on the current shape, so on
a database that already matches `schema.prisma` it changes nothing and only records the baseline.
It refuses to run if the baseline is already recorded, and it does not run if `_prisma_migrations`
holds other history it would have to pretend not to see.

**Fresh database** — `prisma migrate deploy` creates the schema and records the baseline in one
step.

**After the switch** — change `schema.prisma`, then `prisma migrate dev --name <what changed>`
locally and `prisma migrate deploy` in deployment. Apply every schema change to a
backup-restored copy first and read the data-loss warnings.

**What the baseline does.** It replaces the old composite primary key on `user_roles`
(`user_id`, `role_id`) with a surrogate `id`, backfills the ids deterministically from each row's
own key, and keeps the old pair as a unique constraint. It is tested against a database seeded
with the old shape by `lib/api/tests/migrations.test.js`, which is part of the API suite. The
constraint it leaves behind is still the old pair, not `(userId, roleId, programmeId)` — the same
role in two programmes is a separate schema change, and `schema.prisma` says so.

Backfills (run after `db push`, idempotent):
- `pnpm --filter @workspace/db exec tsx scripts/backfill-session-booking-org.ts`
- `pnpm --filter @workspace/db exec tsx scripts/backfill-course-trainer-id.ts`

### Email (A.2)
Outbound mail goes through `lib/api/src/services/email.ts`, selected by `EMAIL_PROVIDER`:
`smtp` (real mail, from the `SMTP_*` values) or unset/`console` (development: the whole
message, links included, is printed to the API log).

- **Production refuses to start** when the console sender is selected, when `SMTP_HOST` is
  empty under `smtp`, or when `APP_BASE_URL` is missing or points at localhost. Set
  `EMAIL_STRICT=false` only on a deployment that accepts logging its mail.
- **A failed send is never swallowed.** It is logged and written to `email_failures`
  (recipient, subject, kind, error, org), pruned after 30 days. Check it with
  `SELECT TOP 20 * FROM email_failures ORDER BY created_at DESC`.
- Activation links land on `/activate?token=…`, reset links on `/reset-password?token=…`;
  both pages render before login. **People** shows who has not activated yet and can resend
  the invitation.
- The login throttle is always live (`LOGIN_THROTTLE_*`), and a lockout answers with the same
  generic 401 as a wrong password.

### Content storage and uploads
Learning content files go through `lib/api/src/services/storage.ts` (`StorageProvider`). The default local-disk provider writes under `STORAGE_DIR` (default `.storage/` relative to the API process); mount a persistent volume in production. S3/Azure providers are reserved but not implemented. `scanUpload` is a no-op hook today.

Uploads (A.3) are **multipart**, not base64 in JSON — `express.json()` caps a JSON body at 100 KB, so a real PDF or video used to fail with 413:

- `POST /api/modules/:moduleId/content/upload` — staff only; `multipart/form-data` with one part named `file`. The old `{fileName, mimeType, dataBase64}` JSON body is still accepted for small files.
- `POST /api/uploads/evidence` — any member of the organization; a learner's proof for a trainer-verified item.
- Both cap the file at `UPLOAD_MAX_BYTES` (default 50 MB) and check an extension/MIME allowlist (`lib/api/src/services/uploads.ts`).
- Every upload writes a **`StoredFile`** row (organization, uploader, name, MIME, size, checksum, purpose) and returns `storedFileId`. A content item or a progress record may only reference a `StoredFile` of its own organization — a copied or invented `storageKey` is refused.

### The assessment lifecycle (round 8)

**Versions.** Publishing an assessment freezes its questions and stamps `publishedAt`, so `live`
means exactly `isPublished && publishedAt !== null && supersededAt === null && !isArchived &&
deletedAt === null`. An attempt that was already open keeps the version it started on: it can still
be saved, submitted and graded inside its time limit, while new attempts only start on the live
version.

**Editing a live paper does not take it offline (round 9 / 2.1).** A `PATCH` on a published
assessment answers `409` with `requiresNewVersion` unless it carries `confirmNewVersion: true`. With
that flag the edit goes into **one draft** at `version + 1` that points back at the live row
(`supersedesId`); further edits go into the same draft, and the live version keeps its questions and
its attempts, so learners carry on taking it. `POST /api/assessments/:id/discard-draft` throws the
draft away. Nothing is re-evaluated and nobody is notified while a draft exists — the assessment only
changes when the draft is published.

**Publishing a draft states the kind of change (round 9 / 2.2).** A draft that replaces a live version
must send `changeKind`:

- `minor` — a correction that does not change what is being assessed. Results already earned on the
  previous version **carry forward**: the live paper is scored from the attempts made on it and on
  the `minor` versions beneath it (the chain is walked back through `supersedesId`), and those
  attempts also count against `maxAttempts`.
- `new_paper` — a different paper. Earlier results do **not** count; an enrolled learner needs a
  graded attempt on the new paper to become competent, and every not-yet-completed learner of the
  course gets an `assessment_retake_required` notification.

Publishing is one transaction that marks the draft published and retires the old row
(`supersededAt`, `supersededById`), then queues the course-wide re-evaluation.

**Grading.** Objective answers (`single_choice`, `true_false`, `multi_choice`, and a short answer
with `acceptedAnswers`) are marked by the server on submit. Anything with a manual question goes to
the grading queue with `status = grading`, and **a partial grade is not a result**: score, percent
and passed stay null until a trainer finishes marking every manual question. Nobody may grade their
own attempt, and a graded attempt is final (a correction is a new attempt, not an edit).

**Completion is not competence.** Round 8 replaced the scattered rules with one idempotent service,
`lib/api/src/services/enrolmentOutcome.ts` → `evaluateEnrolment(enrolmentId, trigger)`:

- *content complete* = every required, non-archived content item of the course has a completed
  progress row for this enrolment (a course with no required content counts as complete);
- *competent* = content complete **and** every live applied assessment has met its own pass mark;
- *completed* = competent, and it records how: `completionSource` is `assessment` when the learner
  earned it, `manual` when staff set the status. Only then are `status` and `completionDate` set, the
  certificate is issued and recognitions are checked — and a certificate is only ever issued for an
  enrolment that has a `completionSource`, so a bare status change cannot produce one.
- **Completion is not taken away by an edit (round 9 / 2.3).** Once an enrolment is completed with a
  source, publishing a new paper or archiving content never resets its status, its completion date or
  its stored score: the computed score may raise it but never lower it. An edit is something the
  learner still has to do, not something they lose.
- **Un-completing is a real reversal (round 10).** Staff moving `completed` → `enrolled` also clear
  `completionDate` / `completionSource` and revoke every active certificate for that enrolment with a
  `CERTIFICATE_REVOKED` audit entry. **[CONFIRM 2026-11-21]**

It runs from every place that can change the answer — a progress change or verification, an attempt
becoming graded, an assessment being published or superseded, a required item added or archived, and
a staff status change — so finishing the content after passing (or the other way round) closes the
loop the same way. Withdrawn enrolments are skipped.

**One enrolment at a time, one course in the background (round 9 / 3).** A trigger that concerns a
single enrolment (a progress change, an attempt graded) runs it synchronously. A trigger that concerns
a whole course (a paper published, content added or archived) writes one `EvaluationJob` row and
returns: `POST /api/assessments/:id/publish` no longer waits for every learner. The worker takes 50
enrolments per tick (`EVALUATION_WORKER_MS`, default 5000 ms), and a second trigger for a course that
already has a job pending only refreshes that job. `GET /api/courses/:id/evaluation-status` tells
programme staff whether a recalculation is still due, including job status, attempts, heartbeat staleness
and the last error.

**The queue survives a worker restart (round 10).** A filtered unique index allows one `pending` job
per course; a new trigger while a job is `running` queues one follow-up. The worker claims jobs
atomically, records a heartbeat every 50 enrolments, and startup/tick reclaims a job whose heartbeat
is older than `EVALUATION_STALE_MS` (default 10 minutes). A reclaimed job keeps its attempt count and
is failed with an audit entry after `EVALUATION_MAX_ATTEMPTS` (5). Migrations
`20261127_round10_evaluation_queue_resilience` adds the heartbeat, attempts and indexes.

Each enrolment is read, scored and written inside one transaction that holds the row
(`WITH (UPDLOCK, HOLDLOCK)`), so two triggers arriving together cannot both see "not completed" and
issue two certificates. The visible side effects — the certificate, the recognition, the manager
notification, the locked-period notice — run **after** the commit and only for the transition the
transaction reported, so a second run for the same enrolment does nothing.

**Score sources and overrides.** `Enrolment.appliedScoreSource` is `assessment` or `manual`. In the
`assessment` source the standing score is computed from the data, never from `max(previous, new)`:
the average of each live applied assessment's best graded percentage, where an assessment with no
graded attempt counts as 0 — so a superseded version cannot inflate it. A staff `PATCH` that changes
the score, the status or the completion date needs a `reason` of at least 10 characters, is audited,
and sets the source to `manual`; from then on an automatic result is stored in
`pendingAssessmentScore` instead of overwriting it, and staff accept or reject it with
`POST /api/enrolments/:id/accept-assessment-score` / `…/reject-assessment-score`.
Accept/reject uses one locked transaction and a shared comparison of the six effective inputs
(assessment score, application score, deadline, completion date, timeliness and enrolment score).
Sign-off is cleared, and the manager notified, **only when an effective input really changes**;
a rejected value is kept in `pendingRejectedScore` so the same result cannot re-pend forever.

**Locks and sign-off.** A locked review-credit period (`reviewCreditLockedAt`) never moves: a late
graded attempt is still recorded, but the score, timeliness, enrolment score, status and completion
date stay put and an `ASSESSMENT_RESULT_NOT_APPLIED_LOCKED` audit entry plus a notification go to the
programme admins and the line manager. The new result is held in `pendingAssessmentScore` for staff
review; accepting it audits the decision without disturbing the locked score or sign-off, and rejecting
it records the suppressed value. Only an organisation owner may override a locked enrolment, and that
needs a reason too. On an unlocked enrolment, only a real score change clears `managerSignOff` and
notifies the manager to confirm again.

### Staff and learner UI (round 10)

The assessment builder now has a version dropdown that labels live, draft, superseding draft and
superseded papers. Editing a live paper asks for confirmation before opening a draft; the draft can be
saved, published with a change kind, or discarded, and superseded versions cannot start new attempts.
After publishing a paper or adding/archiving required course content, staff see a
recalculation panel driven by `GET /api/courses/:id/evaluation-status`; it polls while pending, stops on
completion, and surfaces stale jobs and the last error. Learners see a neutral note when a result is
held for staff review and a retake note on a `new_paper` version; answer keys, rubrics and option
correctness are never sent to learner views.

### Who may change an enrolment (round 9 / H1)

`PATCH /api/enrolments/:id` is a strict whitelist, and the role is checked in the database against the
enrolment's own programme and organisation — never taken from the request.

- **Learners** may not change an outcome at all: no `status`, `completionDate`, `deadlineDate`, score
  or any other outcome field. Progress comes only from content progress and assessment attempts, so
  the "mark complete" button posts content progress and nothing else.
- **Programme staff** (that enrolment's programme, or org staff) may set `status` (limited to
  `enrolled`, `completed`, `withdrawn`), `completionDate`, `deadlineDate`, `appliedAssessmentScore`
  and `applicationScore`. A change to the status, the completion date or a score needs a `reason` of
  at least 10 characters, is audited, and records `completionSource: "manual"` when it completes
  someone.
- **The line manager** (the learner's `managerId`) may set `managerSignOff` only.

A field that exists on the endpoint but not for your role is refused with `403`; a key the endpoint
does not have at all is a `400`. The score is recomputed from the stored row plus the validated
fields, so a `deadlineDate` in the body can no longer change a stored `timelinessScore`.

### Reminders and calendar

The reminder job (`jobs/sessionReminderJob.ts` → `services/reminderCadence.ts`) follows each
organisation's `reminderCadenceJson`: `unansweredHours` offsets after an unanswered invitation (up to
`maxUnanswered`) and `confirmedBeforeStartHours` offsets before a confirmed session starts. The
cadence is validated on save (arrays of positive integers, bounded length) and is editable in
**Settings**. Each reminder is logged with its offset in its kind (`rsvp_48`, `session_24`), unique
per `(sessionId, learnerId, kind)`, so several are sent and none twice; declined RSVPs, past or
cancelled sessions, inactive users and withdrawn learners are skipped. The job runs every 15 minutes
(`REMINDER_INTERVAL_MS`, `0` disables it) and org staff can run it on demand with
`POST /api/reminders/run`.

`GET /api/sessions/:id/ics` serves one session as a calendar file (invited or confirmed learners,
and programme staff); invitation and confirmation emails carry the same file (`METHOD:REQUEST`,
stable `UID`, `SEQUENCE`). Editing a session bumps the sequence and emails attendees an updated
file; cancelling sends `METHOD:CANCEL`. Personal feeds live at `GET /api/calendar/feed.ics?token=…`,
with a token issued by `GET /api/me/ical-token` that is stored hashed, shown once and can be
rotated by org admins. Real Outlook/Google API sync is **not built** and stays out of scope.

### Running behind a proxy

`TRUST_PROXY` decides whether `X-Forwarded-For` is believed. It is off by default, so a client
cannot pick its own login-throttle bucket by sending a header; behind a reverse proxy set it to the
hop count (`1`), `loopback`, or a CIDR list. In production an unset `TRUST_PROXY` logs a startup
warning, and `LOGIN_THROTTLE_ENABLED=false` is ignored there unless `LOGIN_THROTTLE_ALLOW_DISABLE=true`.

Failed email deliveries are readable at `GET /api/email-failures` (org staff, org-scoped, paginated)
and dismissible with `POST /api/email-failures/:id/dismiss`; **Settings → Email delivery** lists them
with a resend-invitation shortcut.

### Running the tests

```sh
set -a && . ./.env && set +a
pnpm --filter @workspace/db run prisma:push        # or prisma migrate deploy
pnpm --filter @workspace/api run build             # the tests import dist/
pnpm --filter @workspace/api run test
cd frontend && pnpm install --ignore-workspace && pnpm run typecheck && pnpm run test:ui
```

The API suite runs against a real SQL Server (`DATABASE_URL`, `TrainHub360_Test`), one file at a
time (`--test-concurrency=1`), and every file that logs in resets the in-process login throttle in
`before()` through `tests/support/resetTestState.js`, so a re-run in another order gives the same
result. `scripts/check-openapi-drift.mjs` lists the registered routes against `openapi.yaml` and
fails when they drift.

## Docs
See `documents/corporate-training-platform-proposal.md` and `ARCHITECTURE.md`.

