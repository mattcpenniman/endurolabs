// ============================================================
// EnduroLab - Auto summary power estimate (races lacking sensor power)
// ============================================================
// Reuses the athlete's measured speed/power summary model to fill
// average_power only where the stored value is still null. The update is
// guarded by `average_power is null`, so it is idempotent and can never
// replace a measured summary or a previously-estimate row.
// ============================================================

import { and, eq, gt, isNotNull, isNull, notLike, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import { fitSpeedPowerModel } from "@/lib/analytics/modeled-power";

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
 * Fill average_power for the user's race activities that still have none.
 * Uses the fitted speed→power model (speed = distance / moving duration,
 * falling back to total duration) and tags the values
 * `estimated_speed_v1`. Only rows where `average_power is null` are
 * touched, so measured summaries and earlier estimates are preserved and
 * repeated syncs are safe.
 */
export async function applyRaceSummaryPowerEstimate(
  userId: string,
  model: SummarySpeedPowerModel,
): Promise<number> {
  const updated = await db
    .update(runActivities)
    .set({
      averagePower: sql`round((${model.intercept} + ${model.slope} * (distance_meters::double precision
        / greatest(coalesce(moving_duration_seconds, duration_seconds), 1))))::int`,
      powerSource: "estimated_speed_v1",
      updatedAt: new Date(),
    })
    .where(and(
      eq(runActivities.userId, userId),
      eq(runActivities.source, "garmin"),
      eq(runActivities.eventType, "race"),
      isNull(runActivities.averagePower),
      gt(runActivities.durationSeconds, 0),
    ));
  return updated[2] as unknown as number ?? 0;
}
