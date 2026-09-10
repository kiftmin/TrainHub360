import { pgTable, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const enrolments = pgTable("enrolments", {
  id: text("id").primaryKey(),
  learnerId: text("learner_id").notNull(),
  courseId: text("course_id").notNull(),
  programmeId: text("programme_id").notNull(),
  status: text("status").notNull().default("enrolled"),
  reviewCreditEligible: boolean("review_credit_eligible").notNull().default(true),
  appliedAssessmentScore: numeric("applied_assessment_score"),
  completionDate: timestamp("completion_date"),
  deadlineDate: timestamp("deadline_date"),
  timelinessScore: numeric("timeliness_score"),
  applicationScore: numeric("application_score"),
  applicationScoreSubmittedBy: text("application_score_submitted_by"),
  applicationScoreSubmittedAt: timestamp("application_score_submitted_at"),
  enrolmentScore: numeric("enrolment_score"),
  reviewCreditExcluded: boolean("review_credit_excluded").notNull().default(false),
  reviewCreditExcludeReason: text("review_credit_exclude_reason"),
  reviewCreditLockedAt: timestamp("review_credit_locked_at"),
  managerSignOff: boolean("manager_sign_off"),
  managerSignOffBy: text("manager_sign_off_by"),
  managerSignOffAt: timestamp("manager_sign_off_at"),
});
export const insertEnrolmentSchema = createInsertSchema(enrolments);
export type InsertEnrolment = z.infer<typeof insertEnrolmentSchema>;
export type Enrolment = typeof enrolments.$inferSelect;

