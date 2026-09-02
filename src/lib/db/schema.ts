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
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash").notNull(),
  currentPlanId: uuid("current_plan_id"),
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

export const planRunLogs = pgTable("plan_run_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  weekNumber: integer("week_number").notNull(),
  date: varchar("date", { length: 32 }).notNull(),
  dayOfWeek: varchar("day_of_week", { length: 16 }).notNull(),
  runId: varchar("run_id", { length: 255 }).notNull(),
  plannedWorkoutId: varchar("planned_workout_id", { length: 255 }),
  runTitle: varchar("run_title", { length: 255 }),
  isAdditionalRun: integer("is_additional_run").default(0).notNull(),
  actualMileage: integer("actual_mileage_hundredths").notNull(),
  completed: integer("completed").default(1).notNull(),
  feelRating: integer("feel_rating").notNull(),
  notes: text("notes").default("").notNull(),
  loggedAt: timestamp("logged_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("plan_run_logs_unique_run").on(table.planId, table.weekNumber, table.dayOfWeek, table.runId),
]);

export const garminConnections = pgTable("garmin_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  garminUsername: varchar("garmin_username", { length: 255 }).notNull(),
  garminDisplayName: varchar("garmin_display_name", { length: 255 }),
  encryptedTokens: text("encrypted_tokens").notNull(),
  status: varchar("status", { length: 32 }).default("connected").notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("garmin_connections_user_unique").on(table.userId),
]);

export const runActivities = pgTable("run_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerActivityId: varchar("provider_activity_id", { length: 64 }).notNull(),
  activityName: varchar("activity_name", { length: 255 }).notNull(),
  activityType: varchar("activity_type", { length: 64 }).notNull(),
  localDate: varchar("local_date", { length: 10 }).notNull(),
  startTimeLocal: varchar("start_time_local", { length: 32 }).notNull(),
  startTimeGmt: timestamp("start_time_gmt").notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  movingDurationSeconds: integer("moving_duration_seconds"),
  elevationGainMeters: integer("elevation_gain_meters"),
  averageHeartRate: integer("average_heart_rate"),
  maxHeartRate: integer("max_heart_rate"),
  averageCadence: integer("average_cadence"),
  averagePower: integer("average_power"),
  calories: integer("calories"),
  deviceName: varchar("device_name", { length: 255 }),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
  weekNumber: integer("week_number"),
  dayOfWeek: varchar("day_of_week", { length: 16 }),
  plannedWorkoutId: varchar("planned_workout_id", { length: 255 }),
  matchConfidence: varchar("match_confidence", { length: 16 }),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("run_activities_provider_unique").on(table.userId, table.providerActivityId),
  index("run_activities_user_date_idx").on(table.userId, table.localDate),
  index("run_activities_plan_idx").on(table.planId),
]);
