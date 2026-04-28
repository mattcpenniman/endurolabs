// ============================================================
// EnduroLab — Drizzle Schema
// ============================================================
// PostgreSQL schema for persisting marathon training plans.
// ============================================================

import {
  pgTable,
  uuid,
  jsonb,
  integer,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Runner profile snapshot at plan creation
  runnerProfile: jsonb("runner_profile").notNull(),
  // User-adjustable overrides
  peakMileageOverride: integer("peak_mileage_override"),
  weeksOverride: integer("weeks_override"),
  // Generated plan data
  planData: jsonb("plan_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  raceName: varchar("race_name", { length: 255 }),
});
