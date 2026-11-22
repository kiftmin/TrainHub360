// Baseline migration runner (SQL Server).
//
// Deployments have used `prisma db push`, so this database has no `_prisma_migrations` table and
// no migration history. `prisma migrate deploy` refuses to touch a database it has no record of.
// This script does the one-time switch:
//
//   1. runs the baseline migration's SQL, in batches, against DATABASE_URL;
//   2. creates `_prisma_migrations` if it is missing;
//   3. records the baseline as already applied.
//
// After that `prisma migrate deploy` works normally.
//
// With --all it then runs every migration that is not yet recorded, in name order, which is how a
// database built with `db push` catches up to the ones added since (the Phase 4 assessment
// builder, for instance). Without it, only the baseline runs.
//
// It is safe to run against a database that already has the new shape: every statement in the
// migrations is guarded, and a migration already recorded is skipped.
//
// Usage (no env loading needed — it reads .env itself):
//   node lib/db/scripts/migrate-baseline.cjs [--dry-run] [--all]
//
// DATABASE_URL is taken from the environment if it is already set, otherwise from the first
// .env found walking up from this file: <repo>/.env, then <repo>/lib/db/.env. Before this it
// only read process.env, so on Windows/PowerShell (where the documented `set -a && . ./.env`
// line cannot run) the script refused to start and the migrations never reached the database
// the API was using.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MIGRATION = "20261120_baseline_user_role_primary_key";
const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");
const SQL_PATH = path.join(MIGRATIONS_DIR, MIGRATION, "migration.sql");
const DRY_RUN = process.argv.includes("--dry-run");
const ALL = process.argv.includes("--all");

// `prisma db push` and Prisma's own migration runner leave `_prisma_migrations` out of the
// application schema, so this table is created here rather than by schema.prisma.
const CREATE_MIGRATIONS_TABLE = `
IF OBJECT_ID(N'dbo._prisma_migrations', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[_prisma_migrations] (
    [id] NVARCHAR(36) NOT NULL PRIMARY KEY,
    [checksum] NVARCHAR(64) NOT NULL,
    [finished_at] DATETIMEOFFSET(3) NULL,
    [migration_name] NVARCHAR(255) NOT NULL,
    [logs] NVARCHAR(MAX) NULL,
    [rolled_back_at] DATETIMEOFFSET(3) NULL,
    [started_at] DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    [applied_steps_count] INT NOT NULL DEFAULT 0
  );
END`;

/**
 * Load DATABASE_URL from the environment, or from a .env file if it is not there.
 * Searched in order: <repo>/.env, <repo>/lib/db/.env. An already-set environment variable wins.
 */
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, from: "environment" };
  const candidates = [
    path.join(__dirname, "..", "..", "..", ".env"),
    path.join(__dirname, "..", "..", ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    // A minimal parser: dotenv is not a dependency of this package, and the file is a flat
    // KEY="value" list. Quoted values are unquoted, comments and blanks skipped.
    const parsed = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      parsed[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    if (parsed.DATABASE_URL) return { url: parsed.DATABASE_URL, from: file };
  }
  return { url: undefined, from: null };
}

async function main() {
  const loaded = loadDatabaseUrl();
  const url = loaded.url;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set and no .env was found. Set it, or create one at " +
        path.join(__dirname, "..", "..", "..", ".env") + " containing DATABASE_URL=sqlserver://...",
    );
  }
  const database = (url.match(/database=([^;]*)/) || [])[1] || "(unknown)";
  console.log(`database: ${database} (DATABASE_URL from ${loaded.from})`);
  if (!url.startsWith("sqlserver:")) throw new Error("this baseline is written for SQL Server (sqlserver:// DATABASE_URL)");

  // The SQL Server driver the API already uses (mssql, which wraps tedious) rather than a new
  // dependency for a one-off script.
  let mssql;
  try {
    mssql = require(require.resolve("mssql", { paths: [path.join(__dirname, "..", "..", "..", "artifacts", "api-server")] }));
  } catch {
    throw new Error("the `mssql` driver is not installed; run pnpm install in artifacts/api-server");
  }

  const pool = await mssql.connect(connectionConfig(url));
  const exec = (sql) => pool.request().batch(sql);
  const query = async (sql) => (await pool.request().query(sql)).recordset;

  try {
    const existing = await query(
      `SELECT 1 AS present FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = N'dbo' AND t.name = N'_prisma_migrations'`,
    );
    if (existing.length) {
      const applied = await query(
        `SELECT [migration_name], [finished_at] FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'${MIGRATION}'`,
      );
      if (applied.length) {
        console.log(`already applied: ${MIGRATION} (finished_at ${applied[0].finished_at})`);
        if (ALL) await runPending(exec, query);
        return;
      }
    }

    const before = await describeUserRoles(query);
    console.log("before:", JSON.stringify(before));

    const sql = fs.readFileSync(SQL_PATH, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");

    if (DRY_RUN) {
      console.log(`dry run: would run ${statements(sql).length} batch(es) from ${MIGRATION}`);
      return;
    }

    for (const statement of statements(sql)) {
      await exec(statement);
    }

    const after = await describeUserRoles(query);
    console.log("after: ", JSON.stringify(after));

    await exec(CREATE_MIGRATIONS_TABLE);
    const id = crypto.randomUUID();
    await exec(
      `INSERT INTO [dbo].[_prisma_migrations] ([id], [checksum], [finished_at], [migration_name], [applied_steps_count])
       VALUES (N'${id}', N'${checksum}', SYSDATETIMEOFFSET(), N'${MIGRATION}', 1)`,
    );
    console.log(`recorded ${MIGRATION} as applied (checksum ${checksum.slice(0, 12)}…)`);
    console.log("from here, use `prisma migrate deploy`.");
    if (ALL) await runPending(exec, query);
  } finally {
    await pool.close();
  }
}

// Every migration directory that is not yet recorded, in name order (the timestamps sort).
async function runPending(exec, query) {
  const wanted = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of wanted) {
    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const done = await query(
      `SELECT [finished_at] FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'${name}'
        AND [finished_at] IS NOT NULL AND [rolled_back_at] IS NULL`,
    );
    if (done.length) {
      console.log(`pending: skipped ${name} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(sqlPath, "utf8");
    if (DRY_RUN) {
      console.log(`dry run: would run ${statements(sql).length} batch(es) from ${name}`);
      continue;
    }
    for (const statement of statements(sql)) await exec(statement);
    const recordedAfter = await query(
      `SELECT [finished_at] FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'${name}'
        AND [finished_at] IS NOT NULL AND [rolled_back_at] IS NULL`,
    );
    if (recordedAfter.length) {
      console.log(`recorded by SQL: ${name}`);
      continue;
    }
    await exec(
      `INSERT INTO [dbo].[_prisma_migrations] ([id], [checksum], [finished_at], [migration_name], [applied_steps_count])
       VALUES (N'${crypto.randomUUID()}', N'${crypto.createHash("sha256").update(sql).digest("hex")}', SYSDATETIMEOFFSET(), N'${name}', 1)`,
    );
    console.log(`applied ${name}`);
  }
}

// DATABASE_URL is Prisma's `sqlserver://user:pass@host:port;database=…;…` form, which mssql does
// not parse. Convert it rather than adding a second environment variable that could drift.
function connectionConfig(url) {
  const withoutScheme = url.replace(/^sqlserver:\/\//, "");
  const [authority, ...rest] = withoutScheme.split(";");
  const options = Object.fromEntries(
    rest
      .filter((pair) => pair.includes("="))
      .map((pair) => {
        const i = pair.indexOf("=");
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
  );
  // `sqlserver://localhost:1433;database=…;user=…;password=…` (credentials as options) and
  // `sqlserver://user:pass@host:1433;database=…` (credentials in the authority) are both valid.
  const [credentials, hostPort] = authority.includes("@")
    ? [authority.slice(0, authority.lastIndexOf("@")), authority.slice(authority.lastIndexOf("@") + 1)]
    : ["", authority || "localhost:1433"];
  const [user, password] = credentials.includes(":")
    ? [decodeURIComponent(credentials.slice(0, credentials.indexOf(":"))), decodeURIComponent(credentials.slice(credentials.indexOf(":") + 1))]
    : [credentials || options.user, credentials ? undefined : options.password];
  const [server, portText] = hostPort.split(":");
  const flag = (name, fallback) => {
    const raw = options[name] ?? options[name.toLowerCase()];
    return raw === undefined ? fallback : String(raw).toLowerCase() === "true";
  };
  return {
    server: server || "localhost",
    port: Number(portText) || 1433,
    database: options.database,
    user,
    password,
    options: {
      encrypt: flag("encrypt", false),
      trustServerCertificate: flag("trustServerCertificate", false),
      enableArithAbort: true,
    },
  };
}

async function describeUserRoles(query) {
  const rows = await query(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.user_roles') AND name = N'id') AS has_id,
      (SELECT COUNT(*) FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
        WHERE t.name = N'user_roles' AND kc.type = N'PK') AS primary_keys,
      (SELECT COUNT(*) FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
        WHERE t.name = N'user_roles' AND kc.type = N'UQ' AND kc.name = N'user_roles_user_id_role_id_key') AS unique_pairs`);
  return rows[0] ?? {};
}

// The baseline is a sequence of guarded steps separated by GO. Each step must be its own batch:
// SQL Server compiles a whole batch before running it, so a statement that touches a column added
// earlier in the same batch fails to compile even though the ALTER would have created it.
function statements(sql) {
  // A migration written on Windows arrives with CRLF, and `/^\s*GO\s*$/m` does not match `GO\r`:
  // the file then runs as one batch, which SQL Server refuses to compile past the first statement
  // that needs the column added earlier in the same file. Normalise first.
  return sql
    .replace(/\r\n?/g, "\n")
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
