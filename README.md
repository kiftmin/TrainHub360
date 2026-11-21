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
Deployment decision (recorded 2026-11-19): this repository deploys with `prisma db push` (see `lib/db/package.json` `prisma:push`), not `prisma migrate`; there is no historical `migrations/` folder. Every schema change must be applied to a backup-restored copy first and reviewed for data-loss warnings. `UserRole` already carries a surrogate `id` primary key plus `@@unique([userId, roleId, programmeId])`; no PK rewrite is required on existing deployments.

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
Learning content files go through `lib/api/src/services/storage.ts` (`StorageProvider`). The default local-disk provider writes under `STORAGE_DIR` (default `.storage/` relative to the API process); mount a persistent volume in production. S3/Azure providers are reserved but not implemented. Uploads are JSON base64 (`POST /api/modules/:moduleId/content/upload`) capped by `UPLOAD_MAX_BYTES` (default 50 MB) with an extension/MIME allowlist; `scanUpload` is a no-op hook today.

Session reminders are scheduled when the API starts (`jobs/sessionReminderJob.ts`), deduplicated through `ReminderLog`. Personal calendar feeds live at `GET /api/calendar/feed.ics?token=...`; the token is issued by `GET /api/me/ical-token` and can be rotated by org admins.

## Docs
See `documents/corporate-training-platform-proposal.md` and `ARCHITECTURE.md`.

