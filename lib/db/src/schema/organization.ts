import { pgTable, text, boolean, numeric, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("standard"),
  learnerCount: numeric("learner_count").notNull().default("0"),
  programmeCount: numeric("programme_count").notNull().default("0"),
  reviewCreditModuleEnabled: boolean("review_credit_module_enabled").notNull().default(false),
  reviewCreditMaxWeighting: numeric("review_credit_max_weighting").notNull().default("10"),
  reviewCreditPeriodStart: date("review_credit_period_start"),
  reviewCreditPeriodEnd: date("review_credit_period_end"),
  reviewCreditWeightAssessment: numeric("review_credit_weight_assessment").notNull().default("50"),
  reviewCreditWeightTimeliness: numeric("review_credit_weight_timeliness").notNull().default("30"),
  reviewCreditWeightApplication: numeric("review_credit_weight_application").notNull().default("20"),
  reviewCreditEligibleProgrammeTypes: jsonb("review_credit_eligible_programme_types").$type<string[]>().notNull().default([]),
  reviewCreditRequireManagerSignoff: boolean("review_credit_require_manager_signoff").notNull().default(true),
  reviewCreditCollectApplicationScores: boolean("review_credit_collect_application_scores").notNull().default(true),
});

export const insertOrganizationSchema = createInsertSchema(organizations);
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
