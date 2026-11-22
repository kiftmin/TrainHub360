# Round 12 — report

Integration: Round 12 completed as six ordered phases, one PR each. Phase 5 merged into `main`
through PR **#22** as `ad810f9`; the phase head `d863dad` is tagged
**`archive/round12/phase5-schema-ci`**.

The user-referenced `trainhub360-review-round12-and-5-2-status.md` was not present in the
repository, so scope was reconstructed from the §5.2 proposal, the code, tests, migrations, and
earlier round reports. No Microsoft/Google Calendar API integration or cloud file storage was
introduced; supported calendar delivery remains `.ics` files and personal calendar feeds, with
session attachments stored on local disk.

## Phases

| Phase | PR | Head branch | Head commit | Archive tag | Merge commit |
| --- | --- | --- | --- | --- | --- |
| 0 — parallel certificate race | #17 | `round12/phase0-parallel-test` | `2ba8ab6` | `archive/round12/phase0-parallel-test` | `0248ac2` |
| 1 — session roster API | #18 | `round12/phase1-session-roster` | `9a1d011` | `archive/round12/phase1-session-roster` | `41a1106` |
| 2 — calendar roster UI | #19 | `round12/phase2-calendar-roster-ui` | `7ee432f` | `archive/round12/phase2-calendar-roster-ui` | `448c5c0` |
| 3 — messaging API depth | #20 | `round12/phase3-messaging-api` | `e78957f` | `archive/round12/phase3-messaging-api` | `a139505` |
| 4 — messaging UI depth | #21 | `round12/phase4-messaging-ui` | `7cfd0b7` | `archive/round12/phase4-messaging-ui` | `8ce4d49` |
| 5 — CI schema procedure | #22 | `round12/phase5-schema-ci` | `d863dad` | `archive/round12/phase5-schema-ci` | `ad810f9` |

## What changed

### Phase 0 — parallel certificate race
- Added concurrent certificate-issuance coverage so one enrolment produces exactly one certificate,
  recognition, notification, and completion timestamp.

### Phase 1 — session roster API
- Added `GET /sessions/:id/attendees` and `GET /sessions/:id/invitable`.
- Improved `POST /sessions/:id/invite` with skip reasons and auditing.
- Added audited `POST /sessions/:id/remove`, plus reason support on PATCH/cancel.

### Phase 2 — calendar roster UI
- Added a staff-only Calendar roster panel with invite/remove, title and cancellation reasons, and
  skip-reason feedback.
- Added scoped query-key hooks and UI tests.

### Phase 3 — messaging API depth
- Added course-scoped message threads, `/threads` filters, SLA fields, and
  `PATCH /threads/:id/sla`.
- Added org-scoped message-template CRUD with soft delete.
- Added a scheduled SLA job driven by `SLA_INTERVAL_MS`.
- Added guarded SQL Server migration `20261128_round12_messaging_depth`, OpenAPI updates, README
  updates, and API tests.

### Phase 4 — messaging UI depth
- Added course creation/filters, course badges, SLA indicators, learner response promises, staff
  SLA editing, canned-response management, and a manual SLA run control.
- Added a metadata-only `.ics` notice and empty `204` handling in the API client.
- Preserved the existing 24-hour new-thread suggestion.

### Phase 5 — CI schema procedure
- CI now applies the base schema, runs the documented `prisma:baseline` migration runner, and gates
  on `prisma migrate status`.
- Added `@workspace/db` scripts for `prisma:deploy`, `prisma:migrate:status`, and `prisma:baseline`.
- Prevented the baseline runner from double-recording migrations that insert their own history row.
- Removed the hand-made `UX_evaluation_jobs_one_pending_per_course` index from the Round 11 test;
  the test now asserts that the migration created it.
- README, local testing notes, and `scripts/post-merge.sh` now describe one schema procedure.

## Verification

| Check | Result |
| --- | --- |
| Baseline API suite | 233 / 233 pass |
| Baseline frontend suite | 57 / 57 pass |
| Phase 0 full API | 233 pass, 0 fail, 0 skipped |
| Phase 1 full API | 238 pass, 0 fail, 0 skipped |
| Phase 2 full frontend | 9 files, 62 tests, 62 pass |
| Phase 3 full API | 242 pass, 0 fail, 0 skipped |
| Phase 3 API build / root typecheck / Prisma push | clean |
| Phase 3 OpenAPI drift | none, 139 operations match |
| Phase 4 full frontend | 10 files, 69 tests, 69 pass |
| Phase 4 frontend + root typecheck | clean |
| Phase 5 fresh-database sequence | `prisma:push` → `prisma:baseline` → `prisma:migrate:status`; 9 migrations found, schema up to date |
| Phase 5 baseline rerun | all migrations skipped as already applied; status still up to date |
| Phase 5 full API on fresh database | 242 tests, 45 suites, 242 pass, 0 fail, 0 skipped |
| Phase 5 filtered-index assertion | passes with the index supplied only by `20261127_round10_evaluation_queue_resilience/migration.sql` |
| Final frontend suite | 10 files, 69 tests, 69 pass |
| Final root typecheck / API build / OpenAPI drift | clean / clean / none, 139 operations match |

PR #21 and PR #22 each had one duplicate push-triggered CI build fail on the pre-existing flaky
Round 11 parallel-certificate test. The PR-triggered builds passed, and the failed duplicate builds
were rerun successfully before merge. All PR checks were green at merge time. GitGuardian passed;
CodeRabbit was skipped.

## Confirmations

- **[CONFIRM 2026-11-22]** Phase 0 changed only test coverage; no product defaults changed.
- **[CONFIRM 2026-11-22]** Phase 1 added new roster endpoints; no existing defaults changed.
- **[CONFIRM 2026-11-22]** Phase 2 changed UI affordances only; no existing defaults changed.
- **[CONFIRM 2026-11-22]** Phase 3 added a default SLA job interval of `SLA_INTERVAL_MS=600000`
  (10 minutes); setting it to `0` disables the job. No pre-existing default changed.
- **[CONFIRM 2026-11-22]** Phase 4 left the existing 24-hour new-thread suggestion unchanged.
- **[CONFIRM 2026-11-22]** Phase 5 changed schema provisioning, migration tooling, docs, and test
  setup; no product behavior or existing default changed.

## Constraints and notes

- The only new Round 12 schema migration is `20261128_round12_messaging_depth`; it is written with
  SQL Server guards and records migration history through the documented procedure.
- The filtered pending-job index is created by `20261127_round10_evaluation_queue_resilience`, not
  by test setup or Prisma `db push`.
- Generated Orval clients still cannot be rebuilt because of pre-existing spec validation errors in
  the generator. Generated outputs were restored, not changed. OpenAPI drift checking remains clean
  and is the authoritative route/spec check.
- `PROJECT-REPORT.md` and `ROUND9-REPORT.md` remain untracked local-only files and were intentionally
  excluded from Round 12 commits.
