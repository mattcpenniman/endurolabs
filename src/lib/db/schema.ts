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
  activeJobId: uuid("active_job_id"),
  activeWorkerToken: varchar("active_worker_token", { length: 64 }),
  activeJobLeaseExpiresAt: timestamp("active_job_lease_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("garmin_connections_user_unique").on(table.userId),
]);

export const garminSyncJobs = pgTable("garmin_sync_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => garminConnections.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  parameters: jsonb("parameters").notNull(),
  cursor: jsonb("cursor"),
  totalItems: integer("total_items"),
  processedItems: integer("processed_items").default(0).notNull(),
  succeededItems: integer("succeeded_items").default(0).notNull(),
  emptyItems: integer("empty_items").default(0).notNull(),
  failedItems: integer("failed_items").default(0).notNull(),
  sampleCount: integer("sample_count").default(0).notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  lastError: text("last_error"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("garmin_sync_jobs_user_status_idx").on(table.userId, table.status, table.createdAt),
  index("garmin_sync_jobs_connection_idx").on(table.connectionId, table.createdAt),
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
  eventType: varchar("event_type", { length: 32 }),
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
  calculatedPower: integer("calculated_power"),
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
  detailFetchStatus: varchar("detail_fetch_status", { length: 32 }),
  detailAttemptCount: integer("detail_attempt_count").default(0).notNull(),
  detailLastAttemptAt: timestamp("detail_last_attempt_at"),
  detailLastError: text("detail_last_error"),
  detailNextRetryAt: timestamp("detail_next_retry_at"),
  shareToken: text("share_token"),
  sharedAt: timestamp("shared_at"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("run_activities_provider_unique").on(table.userId, table.source, table.providerActivityId),
  index("run_activities_user_date_idx").on(table.userId, table.localDate),
  index("run_activities_plan_idx").on(table.planId),
  index("run_activities_detail_queue_idx").on(table.userId, table.source, table.detailFetchStatus, table.startTimeGmt),
  uniqueIndex("run_activities_share_token_unique").on(table.shareToken),
]);

export const raceResults = pgTable("race_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  linkedActivityId: uuid("linked_activity_id")
    .references(() => runActivities.id, { onDelete: "set null" }),
  raceName: varchar("race_name", { length: 255 }).notNull(),
  raceDate: varchar("race_date", { length: 10 }).notNull(),
  officialDistanceMeters: doublePrecision("official_distance_meters").notNull(),
  chipTimeSeconds: integer("chip_time_seconds"),
  gunTimeSeconds: integer("gun_time_seconds"),
  status: varchar("status", { length: 16 }).notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  verificationStatus: varchar("verification_status", { length: 32 }).notNull(),
  courseId: varchar("course_id", { length: 255 }),
  elevationGainMeters: integer("elevation_gain_meters"),
  surface: varchar("surface", { length: 32 }),
  temperatureCelsius: doublePrecision("temperature_celsius"),
  dewPointCelsius: doublePrecision("dew_point_celsius"),
  windSpeedMetersPerSecond: doublePrecision("wind_speed_meters_per_second"),
  precipitationMillimeters: doublePrecision("precipitation_millimeters"),
  placing: integer("placing"),
  ageGroupPlacing: integer("age_group_placing"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("race_results_linked_activity_unique").on(table.linkedActivityId),
  index("race_results_user_date_idx").on(table.userId, table.raceDate),
]);

export const racePredictionSnapshots = pgTable("race_prediction_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
  targetRaceResultId: uuid("target_race_result_id")
    .references(() => raceResults.id, { onDelete: "set null" }),
  targetDate: varchar("target_date", { length: 10 }).notNull(),
  targetDistanceMeters: doublePrecision("target_distance_meters").notNull(),
  targetRaceName: varchar("target_race_name", { length: 255 }),
  predictionAt: timestamp("prediction_at").notNull(),
  forecastHorizonDays: integer("forecast_horizon_days").notNull(),
  predictedSeconds: integer("predicted_seconds").notNull(),
  range50LowerSeconds: integer("range_50_lower_seconds"),
  range50UpperSeconds: integer("range_50_upper_seconds"),
  range90LowerSeconds: integer("range_90_lower_seconds"),
  range90UpperSeconds: integer("range_90_upper_seconds"),
  goalSeconds: integer("goal_seconds"),
  goalProbability: doublePrecision("goal_probability"),
  modelVersion: varchar("model_version", { length: 64 }).notNull(),
  featureVersion: varchar("feature_version", { length: 64 }).notNull(),
  features: jsonb("features").notNull(),
  evidence: jsonb("evidence").notNull(),
  drivers: jsonb("drivers").notNull(),
  prediction: jsonb("prediction").notNull(),
  maximumSourceTimestamp: timestamp("maximum_source_timestamp"),
  sensorCoverage: jsonb("sensor_coverage").notNull(),
  dataConfidence: varchar("data_confidence", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("race_prediction_snapshots_user_prediction_idx").on(table.userId, table.predictionAt),
  index("race_prediction_snapshots_plan_idx").on(table.planId),
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
  mergedActivityId: uuid("merged_activity_id").references(() => runActivities.id, { onDelete: "set null" }),
  mergedAt: timestamp("merged_at"),
  garminDistance: integer("garmin_distance_hundredths"),
  garminVariance: integer("garmin_variance_hundredths"),
  garminValidationStatus: varchar("garmin_validation_status", { length: 16 }),
  loggedAt: timestamp("logged_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("plan_run_logs_unique_run").on(table.planId, table.weekNumber, table.dayOfWeek, table.runId),
  uniqueIndex("plan_run_logs_merged_activity_unique").on(table.mergedActivityId),
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

export const activityAnalytics = pgTable("activity_analytics", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .notNull()
    .references(() => runActivities.id, { onDelete: "cascade" }),
  algorithmVersion: varchar("algorithm_version", { length: 32 }).notNull(),
  sourceSampleCount: integer("source_sample_count").notNull(),
  sourceSamplesFetchedAt: timestamp("source_samples_fetched_at"),
  metrics: jsonb("metrics").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("activity_analytics_activity_version_unique").on(table.activityId, table.algorithmVersion),
  index("activity_analytics_activity_idx").on(table.activityId),
]);

export const activityMetricWindows = pgTable("activity_metric_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityAnalyticsId: uuid("activity_analytics_id")
    .notNull()
    .references(() => activityAnalytics.id, { onDelete: "cascade" }),
  windowStartSeconds: integer("window_start_seconds").notNull(),
  sampleCount: integer("sample_count").notNull(),
  heartRateAverage: doublePrecision("heart_rate_average"),
  powerAverage: doublePrecision("power_average"),
  speedAverage: doublePrecision("speed_average"),
  elevationAverage: doublePrecision("elevation_average"),
  cadenceMedian: doublePrecision("cadence_median"),
  latitudeAverage: doublePrecision("latitude_average"),
  longitudeAverage: doublePrecision("longitude_average"),
  fitnessHeartRate: doublePrecision("fitness_heart_rate"),
  fitnessPower: doublePrecision("fitness_power"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("activity_metric_windows_analytics_start_unique").on(table.activityAnalyticsId, table.windowStartSeconds),
  index("activity_metric_windows_analytics_idx").on(table.activityAnalyticsId),
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
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("fitness_snapshots_cache_key_unique").on(
    table.userId,
    table.windowStart,
    table.windowEnd,
    table.powerSource,
    table.algorithmVersion,
  ),
  index("fitness_snapshots_user_window_idx").on(table.userId, table.windowEnd),
]);
