# Round 10 — report

Integration: PR **#13** merged the Round 10 tip into `main` as `fc89cf3`, tagged **round10**.
Stacked PRs #8–#12 were closed as superseded, as were the older overlapping PRs #1–#7.

| Phase | PR | Head branch | Status |
| --- | --- | --- | --- |
| 1 | #8 | `round10-phase1` | closed, superseded by #13 |
| 2 | #9 | `round10-phase2` | closed, superseded by #13 |
| 3 | #10 | `round10-phase3` | closed, superseded by #13 |
| 4 | #11 | `round10-phase4` | closed, superseded by #13 |
| 5 | #12 | `round10-phase5` | closed, superseded by #13 |

## What ran, against what

| Suite | Command | Database | Result |
| --- | --- | --- | --- |
| API baseline | `pnpm --filter @workspace/api run test` | SQL Server `TrainHub360_Test` | 215 / 215 pass |
| Frontend baseline | `cd frontend && pnpm run test:ui` | — | 44 / 44 pass |
| Un-completing focused | `node --test dist/tests/enrolment-outcome.test.js` | SQL Server `TrainHub360_Test` | 16 / 16 pass |
| Queue smoke | `node --test dist/tests/round9-phase3.test.js` | SQL Server `TrainHub360_Test` | 4 / 4 pass |
| Phase 3 regression | focused `round10-backend`, `enrolment-outcome`, `round9-phase2` | SQL Server `TrainHub360_Test` | 23 / 23 pass |
| API full | `pnpm --filter @workspace/api run test` | SQL Server `TrainHub360_Test` | **222 / 222 pass, 0 fail, 0 skipped**, 41 suites |
| Frontend final | `cd frontend && pnpm run test:ui` | — | **57 / 57 pass**, 8 suites |
| OpenAPI drift | `node scripts/check-openapi-drift.mjs` | — | none, 130 operations match |
| Typechecks | API build/typecheck, frontend `pnpm run typecheck` | — | clean |

Logs: `$env:TEMP\round10-api-baseline.log`, `$env:TEMP\round10-frontend-baseline.log`,
`$env:TEMP\round10-uncomplete-focused.log`, `$env:TEMP\round10-queue-smoke.log`,
`$env:TEMP\round10-locked-focused.log`, `$env:TEMP\round10-phase3-regression2.log`,
`$env:TEMP\round10-api-full.log`.

## Changes

### Phase 1 — sign-off and un-completing

- `applyScoreChange` locks the enrolment row and compares six effective inputs: applied assessment
  score, application score, deadline, completion date, timeliness score and enrolment score. Sign-off
  is cleared and the manager notified only when a real input changes and the review-credit period is
  unlocked.
- A rejected automatic value is stored in `pendingRejectedScore`, with migration
  `20261121_round10_pending_rejected_score`, so the same result cannot be re-pending forever.
- Moving `completed` → `enrolled` now clears `completionDate` / `completionSource` and revokes every
  active certificate with a `CERTIFICATE_REVOKED` audit entry. **[CONFIRM 2026-11-21]**

### Phase 2 — durable evaluation queue

- `EvaluationJob` gained `heartbeatAt`, `attempts` and a filtered unique index allowing one pending
  job per course; migration `20261127_round10_evaluation_queue_resilience` also removes duplicate
  pending rows.
- The worker claims atomically, heartbeats every 50 enrolments, requeues follow-up triggers, and
  startup/tick reclaims stale jobs. `EVALUATION_STALE_MS` defaults to 10 minutes and
  `EVALUATION_MAX_ATTEMPTS` to 5. **[CONFIRM 2026-11-21]**
- `GET /courses/:id/evaluation-status` now reports pending state, job, attempts, staleness and last
  error.

### Phase 3 — backend regression coverage and route fixes

- New `lib/api/tests/round10-backend.test.js` covers two enrolments for the same learner/programme,
  draft/superseded versions, an empty draft publish, locked pending accept/reject, answer-key hiding
  and question 409s, follow-up/stale/failed queue jobs, and sign-off preserved or cleared correctly.
- Fixed attempt-start authorization so a superseded version returns 403 before the unpublished 403.
- Fixed programme context resolution for `/questions/:id`.
- Fixed pending locked results so the held result never moves score fields or sign-off, while the
  completion date is still persisted.

### Phase 4 — frontend

- Version dropdown labels live, draft, superseding draft and superseded papers; editing a live paper
  asks for confirmation before `PATCH`, drafts can be saved/discarded, and superseded versions cannot
  start attempts.
- Publishing a paper or adding/archiving required content activates a recalculation panel backed by
  `GET /courses/:id/evaluation-status`; timers are cleaned up and stale/failed jobs are surfaced.
- Learners see neutral pending-review and new-paper retake notes; answer keys, rubrics and option
  correctness are not present in learner responses.

### Phase 5 — docs

- `openapi.yaml` documents evaluation status fields, assessment version fields, draft confirmation,
  publish `changeKind`, discard response, superseded attempt 403, and sign-off/revocation behaviour.
- `README.md` documents the durable queue, sign-off comparison, locked pending results, certificate
  revocation, and the new staff/learner UI.

## Real-database-only findings

- `prisma db push` does not run migration SQL; both Round 10 migrations had to be applied manually to
  SQL Server after the push.
- `prisma generate` initially failed with an `EPERM` rename on the Windows query engine; stale API
  `tsx` child processes held the file and had to be stopped.
- The filtered unique index is essential: two concurrent course triggers otherwise create duplicate
  pending jobs in SQL Server.
- Full-suite tests import `../dist/...`; source edits require an API rebuild before tests see them.
- A rejected/pending score can look unchanged in the applied score fields; the audit and
  `pendingRejectedScore` columns were needed to pin the intended behaviour.

## Confirmations and decisions

- Un-completing revokes certificates: accepted.
- Stale job timeout default 10 minutes: accepted.
- Delete fully contained old `fix/*` and `phase/*` branches after the Round 10 merge: accepted.
  Only `phase/a1-async-errors` was fully contained in `main`; it was deleted. Other `fix/*` and
  `phase/*` branches remain because `git branch -r --merged origin/main` did not list them.

## Audit

Mass-assignment audit research found 0 vulnerabilities. All spread/`Object.assign` uses in
`lib/api/src` are whitelisted, derived from trusted request context, or attach status to `Error`.

## Completion

- PR #13 CI passed with the real SQL Server service (`build`) and frontend job before merge.
- PR #13 merged as `fc89cf3` and tagged `round10`.
- PRs #1–#7 and #8–#12 were closed with a comment pointing to PR #13.
- Branch cleanup used `git branch -r --merged origin/main`; only `phase/a1-async-errors` was fully
  contained and was deleted. Nothing else was removed.
