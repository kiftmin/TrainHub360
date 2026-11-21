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

Session reminders are scheduled when the API starts (`jobs/sessionReminderJob.ts`), deduplicated through `ReminderLog`. Personal calendar feeds live at `GET /api/calendar/feed.ics?token=...`; the token is issued by `GET /api/me/ical-token` and can be rotated by org admins.

## Docs
See `documents/corporate-training-platform-proposal.md` and `ARCHITECTURE.md`.

