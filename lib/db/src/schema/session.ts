import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  programme: text("programme").notNull().default(""),
  date: text("date").notNull(),
  time: text("time").notNull(),
  mode: text("mode").notNull().default("online"),
  attendees: integer("attendees").notNull().default(0),
  status: text("status").notNull().default("scheduled"),
});
export const insertSessionSchema = createInsertSchema(sessions);
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

