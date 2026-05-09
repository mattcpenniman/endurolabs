// ============================================================
// EnduroLab — Drizzle Schema
// ============================================================
// PostgreSQL schema for app users, sessions, and persisted
// marathon training plans.
// ============================================================

import {
  pgTable,
  uuid,
  jsonb,
  integer,
  timestamp,
  varchar,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  // Runner profile snapshot at plan creation
  runnerProfile: jsonb("runner_profile").notNull(),
  // User-adjustable overrides
  peakMileageOverride: integer("peak_mileage_override"),
  weeksOverride: integer("weeks_override"),
  // Generated plan data
  planData: jsonb("plan_data").notNull(),
  shareToken: text("share_token"),
  sharedAt: timestamp("shared_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  archivedAt: timestamp("archived_at"),
  raceName: varchar("race_name", { length: 255 }),
}, (table) => [
  uniqueIndex("plans_share_token_unique").on(table.shareToken),
]);
