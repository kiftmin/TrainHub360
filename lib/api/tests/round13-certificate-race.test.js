import "./support/loadEnv.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { issueCertificateForEnrolment } from "../dist/services/certificates.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MIGRATION = path.join(here, "..", "..", "db", "prisma", "migrations", "20261122_round13_certificate_dedupe", "migration.sql");

describe("Round 13 / 1.1-1.3 — one active certificate per enrolment", () => {
  let prisma;
  const stamp = Date.now();
  const ids = { org: `r13c-org-${stamp}`, programme: `r13c-prog-${stamp}`, course: `r13c-course-${stamp}` };
  const enrolmentIds = [];

  before(async () => {
    if (!requireDatabase("round13-certificate-race.test.js")) return;
    prisma = new PrismaClient();
    try { await prisma.$queryRaw`SELECT 1`; } catch { await prisma.$disconnect(); prisma = null; return; }
    const [index] = await prisma.$queryRaw`
      SELECT 1 AS present FROM sys.indexes
      WHERE name = N'UX_certificates_one_active_per_enrolment' AND object_id = OBJECT_ID(N'dbo.certificates')
    `;
    assert.ok(index, "expected the filtered unique index UX_certificates_one_active_per_enrolment");
    await seedRoles(prisma, ["learner"]);
    await prisma.organization.create({ data: { id: ids.org, name: "R13 Certificates" } });
    await prisma.programme.create({ data: { id: ids.programme, orgId: ids.org, name: "R13 Certificates", type: "Compliance", owner: "owner" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.programme, title: "R13 Compliance", category: "compliance", validityMonths: 12 } });
    const learner = await prisma.user.create({
      data: { orgId: ids.org, name: "R13 Learner", email: `r13c-${stamp}@example.com`, passwordHash: "not-used" },
    });
    for (let i = 0; i < 20; i += 1) {
      const enrolment = await prisma.enrolment.create({
        data: { learnerId: learner.id, courseId: ids.course, programmeId: ids.programme, status: "completed", completionSource: "assessment" },
      });
      enrolmentIds.push(enrolment.id);
    }
  });

  after(async () => {
    if (!prisma) return;
    await prisma.certificate.deleteMany({ where: { enrolmentId: { in: enrolmentIds } } }).catch(() => null);
    await prisma.enrolment.deleteMany({ where: { id: { in: enrolmentIds } } }).catch(() => null);
    const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }).catch(() => null);
    await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
    await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
    await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
    await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
    await prisma.$disconnect();
  });

  test("six parallel issuances for each of 20 enrolments produce one active certificate each", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    for (const enrolmentId of enrolmentIds) {
      const results = await Promise.all(Array.from({ length: 6 }, () => issueCertificateForEnrolment(enrolmentId)));
      const certificates = await prisma.certificate.findMany({ where: { enrolmentId } });
      assert.equal(certificates.length, 1, `exactly one certificate row for ${enrolmentId}`);
      assert.equal(certificates[0].status, "active");
      assert.equal(results.filter((r) => r.issued).length, 1, "exactly one caller observed the insert");
      assert.ok(results.some((r) => r.existing), "the losers re-read and returned the winner as existing");
      assert.ok(results.every((r) => !r.reason), "no unique-index violation surfaced to a caller");
    }
  });

  test("the database refuses a second active certificate for one enrolment", async (t) => {
    if (!prisma) return t.skip("database unavailable");
    const cert = await prisma.certificate.findFirst({ where: { enrolmentId: enrolmentIds[0], status: "active" } });
    await assert.rejects(
      () => prisma.$executeRaw`
        INSERT INTO dbo.certificates (id, learner_id, course_id, enrolment_id, issued_at, status, certificate_number)
        VALUES (N'r13-duplicate-cert', ${cert.learnerId}, ${cert.courseId}, ${cert.enrolmentId}, SYSUTCDATETIME(), N'active', N'r13-duplicate-number')`,
      /duplicate|UNIQUE/i,
      "the filtered unique index rejects a second active row",
    );
    assert.equal(await prisma.certificate.count({ where: { enrolmentId: enrolmentIds[0], status: "active" } }), 1);
  });
});

describe("Round 13 / 1.1.2 — migration cleans seeded duplicate certificates", () => {
  let pool;
  const suffix = `${process.pid}`;
  const certTable = `r13_certificates_${suffix}`;
  const auditTable = `r13_audits_${suffix}`;
  const notificationTable = `r13_notifications_${suffix}`;
  const recognitionTable = `r13_recognitions_${suffix}`;
  const indexName = `UX_r13_cert_one_active_${suffix}`;

  function config() {
    const url = process.env.DATABASE_URL;
    assert.ok(url, "DATABASE_URL is required");
    const noScheme = url.replace(/^sqlserver:\/\//, "");
    const [authority, ...rest] = noScheme.split(";");
    const options = Object.fromEntries(rest.filter((p) => p.includes("=")).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
    const [credentials, hostPort] = authority.includes("@")
      ? [authority.slice(0, authority.lastIndexOf("@")), authority.slice(authority.lastIndexOf("@") + 1)]
      : ["", authority || "localhost:1433"];
    const [user, password] = credentials.includes(":")
      ? [decodeURIComponent(credentials.slice(0, credentials.indexOf(":"))), decodeURIComponent(credentials.slice(credentials.indexOf(":") + 1))]
      : [options.user, options.password];
    const [server, port] = hostPort.split(":");
    const cfg = {
      server: server || "localhost", port: Number(port) || 1433, user, password,
      options: { encrypt: String(options.encrypt ?? "true").toLowerCase() === "true", trustServerCertificate: true, enableArithAbort: true },
    };
    const database = /database=([^;]+)/i.exec(url)?.[1];
    assert.ok(database, "DATABASE_URL needs a database= parameter");
    cfg.database = database;
    return cfg;
  }

  function scoped(sql) {
    return sql
      .replace(/UX_certificates_one_active_per_enrolment/g, indexName)
      .replace(/UX_notifications_one_per_user_dedupe_key/g, `UX_r13_notifications_${suffix}`)
      .replace(/UX_recognitions_one_per_user_dedupe_key/g, `UX_r13_recognitions_${suffix}`)
      .replace(/\bdbo\.certificates\b/g, `dbo.${certTable}`)
      .replace(/\bdbo\.audit_logs\b/g, `dbo.${auditTable}`)
      .replace(/\bdbo\.notifications\b/g, `dbo.${notificationTable}`)
      .replace(/\bdbo\.recognitions\b/g, `dbo.${recognitionTable}`);
  }

  before(async () => {
    if (!requireDatabase("round13-certificate-race.test.js")) return;
    const mssql = require(require.resolve("mssql", { paths: [path.join(here, "..", "..", "..", "artifacts", "api-server")] }));
    pool = await mssql.connect(config());
    await pool.request().batch(`
      CREATE TABLE dbo.${certTable} (
        id NVARCHAR(1000) NOT NULL PRIMARY KEY,
        learner_id NVARCHAR(1000) NOT NULL,
        course_id NVARCHAR(1000) NOT NULL,
        enrolment_id NVARCHAR(1000) NULL,
        issued_at DATETIME2 NOT NULL,
        status NVARCHAR(1000) NOT NULL,
        certificate_number NVARCHAR(64) NOT NULL UNIQUE
      );
      CREATE TABLE dbo.${auditTable} (
        id NVARCHAR(1000) NOT NULL PRIMARY KEY,
        user_id NVARCHAR(1000) NULL,
        action NVARCHAR(1000) NOT NULL,
        entity NVARCHAR(1000) NOT NULL,
        entity_id NVARCHAR(1000) NULL,
        timestamp DATETIME2 NOT NULL,
        details NVARCHAR(1000) NULL
      );
      CREATE TABLE dbo.${notificationTable} (id NVARCHAR(1000) NOT NULL PRIMARY KEY, user_id NVARCHAR(1000) NOT NULL);
      CREATE TABLE dbo.${recognitionTable} (id NVARCHAR(1000) NOT NULL PRIMARY KEY, user_id NVARCHAR(1000) NOT NULL);
      INSERT INTO dbo.${certTable} (id, learner_id, course_id, enrolment_id, issued_at, status, certificate_number) VALUES
        (N'c1', N'l1', N'k1', N'e1', '2026-01-01T00:00:00Z', N'active', N'n1'),
        (N'c2', N'l1', N'k1', N'e1', '2026-02-01T00:00:00Z', N'active', N'n2'),
        (N'c3', N'l1', N'k1', N'e1', '2026-03-01T00:00:00Z', N'active', N'n3'),
        (N'c4', N'l1', N'k1', N'e2', '2026-01-01T00:00:00Z', N'active', N'n4'),
        (N'c5', N'l1', N'k1', N'e2', '2026-02-01T00:00:00Z', N'revoked', N'n5');
    `);
  });

  after(async () => {
    if (!pool) return;
    for (const table of [notificationTable, recognitionTable, auditTable, certTable]) {
      await pool.request().batch(`IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL DROP TABLE dbo.${table};`).catch(() => {});
    }
    await pool.close().catch(() => {});
  });

  test("keeps the earliest active certificate, revokes duplicates, audits each, and blocks a new one", async (t) => {
    if (!pool) return t.skip("database unavailable");
    const sql = scoped(fs.readFileSync(MIGRATION, "utf8"));
    for (const batch of sql.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean)) {
      await pool.request().batch(batch);
    }
    const rows = (await pool.request().query(`SELECT id, enrolment_id, status FROM dbo.${certTable} ORDER BY id`)).recordset;
    assert.deepEqual(rows.map((r) => [r.id, r.status]), [
      ["c1", "active"], ["c2", "revoked"], ["c3", "revoked"], ["c4", "active"], ["c5", "revoked"],
    ], "the earliest active certificate survives in each group");
    const audits = (await pool.request().query(`SELECT action, entity, entity_id FROM dbo.${auditTable} ORDER BY entity_id`)).recordset;
    assert.equal(audits.length, 2, "one audit row per revoked duplicate");
    assert.deepEqual(audits.map((a) => a.entity_id), ["c2", "c3"]);
    assert.ok(audits.every((a) => a.action === "CERTIFICATE_DUPLICATE_REVOKED" && a.entity === "certificate"));
    const [index] = (await pool.request().query(`SELECT 1 AS present FROM sys.indexes WHERE name = N'${indexName}'`)).recordset;
    assert.ok(index, "the migration created the filtered unique index");
    await assert.rejects(
      () => pool.request().batch(`
        INSERT INTO dbo.${certTable} (id, learner_id, course_id, enrolment_id, issued_at, status, certificate_number)
        VALUES (N'c6', N'l1', N'k1', N'e1', SYSUTCDATETIME(), N'active', N'n6')`),
      /duplicate|UNIQUE/i,
    );
  });
});
