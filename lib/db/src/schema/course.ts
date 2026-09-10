import { pgTable, text, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  programmeId: text("programme_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("General"),
  progress: numeric("progress").notNull().default("0"),
  status: text("status").notNull().default("draft"),
  appliedThreshold: numeric("applied_threshold").notNull().default("70"),
  dueDate: text("due_date"),
  trainer: text("trainer").notNull().default(""),
  duration: text("duration"),
});
export const insertCourseSchema = createInsertSchema(courses);
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;
