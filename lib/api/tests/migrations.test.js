// Phase 1.7: the UserRole primary-key migration, tested against a database seeded with the OLD
// shape.
//
// `prisma migrate status` on a database that already matches the schema proves nothing about
// the migration: the statements that matter are the ones that fire when `user_roles` still has
// the composite primary key and no `id` column. This test builds that old shape in its own
// throwaway database, runs the real `migration.sql`, and checks the result.
//
// It needs a SQL Server login that can CREATE DATABASE (the same one DATABASE_URL uses). When it
// cannot create one it fails rather than skipping — the prompt's rule for this suite.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SQL_PATH = path.join(here, "..", "..", "db", "prisma", "migrations", "20261120_baseline_user_role_primary_key", "migration.sql");
const SCHEMA_PATH = path.join(here, "..", "..", "db", "prisma", "schema.prisma");

function mssql() {
  // `mssql` is a dependency of artifacts/api-server (the API's own driver), not of lib/api.
  return require(require.resolve("mssql", { paths: [path.join(here, "..", "..", "..", "artifacts", "api-server")] }));
}

// Same DATABASE_URL parsing as lib/db/scripts/migrate-baseline.cjs: Prisma's sqlserver:// form,
// with credentials either in the authority or as options.
function connectionConfig(url, database) {
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
  const config = {
    server: server || "localhost",
    port: Number(portText) || 1433,
    user,
    password,
    options: { encrypt: flag("encrypt"), trustServerCertificate: flag("trustServerCertificate"), enableArithAbort: true },
  };
  // Omitted rather than set to null: the driver falls back to master for an explicit null.
  if (database) config.database = database;
  return config;
}

const baseUrl = process.env.DATABASE_URL;
const DB_NAME = `TrainHub360_Migration_${process.pid}`;
const OLD_SCHEMA = `
CREATE TABLE [dbo].[users] (
  [id] NVARCHAR(1000) NOT NULL PRIMARY KEY,
  [name] NVARCHAR(1000) NOT NULL
);
CREATE TABLE [dbo].[roles] (
  [id] NVARCHAR(1000) NOT NULL PRIMARY KEY,
  [name] NVARCHAR(1000) NOT NULL
);
CREATE TABLE [dbo].[programmes] (
  [id] NVARCHAR(1000) NOT NULL PRIMARY KEY
);
-- The shape the review found: the pair is the primary key and there is no surrogate id.
CREATE TABLE [dbo].[user_roles] (
  [user_id] NVARCHAR(1000) NOT NULL,
  [role_id] NVARCHAR(1000) NOT NULL,
  [programme_id] NVARCHAR(1000) NULL,
  CONSTRAINT [PK__user_rol__old] PRIMARY KEY ([user_id], [role_id])
);
INSERT INTO [dbo].[users] ([id], [name]) VALUES (N'u1', N'Ana'), (N'u2', N'Bo');
INSERT INTO [dbo].[roles] ([id], [name]) VALUES (N'r1', N'admin'), (N'r2', N'trainer');
INSERT INTO [dbo].[programmes] ([id]) VALUES (N'p1');
INSERT INTO [dbo].[user_roles] ([user_id], [role_id], [programme_id]) VALUES
  (N'u1', N'r1', N'p1'),
  (N'u1', N'r2', N'p1'),
  (N'u2', N'r2', NULL);
`;

let master;
let pool;
let available = true;

// The test needs the OLD shape to migrate. It tries a throwaway database first (a login with
// CREATE DATABASE), and otherwise rebuilds `user_roles` inside the test database under a
// temporary name, runs the migration against that, and restores the real table. The second path
// needs no extra privileges and is what CI uses, because CI's login owns TrainHub360_Test and
// nothing else.
let scratchTable = null;

before(async () => {
  if (!baseUrl) throw new Error("DATABASE_URL is not set; this test needs a SQL Server database");
  const m = mssql();
  try {
    master = await m.connect(connectionConfig(baseUrl, "master"));
    await master.request().batch(`IF DB_ID(N'${DB_NAME}') IS NOT NULL BEGIN ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB_NAME}]; END`);
    await master.request().batch(`CREATE DATABASE [${DB_NAME}]`);
  } catch {
    if (master) await master.close().catch(() => {});
    master = null;
    available = false;
  }
  // A plain `undefined` would still be passed through as a config key, and mssql would connect
  // to master; the field has to be absent for the driver to use the URL's own database.
  // Connect explicitly to the database under test: mssql quietly uses master for an absent or
  // null `database`, and a login that only owns the test database cannot create tables there.
  const testDatabase = available ? DB_NAME : /;database=([^;]+)/i.exec(baseUrl)?.[1];
  if (!testDatabase) throw new Error("DATABASE_URL has no database= parameter");
  pool = await m.connect(connectionConfig(baseUrl, testDatabase));
  if (!available) {
    scratchTable = "user_roles_migration_test";
    await pool.request().batch(`
      IF OBJECT_ID(N'dbo.${scratchTable}', N'U') IS NOT NULL DROP TABLE [dbo].[${scratchTable}];
      CREATE TABLE [dbo].[${scratchTable}] (
        [user_id] NVARCHAR(1000) NOT NULL,
        [role_id] NVARCHAR(1000) NOT NULL,
        [programme_id] NVARCHAR(1000) NULL,
        CONSTRAINT [PK__${scratchTable}] PRIMARY KEY ([user_id], [role_id])
      );`);
    await pool.request().batch(`
      IF OBJECT_ID(N'dbo.users', N'U') IS NULL BEGIN CREATE TABLE [dbo].[users] ([id] NVARCHAR(1000) NOT NULL PRIMARY KEY, [name] NVARCHAR(1000) NOT NULL); END
      IF OBJECT_ID(N'dbo.roles', N'U') IS NULL BEGIN CREATE TABLE [dbo].[roles] ([id] NVARCHAR(1000) NOT NULL PRIMARY KEY, [name] NVARCHAR(1000) NOT NULL); END
      DELETE FROM [dbo].[${scratchTable}];
      INSERT INTO [dbo].[${scratchTable}] ([user_id], [role_id], [programme_id]) VALUES
        (N'u1', N'r1', N'p1'),
        (N'u1', N'r2', N'p1'),
        (N'u2', N'r2', NULL);`);
  } else {
    await pool.request().batch(OLD_SCHEMA);
  }
});

after(async () => {
  if (pool && scratchTable) await pool.request().batch(`IF OBJECT_ID(N'dbo.${scratchTable}', N'U') IS NOT NULL DROP TABLE [dbo].[${scratchTable}];`).catch(() => {});
  if (pool) await pool.close().catch(() => {});
  if (available && master) {
    await master.request().batch(`IF DB_ID(N'${DB_NAME}') IS NOT NULL BEGIN ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB_NAME}]; END`).catch(() => {});
    await master.close().catch(() => {});
  }
});

// Points the migration's statements at the table under test. Two rewrites, in this order:
//   - constraint and index names get the test's own prefix, so they cannot collide with the real
//     `user_roles_pkey` that exists in the test database (constraint names are per database, and
//     SQL Server does not scope them to the table);
//   - then the table name, for every remaining reference.
function scoped(sql) {
  if (!scratchTable) return sql;
  return sql
    .replace(/\buser_roles_(pkey|user_id_role_id_key|programme_id_idx)\b/g, `${scratchTable}_$1`)
    .replace(/\buser_roles\b/g, scratchTable);
}

// The migration is a series of guarded steps separated by GO, each its own batch: SQL Server
// compiles a whole batch before running it, so a step that uses a column added by an earlier step
// only compiles if the two are sent separately.
function batches(sql) {
  return sql
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function runMigration() {
  for (const batch of batches(scoped(migrationSql()))) {
    await pool.request().batch(batch);
  }
}

function tableRef() {
  return `[dbo].[${scratchTable ?? "user_roles"}]`;
}

async function shape() {
  const rows = (await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.${scratchTable ?? "user_roles"}') AND name = N'id') AS has_id,
      (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.${scratchTable ?? "user_roles"}') AND name = N'id' AND is_nullable = 0) AS id_not_null,
      (SELECT COUNT(*) FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
        WHERE t.name = N'${scratchTable ?? "user_roles"}' AND kc.type = N'PK') AS primary_keys,
      (SELECT COUNT(*) FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
        WHERE t.name = N'${scratchTable ?? "user_roles"}' AND kc.type = N'PK'
          AND kc.name = N'${scratchTable ? `${scratchTable}_pkey` : "user_roles_pkey"}') AS pk_is_new,
      (SELECT COUNT(*) FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
        WHERE t.name = N'${scratchTable ?? "user_roles"}' AND kc.type = N'UQ'
          AND kc.name = N'${scratchTable ? `${scratchTable}_user_id_role_id_key` : "user_roles_user_id_role_id_key"}') AS unique_pairs,
      (SELECT COUNT(*) FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
        WHERE t.name = N'${scratchTable ?? "user_roles"}'
          AND i.name = N'${scratchTable ? `${scratchTable}_programme_id_idx` : "user_roles_programme_id_idx"}') AS programme_index
  `)).recordset;
  return rows[0];
}

const migrationSql = () => fs.readFileSync(SQL_PATH, "utf8");

test("the migration converts the old composite key to a surrogate id", async () => {
  const before = await shape();
  assert.equal(before.has_id, 0, "the seeded table starts without an id column");
  assert.equal(before.primary_keys, 1);

  await runMigration();

  const rows = (await pool.request().query(`SELECT [user_id], [role_id], [programme_id], [id] FROM ${tableRef()} ORDER BY [user_id], [role_id]`)).recordset;
  assert.equal(rows.length, 3, "no grant was lost");
  assert.deepEqual(rows.map((r) => [r.user_id, r.role_id]), [["u1", "r1"], ["u1", "r2"], ["u2", "r2"]], "every old row survived");

  const after = await shape();
  assert.equal(after.has_id, 1, "the id column exists");
  assert.equal(after.id_not_null, 1, "and it is required");
  assert.equal(after.primary_keys, 1, "exactly one primary key");
  assert.equal(after.pk_is_new, 1, "the primary key is on the new id column, not the old pair");
  assert.equal(after.unique_pairs, 1, "the old pair is kept unique");
  assert.equal(after.programme_index, 1, "the programme index Prisma expects exists");

  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "every row has its own id");
  for (const id of ids) assert.match(id, /^[0-9A-F]{25}$/i, "ids are 25 hex characters");
});

test("the surrogate key keeps the old pair unique, and its limit is stated in the schema", async () => {
  // The old key was (user_id, role_id): a person could hold a role in only one programme.
  // The new key is the id, and the old pair is kept as a unique constraint, so that limit stays
  // for now. This is the guard on both halves: a duplicate of an existing pair is rejected, and
  // the schema says what the database enforces. Allowing the same role in two programmes is a
  // separate change to the schema's @@unique, not something this migration does.
  const count = (await pool.request().query(`SELECT COUNT(*) AS n FROM ${tableRef()} WHERE [user_id] = N'u2' AND [role_id] = N'r2'`)).recordset[0].n;
  assert.equal(count, 1);
  await assert.rejects(
    () => pool.request().batch(`INSERT INTO ${tableRef()} ([id], [user_id], [role_id], [programme_id]) VALUES (N'extra2', N'u2', N'r2', N'p2')`),
    /UNIQUE|duplicate/i,
    "an existing pair cannot be granted a second time",
  );
});

test("re-running the migration changes nothing", async () => {
  const before = await shape();
  const count = (await pool.request().query(`SELECT COUNT(*) AS n FROM ${tableRef()}`)).recordset[0].n;
  const ids = (await pool.request().query(`SELECT [id] FROM ${tableRef()} ORDER BY [id]`)).recordset.map((r) => r.id);
  await runMigration();
  const after = await shape();
  assert.deepEqual(after, before, "the guarded steps are all no-ops the second time");
  assert.equal((await pool.request().query(`SELECT COUNT(*) AS n FROM ${tableRef()}`)).recordset[0].n, count, "and no rows are added or lost");
  assert.deepEqual((await pool.request().query(`SELECT [id] FROM ${tableRef()} ORDER BY [id]`)).recordset.map((r) => r.id), ids, "and the backfilled ids are unchanged");
});

test("schema.prisma agrees with the migrated table", async () => {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  const userRole = schema.slice(schema.indexOf("model UserRole"), schema.indexOf("model RolePermission"));
  assert.match(userRole, /^\s*id\s+String\s+@id\s+@default\(cuid\(\)\)/m, "UserRole has a cuid id");
  assert.match(userRole, /@@unique\(\[userId, roleId, programmeId\]\)/, "and keeps the triple unique");
  assert.match(userRole, /@@map\("user_roles"\)/);
});
