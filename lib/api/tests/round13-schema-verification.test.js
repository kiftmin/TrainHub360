import "./support/loadEnv.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { findMissingSchemaObjects, schemaObjectChecks, verifySchema, assertProductionSchema } from "../dist/services/schemaVerification.js";

describe("Round 13 phase 5 — schema verification", () => {
  test("passes on a database with every migration-only object", async (t) => {
    if (!process.env.DATABASE_URL) return t.skip("database not configured");
    assert.deepEqual(await verifySchema(), []);
  });

  test("names the object that is missing", async () => {
    const target = schemaObjectChecks.find((check) => check.label.includes("UX_certificates_one_active_per_enrolment"));
    assert.ok(target);
    const missing = await findMissingSchemaObjects(async (sql) => (sql === target.sql ? [] : [{ present: 1 }]));
    assert.deepEqual(missing, [target.label]);
  });

  test("the startup guard only runs in production and refuses when objects are missing", async () => {
    await assertProductionSchema("test", async () => {
      throw new Error("verifier should not run outside production");
    });
    await assert.rejects(
      () => assertProductionSchema("production", async () => ["index UX_evaluation_jobs_one_pending_per_course on dbo.evaluation_jobs"]),
      /UX_evaluation_jobs_one_pending_per_course/,
    );
  });
});
