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
  boolean,
  doublePrecision,
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
  source: varchar("source", { length: 32 }).default("garmin").notNull(),
  powerSource: varchar("power_source", { length: 32 }).default("garmin").notNull(),
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
  qualityScore: integer("quality_score"),
  excludedFromAnalytics: boolean("excluded_from_analytics").default(false).notNull(),
  sampleCount: integer("sample_count").default(0).notNull(),
  samplesFetchedAt: timestamp("samples_fetched_at"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("run_activities_provider_unique").on(table.userId, table.providerActivityId),
  index("run_activities_user_date_idx").on(table.userId, table.localDate),
  index("run_activities_plan_idx").on(table.planId),
]);

export const activitySamples = pgTable("activity_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .notNull()
    .references(() => runActivities.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").notNull(),
  elapsedSeconds: integer("elapsed_seconds").notNull(),
  distanceMeters: doublePrecision("distance_meters"),
  heartRate: integer("heart_rate"),
  power: integer("power"),
  speedMetersPerSecond: doublePrecision("speed_meters_per_second"),
  elevationMeters: doublePrecision("elevation_meters"),
  grade: doublePrecision("grade"),
  cadence: integer("cadence"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  temperatureCelsius: doublePrecision("temperature_celsius"),
}, (table) => [
  uniqueIndex("activity_samples_activity_elapsed_unique").on(table.activityId, table.elapsedSeconds),
  index("activity_samples_activity_idx").on(table.activityId),
]);

export const weightMeasurements = pgTable("weight_measurements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  measuredAt: timestamp("measured_at").notNull(),
  weightKg: doublePrecision("weight_kg").notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("weight_measurements_user_date_idx").on(table.userId, table.measuredAt),
]);

export const fitnessSnapshots = pgTable("fitness_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  powerSource: varchar("power_source", { length: 32 }).notNull(),
  algorithmVersion: varchar("algorithm_version", { length: 32 }).notNull(),
  metrics: jsonb("metrics").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("fitness_snapshots_user_window_idx").on(table.userId, table.windowEnd),
]);
