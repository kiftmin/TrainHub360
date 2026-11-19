# Round 6 — Phase A.1 + CI green

**PR:** https://github.com/kiftmin/TrainHub360/pull/1 — branch `fix/a1-async-errors` (open, **CI passing**)
**Test database:** SQL Server `localhost\SQLEXPRESS`, port 1433, database `TrainHub360_Test`
(schema via `prisma db push`, data via `prisma:seed`)

## Final status

| Item | State |
|---|---|
| A.1 async errors reach the error middleware | done — `express-async-errors` |
| A.1 error mapping (status / 503 / 500) | done — `errorMiddleware` exported from `lib/api/src/index.ts` |
| A.1 process hooks are logging-only | done |
| `roles`-only PATCH bug found while testing | fixed (guard ran before the roles branch) |
| A.1 tests (5 cases, 3 s timeout each) | added — `lib/api/tests/async-errors.test.js` |
| API suite on the test database | **98 tests, 98 pass, 0 fail, 0 skipped** |
| `pnpm run typecheck` | passes |
| **GitHub CI `build`** | **pass (49 s, 43 s on the last two runs)** |

## A.1 before / after (same database, same test file)

| Case | Before | After |
|---|---|---|
| cross-org `POST /programmes/:otherOrgId/members` | hangs → test timeout | 404 `programme not found in your organization` |
| `roles` array removing the last admin | 400 `fromRole/toRole or name required` | 409 `cannot remove the last programme admin` |
| course from another org → `POST /enrolments` | hangs → test timeout | 404 `course not found in your organization` |
| unexpected exception | no response, `unhandledRejection` | 500 `internal server error`, no internals, no MSSQL hint |
| learner adding members | 403 | 403 |

## Why CI had never passed — four separate causes, all fixed

`main` was red before this branch existed. Each cause was hidden behind the one before it:

1. **`pnpm/action-setup` with no version** — died in the first step, before install.
   Fixed: `version: 10`.
2. **No `@workspace/db` project reference** — `tsc -p lib/api` resolved Prisma types
   through `lib/db/dist`, which only exists after `tsc --build`. On a clean checkout every
   row was `any` and strict mode failed with TS7006 in `jobs/*` and `services/*`.
   Fixed: `references: [{ path: "../db" }]` + `build` script is now `tsc --build`.
3. **Prisma Client never generated** — it is generated, not committed.
   Fixed: `prisma:generate` step in `ci.yml`.
4. **`@workspace/db` exported its TypeScript source** — `node` refused it with
   `ERR_UNKNOWN_FILE_EXTENSION` on `lib/db/src/index.ts`, so the test suite could not
   start. Fixed: conditional exports (`types` → src, `default` → dist) and `lib/db` now
   emits JavaScript, not declarations only.

## Still open (deliberately not in this PR)

- **CI has no database.** The suite passes there but most database tests skip; the
  98/98 run above needed `DATABASE_URL`. Phase F.1/F.2.
- `PUBLIC_PATHS` in `auth.ts` still unused (B.5.5).
- Stale `.tsbuildinfo` files can make `tsc --build` claim "up to date" for a missing
  `dist/`; deleting them forces a real rebuild. Worth a CI cache key note.
