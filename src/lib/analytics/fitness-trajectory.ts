// ============================================================
// EnduroLab - Power @ 140 Observations for Race Fitness Effect
// ============================================================
// Loads sample HR/speed/power per running activity before an as-of
// date, applies the athlete-specific speed-to-power model (already
// fit on measured summaries) to activities missing measured power,
// and returns the per-activity Power @ 140 observation. The model
// and its coefficients are unchanged from the existing power-hr
// pipeline. Only activities that produce a non-null, non-
// extrapolated Power @ 140 estimate contribute to the trajectory.

import { and, asc, desc, eq, inArray, isNull, isNotNull, like, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { ActivitySampleInput } from "@/lib/analytics/models";
import { fitSpeedPowerModel, type PowerActivitySummary } from "@/lib/analytics/modeled-power";
import { analyzePowerAtHeartRate } from "@/lib/analytics/running-fitness";
import type { RaceFitnessObservation } from "@/lib/analytics/race-performance-analysis";

export const FITNESS_TRAJECTORY_VERSION = "pace-hr-v1";

interface MeasuredActivityRow {
  id: string;
  localDate: string;
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  averagePower: number;
  powerSource: string;
}

interface SampleActivityRow {
  id: string;
  localDate: string;
  averagePower: number | null;
  powerSource: string;
}

/**
 * Loads per-activity Power @ 140 observations up to `asOf` for the given
 * user. Activities with measured sensor power are labeled `measured: true`;
 * activities without one (that still have a usable HR/speed trace and a
 * valid speed-to-power summary model) are populated with modeled power in
 * memory and labeled `measured: false`. Neither value is persisted as
 * sample power.
 */
export async function loadPower140Observations(
  userId: string,
  asOf: string,
): Promise<RaceFitnessObservation[]> {
  const eligibleActivities = await db.select({
    id: runActivities.id,
    localDate: runActivities.localDate,
    distanceMeters: runActivities.distanceMeters,
    durationSeconds: runActivities.durationSeconds,
    movingDurationSeconds: runActivities.movingDurationSeconds,
    averagePower: runActivities.averagePower,
    powerSource: runActivities.powerSource,
    qualityScore: runActivities.qualityScore,
    excludedFromAnalytics: runActivities.excludedFromAnalytics,
  }).from(runActivities).where(and(
    eq(runActivities.userId, userId),
    lt(runActivities.localDate, asOf),
    eq(runActivities.excludedFromAnalytics, false),
    or(isNotNull(runActivities.averagePower), isNotNull(runActivities.calculatedPower)),
  )).orderBy(desc(runActivities.localDate));

  const measuredRows = eligibleActivities.filter((row) => row.averagePower !== null);
  const model = fitSpeedPowerModel(measuredRows as PowerActivitySummary[]);
  if (!model) return [];

  const activityIds = eligibleActivities.map((row) => row.id);
  const samplesForActivity = new Map<string, ActivitySampleInput[]>();
  if (activityIds.length > 0) {
    const rows = await db.select({
      activityId: activitySamples.activityId,
      elapsedSeconds: activitySamples.elapsedSeconds,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
    }).from(activitySamples)
      .where(inArray(activitySamples.activityId, activityIds))
      .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds));
    for (const row of rows) {
      const list = samplesForActivity.get(row.activityId) ?? [];
      list.push({
        activityId: row.activityId,
        elapsedSeconds: row.elapsedSeconds,
        heartRate: row.heartRate,
        power: row.power,
        speedMetersPerSecond: row.speedMetersPerSecond,
      });
      samplesForActivity.set(row.activityId, list);
    }
  }

  const observations: RaceFitnessObservation[] = [];
  for (const activity of eligibleActivities) {
    const samples = samplesForActivity.get(activity.id) ?? [];
    if (samples.length < 20) continue;
    const allHaveMeasuredPower = samples.every((sample) => sample.power !== null && sample.power > 0);
    const effectiveSamples = activity.averagePower !== null
      ? samples
      : samples.map((sample) => sample.speedMetersPerSecond === null
          ? sample
          : { ...sample, power: model.intercept + model.slope * sample.speedMetersPerSecond });
    const modelResult = analyzePowerAtHeartRate(effectiveSamples, [140]);
    if (!modelResult) continue;
    const estimate = modelResult.estimates.find((e) => e.heartRate === 140);
    if (!estimate || estimate.extrapolated) continue;
    observations.push({
      date: activity.localDate,
      watts: Math.round(estimate.watts),
      measured: allHaveMeasuredPower,
    });
  }
  return observations.sort((a, b) => a.date.localeCompare(b.date));
}
