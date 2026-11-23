# Round 13 Report

## Outcome

All six Round 13 phases were implemented. Phase 1–5 were merged in separate PRs from current `main`; Phase 6 is finalized in PR #28 and tagged `v0.10.0`.

## Phases and PRs

| Phase | Scope | PR | Result |
|---|---|---|---|
| 1 | Certificate race, idempotent completion side effects, parallel tests | #23 | Merged; full API **245 pass** |
| 2 | SLA permissions and organization/programme defaults | #24 | Merged; full API **248 pass**, frontend **71 pass** |
| 3 | Learner invite picker, search/paging, invite-all-enrolled | #25 | Merged; full API **251 pass**, frontend **73 pass** |
| 4 | Removed-attendee state, publish confirmation, roster group, template permissions/body limit | #26 | Merged; full API **253 pass**, frontend **74 pass** |
| 5 | Publish impact/choice, calendar honesty, storage warning, schema verification, learner session cards, docs | #27 | Merged; full API **261 pass**, frontend **76 pass** |
| 6 | Valid OpenAPI, regenerated clients, CI generated-diff gate, branch cleanup, release tag, report | #28 | Merged; full API **261 pass**, frontend **76 pass** |

PRs:
- https://github.com/kiftmin/TrainHub360/pull/23
- https://github.com/kiftmin/TrainHub360/pull/24
- https://github.com/kiftmin/TrainHub360/pull/25
- https://github.com/kiftmin/TrainHub360/pull/26
- https://github.com/kiftmin/TrainHub360/pull/27
- https://github.com/kiftmin/TrainHub360/pull/28

## Verification

All final verification was run on the Phase 6 branch before merge.

| Check | Result |
|---|---|
| Full API suite | 261 pass, 0 fail, 0 skipped, 0 todo |
| Full frontend suite | 76 pass, 0 fail |
| Root `pnpm run typecheck` | pass |
| Frontend `pnpm run typecheck` | pass |
| `pnpm --filter @workspace/api run build` | pass |
| `pnpm --filter @workspace/api-spec run codegen` | pass |
| Codegen idempotency (`git diff --exit-code` after second run) | pass, no diff |
| `node scripts/check-openapi-drift.mjs` | pass, 140 operations match |
| `pnpm --filter @workspace/db run verify-schema` | pass, all migration-only objects present |

Database evidence:
- Local API runs used the real SQL Server database `TrainHub360_Test` on `localhost:1433` from the repository `.env`.
- CI uses a SQL Server 2022 service container with database `TrainHubCI`.
- No API test was skipped for lack of a database.
- Migration `20261122_round13_session_cancel_reason` was applied locally with `prisma:generate` + `prisma:baseline`; `prisma:push` was not used on the already-migrated database.

## Generated clients

The generator previously failed before writing output. Fixed spec problems:

- duplicate `MessageThread.participants` mapping;
- five unquoted response descriptions containing commas;
- missing `ReviewCreditExportRow` schema;
- duplicate `exportReviewCredits` operationId;
- null-only `reason` type that crashed the Zod generator.

The React Query and Zod clients were regenerated from the 140-operation spec. CI now runs generation and fails on either a generator error or any uncommitted diff, while retaining the route/spec drift check.

Artifact clients were aligned with the regenerated identity-based booking contracts: bookings now carry `trainerId` and `courseId` instead of trainer/course names typed into a form.

## Branch cleanup

Branch tips were checked against `main` before deletion. Branches whose tip was an ancestor of `main`, and which added no file that exists only on the branch, were archived by tag and deleted.

Archived and deleted:

- `round10-phase1`, `round10-phase2`, `round10-phase3`, `round10-phase4`, `round10-phase5`, `round10-report-final`
- `round11/attempt-chain-limits`, `round11/edge-case-tests`
- `round12/phase0-parallel-test`, `round12/phase1-session-roster`, `round12/phase2-calendar-roster-ui`, `round12/phase3-messaging-api`, `round12/phase4-messaging-ui`, `round12/phase5-schema-ci`
- `round13/phase1-certificate-race`, `round13/phase2-sla-permissions`, `round13/phase3-invite-picker`, `round13/phase4-hardening`, `round13/phase5-honesty`
- `round9-phases-1-3`
- `round13/phase6-generated-clients` after PR #28 merged

Archive tags use `archive/<branch-name>` with `/` replaced by `-`, except pre-existing `archive/round12/...` tags which were retained.

Kept:

- `fix/a1-async-errors` — branch tip is not an ancestor of `main` and has commits not in `main`.
- `fix/a2-email-notifications` — branch tip is not an ancestor of `main` and has commits not in `main`.
- `fix/round8` — branch tip is not an ancestor of `main` and has a round-8 fix commit not in `main`.
- `phase/4-and-8` — branch tip is not an ancestor of `main` and has commits not in `main`.
- `phase/a3-b-1.7` — branch tip is not an ancestor of `main` and has a commit not in `main`.

## Release

`v0.10.0` was created at the final `main` commit after PR #28 was green and merged.
