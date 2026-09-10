import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
export const roles = pgTable("roles", { id: text("id").primaryKey(), name: text("name").notNull().unique() });
export const permissions = pgTable("permissions", { id: text("id").primaryKey(), name: text("name").notNull().unique() });
export const userRoles = pgTable("user_roles", { userId: text("user_id").notNull(), roleId: text("role_id").notNull(), programmeId: text("programme_id") });
export const rolePermissions = pgTable("role_permissions", { roleId: text("role_id").notNull(), permissionId: text("permission_id").notNull() });
export const insertRoleSchema = createInsertSchema(roles);
export type Role = typeof roles.$inferSelect;

