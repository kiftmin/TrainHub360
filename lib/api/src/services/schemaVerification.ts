import { db } from "../db.js";

export interface SchemaObjectCheck {
  label: string;
  sql: string;
}

type SchemaQuery = (sql: string) => Promise<Array<{ present: number | bigint }>>;

const objectId = (table: string) => `OBJECT_ID(N'dbo.${table}', N'U')`;

const column = (table: string, name: string): SchemaObjectCheck => ({
  label: `column dbo.${table}.${name}`,
  sql: `SELECT 1 AS present FROM sys.columns WHERE object_id = ${objectId(table)} AND name = N'${name}'`,
});

const index = (table: string, name: string): SchemaObjectCheck => ({
  label: `index ${name} on dbo.${table}`,
  sql: `SELECT 1 AS present FROM sys.indexes WHERE object_id = ${objectId(table)} AND name = N'${name}'`,
});

const foreignKey = (table: string, name: string): SchemaObjectCheck => ({
  label: `foreign key ${name} on dbo.${table}`,
  sql: `SELECT 1 AS present FROM sys.foreign_keys WHERE parent_object_id = ${objectId(table)} AND name = N'${name}'`,
});

const key = (table: string, name: string, type: string): SchemaObjectCheck => ({
  label: `${type === "PK" ? "primary key" : "unique key"} ${name} on dbo.${table}`,
  sql: `SELECT 1 AS present FROM sys.key_constraints kc
        JOIN sys.tables t ON t.object_id = kc.parent_object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = N'dbo' AND t.name = N'${table}' AND kc.type = N'${type}' AND kc.name = N'${name}'`,
});

const table = (name: string): SchemaObjectCheck => ({
  label: `table dbo.${name}`,
  sql: `SELECT 1 AS present FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = N'dbo' AND t.name = N'${name}'`,
});

const view = (name: string): SchemaObjectCheck => ({
  label: `view dbo.${name}`,
  sql: `SELECT 1 AS present FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id WHERE s.name = N'dbo' AND v.name = N'${name}'`,
});

export const schemaObjectChecks: SchemaObjectCheck[] = [
  column("notifications", "dedupe_key"),
  column("recognitions", "dedupe_key"),
  index("certificates", "UX_certificates_one_active_per_enrolment"),
  index("notifications", "UX_notifications_one_per_user_dedupe_key"),
  index("recognitions", "UX_recognitions_one_per_user_dedupe_key"),
  column("evaluation_jobs", "heartbeat_at"),
  column("evaluation_jobs", "attempts"),
  index("evaluation_jobs", "IX_evaluation_jobs_status_heartbeat_at"),
  index("evaluation_jobs", "UX_evaluation_jobs_one_pending_per_course"),
  column("message_threads", "course_id"),
  foreignKey("message_threads", "FK_message_threads_course"),
  index("message_threads", "IX_message_threads_scope"),
  table("message_templates"),
  foreignKey("message_templates", "FK_message_templates_organization"),
  index("message_templates", "IX_message_templates_org_active"),
  key("user_roles", "user_roles_pkey", "PK"),
  index("user_roles", "UX_user_roles_one_grant_per_programme"),
  index("user_roles", "UX_user_roles_one_org_wide_grant"),
  index("user_roles", "user_roles_programme_id_idx"),
  column("session_rsvps", "removed_by"),
  column("session_rsvps", "removed_at"),
  column("session_rsvps", "removal_reason"),
  view("v_feature53_booking_migration_review"),
];

export async function findMissingSchemaObjects(query: SchemaQuery): Promise<string[]> {
  const missing: string[] = [];
  for (const check of schemaObjectChecks) {
    const rows = await query(check.sql).catch(() => [] as Array<{ present: number | bigint }>);
    if (!rows.length || Number(rows[0].present) !== 1) missing.push(check.label);
  }
  return missing;
}

export async function verifySchema(): Promise<string[]> {
  return findMissingSchemaObjects((sql) => db.$queryRawUnsafe<Array<{ present: number | bigint }>>(sql));
}

export async function assertProductionSchema(
  environment: string | undefined = process.env.NODE_ENV,
  verifier: () => Promise<string[]> = verifySchema,
): Promise<void> {
  if (environment !== "production") return;
  const missing = await verifier();
  if (missing.length) throw new Error(`[api] production schema check failed; missing ${missing.join("; ")}`);
}
