// ============================================================
// EnduroLab - Auto summary power calculation
// ============================================================
// Garmin power and calculated power are stored independently. This keeps
// provider sync authoritative while allowing every activity to have a
// consistent modeled fallback.
// ============================================================

import { and, eq, gt, isNotNull, notLike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import {
  fitSpeedPowerModel,
  MIN_VALID_MOVING_DURATION_RATIO,
} from "@/lib/analytics/modeled-power";

export interface SummarySpeedPowerModel {
  slope: number;
  intercept: number;
  activityCount: number;
}

/**
 * Fit the athlete-specific speed→power model from measured summaries.
 * Excludes previously estimated rows so a model never trains on its own
 * output. Returns null when there is not enough measured history to fit.
 */
export async function loadSummaryPowerModel(userId: string): Promise<SummarySpeedPowerModel | null> {
  const measured = await db
    .select({
      distanceMeters: runActivities.distanceMeters,
      durationSeconds: runActivities.durationSeconds,
      movingDurationSeconds: runActivities.movingDurationSeconds,
      averagePower: runActivities.averagePower,
      powerSource: runActivities.powerSource,
    })
    .from(runActivities)
    .where(and(
      eq(runActivities.userId, userId),
      eq(runActivities.source, "garmin"),
      isNotNull(runActivities.averagePower),
      notLike(runActivities.powerSource, "estimated_%"),
    ));

  return fitSpeedPowerModel(measured);
}

/**
 * Refresh calculated_power for every valid activity belonging to the user.
 * Uses the fitted speed→power model (speed = distance / moving duration,
 * falling back to total duration). The legacy estimated-power representation
 * is repaired at the same time by removing modeled values from average_power.
 */
export async function applyCalculatedSummaryPower(
  userId: string,
  model: SummarySpeedPowerModel,
): Promise<number> {
  const effectiveDuration = sql`case
    when moving_duration_seconds >= duration_seconds::double precision * ${MIN_VALID_MOVING_DURATION_RATIO}
      and moving_duration_seconds <= duration_seconds
      then moving_duration_seconds
    else duration_seconds
  end`;
  const calculation = sql`round((${model.intercept} + ${model.slope} * (distance_meters::double precision
    / greatest(${effectiveDuration}, 1))))::int`;
  const updated = await db
    .update(runActivities)
    .set({
      calculatedPower: calculation,
      averagePower: sql`case when ${runActivities.powerSource} like 'estimated_%' then null else ${runActivities.averagePower} end`,
      powerSource: sql`case when ${runActivities.powerSource} like 'estimated_%' then 'garmin' else ${runActivities.powerSource} end`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(runActivities.userId, userId),
      eq(runActivities.source, "garmin"),
      gt(runActivities.durationSeconds, 0),
      or(
        sql`${runActivities.calculatedPower} is distinct from ${calculation}`,
        sql`${runActivities.powerSource} like 'estimated_%'`,
      ),
    ))
    .returning({ id: runActivities.id });
  return updated.length;
}
