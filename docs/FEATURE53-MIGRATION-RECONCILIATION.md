# Section 5.3 historical booking reconciliation

## Historical timezone decision

Historical booking `date` and `time` values are classified as **unverified floating local wall-clock strings**. The repository does not establish UTC, `Africa/Johannesburg`, or any other single timezone for legacy bookings.

Evidence:

- Before `03f2671`, `POST /bookings` stored `req.body.date` and `req.body.time` verbatim (`lib/api/src/routes/index.ts` at commit `e6d6898`, lines 3957-3987). The OpenAPI `BookingInput` had plain `date` and `time` strings with no offset or timezone field (`lib/api-spec/openapi.yaml` at `e6d6898`, lines 3501-3508).
- The learner form used HTML `date` and `time` inputs and sent their values unchanged (`frontend/src/pages/Calendar.tsx` at `e6d6898`, lines 120-134). Such inputs produce wall-clock strings without a zone.
- The legacy Prisma model stored `date`/`time` as `String` with no timezone column (`lib/db/prisma/schema.prisma` at `e6d6898`, lines 490-507).
- Deployment configuration (`.env.example`, `Dockerfile`, `docker-compose.yml`, `frontend/Dockerfile`) sets no `TZ` or booking timezone. Session code that had a timezone field is a separate feature and is not evidence for bookings.
- No production booking export is available in the repository, so individual legacy rows cannot be assigned a real timezone from data.

Period covered: the legacy string-only booking path existed from approximately 2026-09-10 through 2026-11-24, immediately before Section 5.3. A short transitional implementation between `03f2671` and `218c3e4` parsed no-offset values with server-local time while labelling them UTC; any records from that window are also unverified.

Exceptions: none can be proven. All genuine pre-5.3 bookings are treated as unverified. Rows with missing or invalid legacy `date`/`time` cannot be interpreted at all.

## Migration decision

`20261125_feature53_booking_reconciliation`:

- Adds nullable `dbo.bookings.timezone_provenance`. Original `date`, `time`, `duration` and all booking rows are preserved.
- Marks pre-existing rows with no provenance as `ASSUMED_UTC_BACKFILL` when `time_zone = 'UTC'`, otherwise `UNVERIFIED_LEGACY`. New bookings created by `POST /bookings` are explicitly written as `VERIFIED_TRAINER_ZONE`.
- Repairs the original backfill: SQL Server 2025 rejects `YYYY-MM-DDTHH:mm` for `DATETIME2`, so the original migration left valid legacy timestamps null. The reconciliation migration and the corrected original migration now append `:00` when the historical time has only `HH:mm`.
- Replaces `v_feature53_booking_migration_review` with a view that reports verified / assumed / unverified timezone status, trainer and learner interval overlaps, missing learner ownership, invalid durations, invalid intervals, incomplete or inconsistent legacy values, an administrator-readable reason, and whether a schedule may be treated as authoritative.
- Uses active-status rules (`confirmed` only) for overlap detection and excludes cancelled, rejected and `legacy_conflict` rows from active conflicts.

Representative fixture results (`lib/api/tests/feature53-booking-migration.test.js`): 15 records preserved; 2 verified timezone records; 13 assumed/unverified timezone records; 2 trainer-overlap rows; 2 learner-overlap rows; 2 incomplete/invalid records. Re-running the migrations preserved all rows and classifications.

## Production-readiness decision

Do not apply the migration to production until an administrator reconciles every row whose `timezone_status` is `assumed_utc`, `unverified` or `unknown`, or whose review reason mentions any overlap, invalid interval, invalid duration, missing learner ownership, or incomplete/inconsistent legacy value.

- `starts_at` and `ends_at` for those rows are **not authoritative**; only the original `date`, `time`, `duration` and `status` are source data.
- Confirm the source timezone from an external system or trainer record before approving any legacy row. Never treat the migration's UTC default as confirmation.
- Keep `date`, `time` and `duration` unchanged; record the decision by updating `timezone_provenance` to `VERIFIED_SOURCE` and, only when the instant is actually known, correcting `starts_at`/`ends_at`.
- Administrators can identify unresolved records with `SELECT * FROM dbo.v_feature53_booking_migration_review WHERE schedule_authoritative = 0`.
- The view never marks a `legacy_conflict`, cancelled or unverified row as an authoritative schedule.
