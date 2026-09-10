import { pgTable, text, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const assessments = pgTable("assessments", {
  id: text("id").primaryKey(),
  moduleId: text("module_id").notNull(),
  type: text("type").notNull().default("recall"),
  maxScore: numeric("max_score").notNull().default("100"),
});
export const insertAssessmentSchema = createInsertSchema(assessments);
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessments.$inferSelect;

