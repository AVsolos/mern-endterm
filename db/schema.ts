import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  ownerId: text("owner_id").notNull(), joinCode: text("join_code").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});
export const members = sqliteTable("members", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull(), name: text("name").notNull(),
  joinedAt: integer("joined_at").notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] })]);
export const equipment = sqliteTable("equipment", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(), category: text("category").notNull(),
  assetTag: text("asset_tag").notNull(), location: text("location").notNull(),
  description: text("description").notNull(), status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("asset_tag_unique").on(t.workspaceId, t.assetTag),
  check("equipment_status", sql`${t.status} IN ('active', 'maintenance')`)]);
export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  equipmentId: text("equipment_id").notNull().references(() => equipment.id),
  userId: text("user_id").notNull(), borrowerName: text("borrower_name").notNull(),
  startsAt: integer("starts_at").notNull(), endsAt: integer("ends_at").notNull(),
  purpose: text("purpose").notNull(), status: text("status").notNull().default("reserved"),
  createdAt: integer("created_at").notNull(), checkedOutAt: integer("checked_out_at"),
  returnedAt: integer("returned_at"), returnNote: text("return_note"),
}, t => [index("booking_conflicts").on(t.equipmentId, t.status, t.startsAt, t.endsAt),
  index("workspace_bookings").on(t.workspaceId, t.createdAt),
  check("booking_interval", sql`${t.endsAt} > ${t.startsAt}`),
  check("booking_status", sql`${t.status} IN ('reserved', 'checked_out', 'returned', 'cancelled')`)]);
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  actorId: text("actor_id").notNull(), actorName: text("actor_name").notNull(),
  action: text("action").notNull(), resourceId: text("resource_id").notNull(),
  detail: text("detail").notNull(), createdAt: integer("created_at").notNull(),
}, t => [index("workspace_audit").on(t.workspaceId, t.createdAt)]);
