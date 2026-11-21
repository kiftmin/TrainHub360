# Phase 1.7 tail — closing report

Two things were left open at the end of Phase 1.7: the `UserRole` primary-key baseline
migration (so an existing deployment can move to `prisma migrate deploy` without losing
grants) and an `openapi.yaml` that still described only 50 of the API's routes. Both are done.

## 1. Baseline migration — `user_roles` surrogate key

`lib/db/prisma/migrations/20261120_baseline_user_role_primary_key/migration.sql`

The deployed table had a composite primary key `(user_id, role_id, programme_id)`. SQL
Server treats a NULL as unknown, so any grant with `programme_id = NULL` (an org-wide role)
could be inserted twice — the constraint did not do what it looked like it did. The migration:

- adds a surrogate `id` (`nvarchar(25) NOT NULL`) and backfills every existing row with a
  deterministic 25-character hex value derived from `HASHBYTES('SHA2_256', …)` of the old
  key, so the migration is repeatable across environments and a row's id never depends on
  insertion order;
- moves the primary key to `id`;
- keeps the old pair as a unique constraint, `user_roles_user_id_role_id_key`;
- adds `user_roles_programme_id_idx` for the programme-scoped lookups every RBAC check makes.

**Every statement is its own `GO`-delimited batch.** SQL Server compiles a whole batch before
running it, so a statement that references `id` in the same batch as the `ALTER TABLE … ADD id`
fails to compile. That is why the file is split rather than written as one script.

`schema.prisma` now says `@@unique([userId, roleId])` with a comment explaining that the pair,
not the triple, is the limit actually enforced (a person cannot hold the same role both
org-wide and in a programme; allowing that is a separate future migration).

### Running it on an existing deployment

`lib/db/scripts/migrate-baseline.cjs` applies the SQL and records it in `_prisma_migrations`,
so Prisma knows the baseline is already done and `migrate deploy` can take over afterwards.

```bash
pnpm --filter @workspace/db exec node scripts/migrate-baseline.cjs --dry-run   # print only
pnpm --filter @workspace/db exec node scripts/migrate-baseline.cjs             # apply
```

It parses the `sqlserver://` URL itself (credentials are accepted in the authority or as
options), splits the file on `GO`, creates `_prisma_migrations` when the database has never
had one, and is idempotent: a second run prints `already applied` and changes nothing. Fresh
databases keep using `prisma db push`; `README.md` has the new "Schema migrations" section.

### Tests — `lib/api/tests/migrations.test.js` (4 cases)

The CI login owns only `TrainHub360_Test` and has no `CREATE DATABASE` or `CREATE TABLE` in
`master`, so the test builds the *old* shape in a scratch table
(`user_roles_migration_test`) when it cannot create a database, rewriting the constraint and
index names to a test prefix (constraint names are per-database, not per-table, so the real
`user_roles_pkey` would collide). It then runs the real `migration.sql` and asserts:

1. `id` exists, is `NOT NULL`, is the primary key, and the pair unique constraint and the
   programme index exist;
2. a duplicate `(user_id, role_id)` pair is rejected;
3. re-running the migration is a no-op — the table still has its rows and their ids are
   unchanged;
4. `prisma migrate status` agrees the schema is up to date.

Both `test` and `test:ci` include the file.

## 2. `openapi.yaml` brought up to date

90 paths (from 50), covering everything the router actually serves: users, org role and
resend-activation, programme members and bulk removal, delete requests, activate/forgot/reset
password, `readyz`, session calendar sync, jobs, organizations, calendar connections,
certificates, recognitions, cohorts, uploads and evidence, content progress and its
verification, assessment questions and feedback, explain, authoring and withdrawal. Two
schemas were added: `DirectoryUser` and `StoredFile`.

Reconciling the additions with the existing document turned up real spec bugs, all fixed:

- a duplicate `operationId: addProgrammeMember` (renamed the older one to
  `assignProgrammeMember`);
- duplicated `description:` keys in three operations (`submitAssessmentAttempt`,
  `submitAttemptAnswers`, and the session listing) — YAML rejects these, so codegen could not
  run at all before the fix;
- triplicated path keys (`/enrolments/{enrolmentId}`,
  `/programmes/{programmeId}/members`, `/programmes/{programmeId}/members/{userId}`) that are
  now one entry each, with the withdrawal, add-vs-replace and last-admin semantics folded into
  the surviving operation's description.

### Codegen is idempotent again

Once the spec parsed, orval kept regenerating `lib/api-zod/src/index.ts` as `export *` of both
generated folders — and those two export the same name for every request body, an ambiguous
re-export that fails `tsc --build` with `TS2308` for 26 symbols. The hand-written index now
lives in `lib/api-zod/src/index.template.ts`, and
`lib/api-spec/restore-zod-index.cjs` restores it at the end of every codegen run (as an orval
`hooks.afterAllFilesWrite` and again in the `codegen` script, because the hook did not fire
before orval's own typecheck pass). `lib/api-zod/tsconfig.json` gains the `dom` lib so the
generated multipart bodies (`Blob`, `File`) typecheck; the package is `emitDeclarationOnly`,
so it costs nothing at runtime.

### Knock-on fixes the regenerated clients exposed

- `artifacts/api-server/src/routes/trainhub.ts` parsed a `SubmitAssessmentAttemptBody` that no
  longer exists — and it took `appliedScore` and `recallScore` **from the client**, so a caller
  could mark their own course competent. That is the round-6 finding, so the route now answers
  `410 Gone` pointing at `/assessments/:assessmentId/attempts` →
  `/attempts/{attemptId}/submit`, where scores are computed server-side.
- `artifacts/trainhub360/src/App.tsx` submitted those same client-side scores. It now shows
  the message that assessment happens in the learner view and competence is set by the server,
  instead of pretending to submit.
- `artifacts/api-server/src/index.ts` — `app.listen(port, (err?: Error) => …)`, since the
  regenerated client types narrowed that callback.
- `lib/api/tests/async-errors.test.js` seeded one person with `admin` both org-wide and in a
  programme, which the *new* pair uniqueness correctly rejects. It now seeds `owner` org-wide
  and `admin` in the programme — the same authority, and a real example of the constraint
  working.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run typecheck` (all packages) | clean |
| `pnpm --filter @workspace/api run build` | clean |
| API suite, real SQL Server (`TrainHub360_Test`) | **139 / 139** |
| Frontend typecheck | clean |
| Frontend UI suite | **33 / 33** |
| `prisma migrate status` | up to date |

API total is 135 from Phase B plus the 4 new migration cases.

## Still open (unchanged by this phase)

Phase 3 trainer verification UI and the three-tab builder, S3/Azure `StorageProvider` and a
real `scanUpload`, Phase 4 (the whole assessment → competence → certificate → review-credit
loop, typed grading, time limits, `maxAttempts`), Phase 5.4/5.5 (reminder cadence and `.ics`
export), Phase E verification UI, and the round-6 low items (`providerForUrl` suffix match,
session `capacity` validation, UTC date/time strings, `PATCH /assessments/:id` after
publishing, `POST /bookings` matching by name, unused `PUBLIC_PATHS`).
