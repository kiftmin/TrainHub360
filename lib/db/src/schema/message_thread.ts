import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const messageThreads = pgTable("message_threads", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  context: text("context").notNull().default(""),
  participant: text("participant").notNull().default(""),
  programmeId: text("programme_id"),
  urgent: boolean("urgent").notNull().default(false),
  slaBreached: boolean("sla_breached").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  urgent: boolean("urgent").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMessageThreadSchema = createInsertSchema(messageThreads);
export type MessageThread = typeof messageThreads.$inferSelect;
export type Message = typeof messages.$inferSelect;

