import { pgTable, text, numeric, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
export const kpiSummaries = pgTable("kpi_summaries", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});
export const reviewCreditSettings = pgTable("review_credit_settings", {
  orgId: text("org_id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  maxWeighting: numeric("max_weighting").notNull().default("10"),
  assessmentWeight: numeric("assessment_weight").notNull().default("50"),
  timelinessWeight: numeric("timeliness_weight").notNull().default("30"),
  applicationWeight: numeric("application_weight").notNull().default("20"),
});

