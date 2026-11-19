# A.1 — async route errors, and a CI that actually runs the suite

PR: https://github.com/kiftmin/TrainHub360/pull/1
Branch: `fix/a1-async-errors`

## What A.1 asked for

A rejected promise in an Express 4 route handler produced no response at all: the client
hung until it timed out. Every async handler had to fail with a real status and a body that
does not leak internals.

## What changed

### The fix
- `express-async-errors` wraps the router, so a rejected handler reaches the error middleware
  instead of vanishing.
- `errorMiddleware` is exported from `lib/api/src/index.ts`:
  - a numeric `err.status` / `err.statusCode` wins (a handler that already decided its status),
  - a real Prisma connectivity failure (`PrismaClientKnownRequestError` with `P1001` /
    `P1002` / `P1017`) becomes **503**,
  - anything else is logged server-side and returned as a generic **500 `internal server error`**.

### A bug the test found
`PATCH /programmes/:id/members/:userId` ran its last-admin guard whenever *either* `roles`
or `role` was present, so a `roles`-array request that was not removing the admin was
refused with 409. The guard now runs only when a `roles` array is supplied.

### Two things only a real database caught
1. **A 503 that lied.** The first version treated any error carrying a `P1001`-shaped `code`
   string as a database outage, so ordinary request failures were reported as 503. It now
   requires `instanceof Prisma.PrismaClientKnownRequestError` as well.
2. **A second PrismaClient module instance.** The API imported `@prisma/client` directly in
   places; under parallel test files that built a second client and exhausted the SQL Server
   connection pool (`Can't reach database server at 127.0.0.1:1433`). `Prisma` is now
   re-exported from `@workspace/db` and reached through the API's `src/db.ts`.

### Tests
`lib/api/tests/async-errors.test.js` — 7 cases, each with a 3 s abort so a hang fails instead
of stalling the suite: cross-org member add 404s promptly, the org's own programme still
works, the last programme admin cannot be demoted via `roles`, the grant survives the refused
change, a cross-org course 404s promptly, a learner gets 403, and an unexpected throw returns
500 without leaking the message.

## The part that mattered more: CI

CI was green and meant nothing. The suite had no database, so every database test skipped
and the job still exited 0.

- **`lib/api/tests/support/requireDatabase.js`** — with `CI=true` a missing `DATABASE_URL`
  throws; locally it warns once and skips as before. All 19 database suites use it.
- **`.github/workflows/ci.yml`** — starts a SQL Server 2022 service container, pushes the
  schema, then runs the same suite with `DATABASE_URL` and `CI=true`.

That turned CI into a real test of the suite, and it immediately found four faults that had
never been visible:

| Fault | Cause | Fix |
| --- | --- | --- |
| `Unique constraint failed … dbo.roles` | 11 files each upserted the same global roles; `node --test` runs files in parallel and two upserts raced | `support/seedRoles.js` inserts, ignores a concurrent `P2002`, confirms |
| `correct password succeeds` → 401 | login test needed a seeded org, and CI seeds nothing | the test creates its own organization |
| `org admin adding to their own programme` → `fetch failed` | two tests re-added the same user, so the second depended on the first | own user, accepts 201 or 409, asserts "never 404" |
| login 401 under parallel load | the in-memory login throttle is keyed partly by IP, and every test file's app listens on 127.0.0.1 | reset the throttle before asserting a successful login |

## Verified

- Locally, `TrainHub360_Test` on SQL Server Express: **98 tests, 98 pass, 0 fail, 0 skipped**,
  three consecutive full runs, ~31–39 s.
- On the user's machine (`C:\projects\TrainHub360`): **98 / 98 / 0 / 0**.
- GitHub Actions `build`, with the SQL Server container: **98 / 98 / 0 / 0**, ~1 min.

## Open items

- **GitGuardian still reports the PR.** It flags the CI container's throwaway password. A
  GitHub service `env:` cannot read `secrets`, so the value is a single-job throwaway
  (`CiOnly_Throwaway_1`); it is not a real credential and nothing outside that job uses it.
  The finding is on commits already pushed, so only dismissing it in the GitGuardian dashboard
  clears the check.
- **`rbac.test.js` has a 5 s Prisma transaction timeout** that failed once under load on the
  user's machine (`Transaction already closed … 5060 ms`). It has not recurred in any run
  since; it is not part of A.1 and is left for its own fix.
