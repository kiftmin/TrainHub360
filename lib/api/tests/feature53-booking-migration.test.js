import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const migrationsDir = path.join(here, "..", "..", "db", "prisma", "migrations");
const migrationPaths = [
  path.join(migrationsDir, "20261123_feature53_learner_booking", "migration.sql"),
  path.join(migrationsDir, "20261124_feature53_booking_validation", "migration.sql"),
  path.join(migrationsDir, "20261125_feature53_booking_reconciliation", "migration.sql"),
];

const bookingsTable = "bookings_f53mig";
const availabilityTable = "trainer_availability_f53mig";
const exceptionsTable = "trainer_availability_exceptions_f53mig";
const viewName = "v_feature53_booking_migration_review_f53mig";

function mssql() {
  return require(require.resolve("mssql", { paths: [path.join(here, "..", "..", "..", "artifacts", "api-server")] }));
}

function connectionConfig(url) {
  const withoutScheme = url.replace(/^sqlserver:\/\//, "");
  const [authority, ...rest] = withoutScheme.split(";");
  const options = Object.fromEntries(rest.filter((p) => p.includes("=")).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
  const [credentials, hostPort] = authority.includes("@")
    ? [authority.slice(0, authority.lastIndexOf("@")), authority.slice(authority.lastIndexOf("@") + 1)]
    : ["", authority || "localhost:1433"];
  const [user, password] = credentials.includes(":")
    ? [decodeURIComponent(credentials.slice(0, credentials.indexOf(":"))), decodeURIComponent(credentials.slice(credentials.indexOf(":") + 1))]
    : [credentials || options.user, credentials ? undefined : options.password];
  const [server, portText] = hostPort.split(":");
  const flag = (name) => String(options[name] ?? options[name.toLowerCase()] ?? "false").toLowerCase() === "true";
  return {
    server: server || "localhost",
    port: Number(portText) || 1433,
    database: options.database,
    user,
    password,
    options: { encrypt: flag("encrypt"), trustServerCertificate: flag("trustServerCertificate"), enableArithAbort: true },
  };
}

const OLD_BOOKINGS = `
CREATE TABLE [dbo].[${bookingsTable}] (
  [id] NVARCHAR(450) NOT NULL PRIMARY KEY,
  [org_id] NVARCHAR(450) NULL,
  [trainer_id] NVARCHAR(450) NULL,
  [learner_id] NVARCHAR(450) NULL,
  [course] NVARCHAR(450) NOT NULL DEFAULT N'',
  [course_id] NVARCHAR(450) NULL,
  [date] NVARCHAR(50) NULL,
  [time] NVARCHAR(50) NULL,
  [duration] NVARCHAR(80) NULL,
  [status] NVARCHAR(50) NOT NULL DEFAULT N'confirmed',
  [meeting_link] NVARCHAR(1000) NULL
);
`;

const FIXTURE = `
INSERT INTO [dbo].[${bookingsTable}] ([id], [org_id], [trainer_id], [learner_id], [date], [time], [duration], [status]) VALUES
  (N'utc-verified', N'org', N't1', N'l1', N'2026-12-01', N'10:00', N'30m', N'confirmed'),
  (N'jhb-verified', N'org', N't1', N'l2', N'2026-12-02', N'09:00', N'1h', N'confirmed'),
  (N'unverified-legacy', N'org', N't1', N'l3', N'2026-12-03', N'11:00', N'45m', N'confirmed'),
  (N'trainer-overlap-a', N'org', N't2', N'l4', N'2026-12-04', N'09:00', N'1h', N'confirmed'),
  (N'trainer-overlap-b', N'org', N't2', N'l5', N'2026-12-04', N'09:30', N'30m', N'confirmed'),
  (N'learner-overlap-a', N'org', N't3', N'l6', N'2026-12-05', N'14:00', N'90m', N'confirmed'),
  (N'learner-overlap-b', N'org', N't4', N'l6', N'2026-12-05', N'14:45', N'30m', N'confirmed'),
  (N'adjacent-a', N'org', N't5', N'l7', N'2026-12-06', N'09:00', N'1h', N'confirmed'),
  (N'adjacent-b', N'org', N't5', N'l8', N'2026-12-06', N'10:00', N'30m', N'confirmed'),
  (N'cancelled-overlap', N'org', N't2', N'l9', N'2026-12-04', N'09:45', N'30m', N'cancelled'),
  (N'missing-learner', N'org', N't6', NULL, N'2026-12-07', N'08:00', N'', N'confirmed'),
  (N'missing-date', N'org', N't7', N'l10', NULL, N'10:00', N'30m', N'confirmed'),
  (N'invalid-date-time', N'org', N't7', N'l11', N'not-a-date', N'25:00', N'30m', N'confirmed'),
  (N'duplicate-a', N'org', N't8', N'l12', N'2026-12-08', N'12:00', N'30m', N'confirmed'),
  (N'duplicate-b', N'org', N't8', N'l13', N'2026-12-08', N'12:00', N'30m', N'confirmed');
`;

function scoped(sql) {
  return sql
    .replace(/\bDF_bookings_/g, "DF_f53mig_bookings_")
    .replace(/\bDF_trainer_availability_/g, "DF_f53mig_trainer_availability_")
    .replace(/\bPK_trainer_availability_exceptions\b/g, `PK_f53mig_${exceptionsTable}`)
    .replace(/\bPK_trainer_availability\b/g, `PK_f53mig_${availabilityTable}`)
    .replace(/\bIX_bookings_learner_starts_at\b/g, `IX_f53mig_bookings_learner`)
    .replace(/\bIX_bookings_trainer_starts_status\b/g, `IX_f53mig_bookings_trainer`)
    .replace(/\bUX_bookings_one_confirmed_per_trainer_start\b/g, "UX_f53mig_bookings_one_confirmed")
    .replace(/\bIX_trainer_availability_trainer_day_active\b/g, "IX_f53mig_availability_day")
    .replace(/\bIX_trainer_availability_exceptions_trainer_date\b/g, "IX_f53mig_exceptions_date")
    .replace(/\bdbo\.trainer_availability_exceptions\b/g, `[dbo].[${exceptionsTable}]`)
    .replace(/\bdbo\.trainer_availability\b/g, `[dbo].[${availabilityTable}]`)
    .replace(/\bdbo\.v_feature53_booking_migration_review\b/g, `[dbo].[${viewName}]`)
    .replace(/\bdbo\.bookings\b/g, `[dbo].[${bookingsTable}]`);
}

function batches(sql) {
  return sql.split(/^\s*GO\s*$/im).map((batch) => batch.trim()).filter(Boolean);
}

let pool;

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the booking migration test");
  pool = await mssql().connect(connectionConfig(process.env.DATABASE_URL));
  for (const table of [exceptionsTable, availabilityTable, bookingsTable]) {
    await pool.request().batch(`IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL DROP TABLE [dbo].[${table}];`);
  }
  await pool.request().batch(`IF OBJECT_ID(N'dbo.${viewName}', N'V') IS NOT NULL DROP VIEW [dbo].[${viewName}];`);
  await pool.request().batch(OLD_BOOKINGS);
  await pool.request().batch(FIXTURE);
});

after(async () => {
  if (!pool) return;
  await pool.request().batch(`IF OBJECT_ID(N'dbo.${viewName}', N'V') IS NOT NULL DROP VIEW [dbo].[${viewName}];`).catch(() => null);
  for (const table of [exceptionsTable, availabilityTable, bookingsTable]) {
    await pool.request().batch(`IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL DROP TABLE [dbo].[${table}];`).catch(() => null);
  }
  await pool.close().catch(() => null);
});

async function runMigrations() {
  for (const file of migrationPaths) {
    for (const batch of batches(scoped(fs.readFileSync(file, "utf8")))) {
      await pool.request().batch(batch);
    }
  }
}

async function review() {
  const result = await pool.request().query(`SELECT * FROM [dbo].[${viewName}]`);
  return new Map(result.recordset.map((row) => [row.id, row]));
}

test("representative historical bookings migrate without losing source values", async () => {
  await runMigrations();
  await pool.request().batch(`
    UPDATE [dbo].[${bookingsTable}] SET timezone_provenance = N'VERIFIED_SOURCE' WHERE id = N'utc-verified';
    UPDATE [dbo].[${bookingsTable}] SET timezone_provenance = N'VERIFIED_TRAINER_ZONE', time_zone = N'Africa/Johannesburg',
      starts_at = N'2026-12-02T07:00:00', ends_at = N'2026-12-02T08:00:00' WHERE id = N'jhb-verified';
  `);

  const rows = (await pool.request().query(`SELECT * FROM [dbo].[${bookingsTable}] ORDER BY id`)).recordset;
  assert.equal(rows.length, 15);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get("utc-verified").date, "2026-12-01");
  assert.equal(byId.get("utc-verified").time, "10:00");
  assert.equal(byId.get("utc-verified").starts_at.toISOString(), "2026-12-01T10:00:00.000Z");
  assert.equal(byId.get("utc-verified").ends_at.toISOString(), "2026-12-01T10:30:00.000Z");
  assert.equal(byId.get("jhb-verified").date, "2026-12-02");
  assert.equal(byId.get("jhb-verified").time, "09:00");
  assert.equal(byId.get("jhb-verified").starts_at.toISOString(), "2026-12-02T07:00:00.000Z");
  assert.equal(byId.get("unverified-legacy").duration_minutes, 45);
  assert.equal(byId.get("trainer-overlap-a").ends_at.toISOString(), "2026-12-04T10:00:00.000Z");
  assert.equal(byId.get("learner-overlap-a").duration_minutes, 90);
  assert.equal(byId.get("adjacent-a").duration_minutes, 60);
  assert.equal(byId.get("missing-learner").duration_minutes, 30);
  assert.equal(byId.get("missing-date").starts_at, null);
  assert.equal(byId.get("invalid-date-time").starts_at, null);
  assert.deepEqual([byId.get("duplicate-a").status, byId.get("duplicate-b").status].sort(), ["confirmed", "legacy_conflict"]);
});

test("review view classifies intervals, timezone provenance and incomplete records", async () => {
  const reviewed = await review();
  assert.equal(reviewed.size, 15);

  assert.equal(reviewed.get("utc-verified").timezone_status, "verified");
  assert.equal(reviewed.get("utc-verified").timezone_verified, 1);
  assert.equal(reviewed.get("utc-verified").schedule_authoritative, 1);
  assert.equal(reviewed.get("jhb-verified").timezone_status, "verified");
  assert.equal(reviewed.get("jhb-verified").schedule_authoritative, 1);
  assert.equal(reviewed.get("unverified-legacy").timezone_status, "assumed_utc");
  assert.equal(reviewed.get("unverified-legacy").timezone_assumed, 1);
  assert.equal(reviewed.get("unverified-legacy").schedule_authoritative, 0);

  assert.equal(reviewed.get("trainer-overlap-a").trainer_overlap, 1);
  assert.equal(reviewed.get("trainer-overlap-b").trainer_overlap, 1);
  assert.equal(reviewed.get("trainer-overlap-a").learner_overlap, 0);
  assert.equal(reviewed.get("learner-overlap-a").learner_overlap, 1);
  assert.equal(reviewed.get("learner-overlap-b").learner_overlap, 1);
  assert.equal(reviewed.get("adjacent-a").trainer_overlap, 0);
  assert.equal(reviewed.get("adjacent-b").trainer_overlap, 0);
  assert.equal(reviewed.get("cancelled-overlap").trainer_overlap, 0);
  assert.equal(reviewed.get("cancelled-overlap").trainer_overlap, 0);

  assert.equal(reviewed.get("missing-learner").missing_learner, 1);
  assert.equal(reviewed.get("missing-date").invalid_interval, 1);
  assert.equal(reviewed.get("missing-date").incomplete_legacy_value, 1);
  assert.equal(reviewed.get("invalid-date-time").invalid_interval, 1);
  assert.equal(reviewed.get("invalid-date-time").incomplete_legacy_value, 1);
  assert.match(reviewed.get("invalid-date-time").review_reason, /incomplete or inconsistent legacy date\/time/);
  assert.match(reviewed.get("trainer-overlap-a").review_reason, /trainer interval overlap/);
  assert.match(reviewed.get("learner-overlap-a").review_reason, /learner interval overlap/);

  const rows = [...reviewed.values()];
  assert.equal(rows.filter((row) => row.trainer_overlap === 1).length, 2);
  assert.equal(rows.filter((row) => row.learner_overlap === 1).length, 2);
  assert.equal(rows.filter((row) => row.incomplete_legacy_value === 1 || row.invalid_interval === 1).length, 2);
  assert.equal(rows.filter((row) => row.timezone_verified === 0).length, 13);
});

test("migration re-execution preserves all rows and classifications", async () => {
  const before = (await pool.request().query(`SELECT * FROM [dbo].[${bookingsTable}] ORDER BY id`)).recordset;
  const beforeReview = await review();
  await runMigrations();
  const after = (await pool.request().query(`SELECT * FROM [dbo].[${bookingsTable}] ORDER BY id`)).recordset;
  const afterReview = await review();
  assert.deepEqual(after, before);
  assert.deepEqual([...afterReview].map(([id, row]) => [id, row.timezone_status, row.trainer_overlap, row.learner_overlap, row.schedule_authoritative]),
    [...beforeReview].map(([id, row]) => [id, row.timezone_status, row.trainer_overlap, row.learner_overlap, row.schedule_authoritative]));
});
