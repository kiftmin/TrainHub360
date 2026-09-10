import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const bookings = pgTable("bookings", {
  id: text("id").primaryKey(),
  trainer: text("trainer").notNull(),
  course: text("course").notNull().default(""),
  date: text("date").notNull(),
  time: text("time").notNull(),
  duration: text("duration").notNull().default("30m"),
  status: text("status").notNull().default("confirmed"),
  meetingLink: text("meeting_link"),
});
export const insertBookingSchema = createInsertSchema(bookings);
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookings.$inferSelect;

