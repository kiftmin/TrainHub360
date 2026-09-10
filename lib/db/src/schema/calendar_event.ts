import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const calendarEvents = pgTable("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  type: text("type").notNull().default("session"),
  accent: text("accent").notNull().default("blue"),
  location: text("location"),
  meetingLink: text("meeting_link"),
  userId: text("user_id"),
});
export const insertCalendarEventSchema = createInsertSchema(calendarEvents);
export type CalendarEvent = typeof calendarEvents.$inferSelect;

