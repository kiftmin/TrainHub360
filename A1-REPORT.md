# Round 6 — Phase A.1 report

**PR:** https://github.com/kiftmin/TrainHub360/pull/1 — branch `fix/a1-async-errors` (open)
**Test database:** SQL Server `localhost\SQLEXPRESS`, port 1433, database `TrainHub360_Test`
(schema via `prisma db push`, data via `prisma:seed`)

## Status

| Item | State |
|---|---|
| A.1 async errors reach the error middleware | done — `express-async-errors` |
| A.1 error middleware mapping (status / 503 / 500) | done — `errorMiddleware` exported from `lib/api/src/index.ts` |
| A.1 process hooks are logging-only | done |
| A.1 handlers audited (`await assert…` outside try) | done — now answered by the middleware |
| `roles`-only PATCH bug found while testing | fixed (guard was checked before the roles branch) |
| Tests for A.1 (5 cases, 3 s timeout each) | added — `lib/api/tests/async-errors.test.js` |
| Full API suite on the test database | **98 tests, 98 pass, 0 fail, 0 skipped** (33.5 s) |
| `pnpm run typecheck` | passes |
| CI | **red — and red on `main` too, for an unrelated reason (see below)** |

## Before / after (same database, same test file)

| Case | Before | After |
|---|---|---|
| cross-org `POST /programmes/:otherOrgId/members` | hangs → test timeout | 404 `programme not found in your organization` |
| `roles` array removing the last admin | 400 `fromRole/toRole or name required` | 409 `cannot remove the last programme admin` |
| course from another org → `POST /enrolments` | hangs → test timeout | 404 `course not found in your organization` |
| unexpected exception | no response, `unhandledRejection` | 500 `internal server error`, no internals, no MSSQL hint |
| learner adding members | 403 | 403 |

## Why CI is red — not caused by this PR

`pnpm --filter @workspace/api run build` fails on GitHub with TS7006
(`Parameter 'c' implicitly has an 'any' type`) in `jobs/*.ts` and `services/*.ts`.

Cause: `lib/api` imports `@workspace/db`, whose types are emitted declarations in
`lib/db/dist`. `lib/api/tsconfig.json` has no project reference, and its `build` script is
`tsc -p tsconfig.json` (not `--build`), so on a clean checkout the Prisma types do not
resolve and every row is `any`. It passes locally only because `tsc --build` had already
produced `lib/db/dist`.

Second finding: `pnpm run typecheck:libs` (`tsc --build`) reports "up to date" from a
`.tsbuildinfo` whose output folder does not exist — `lib/db/dist` is absent after a clean
`rm -rf`, so the incremental state is stale and must be deleted before it rebuilds.

## Not done (kept out of this PR on purpose)

- CI still runs the API suite with no database: the 98 tests only execute where
  `DATABASE_URL` is set. Phase F.1/F.2.
- `PUBLIC_PATHS` in `auth.ts` still unused (B.5.5).
