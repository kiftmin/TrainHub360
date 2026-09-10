import { pgTable, text, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const programmes = pgTable("programmes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("active"),
  learnerCount: numeric("learner_count").notNull().default("0"),
  courseCount: numeric("course_count").notNull().default("0"),
  progress: numeric("progress").notNull().default("0"),
  owner: text("owner").notNull(),
});

export const insertProgrammeSchema = createInsertSchema(programmes);
export type InsertProgramme = z.infer<typeof insertProgrammeSchema>;
export type Programme = typeof programmes.$inferSelect;
