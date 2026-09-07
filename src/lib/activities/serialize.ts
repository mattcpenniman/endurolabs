// ============================================================
// EnduroLab - Persisted Activity Serialization
// ============================================================

import type { RunActivity } from "@/lib/activities/models";
import { runActivities } from "@/lib/db/schema";

export function resolveSummaryPower(row: {
  averagePower: number | null;
  calculatedPower: number | null;
  powerSource: string;
}): {
  garminPower: number | null;
  calculatedPower: number | null;
  averagePower: number | null;
  averagePowerEstimated: boolean;
  displayPowerSource: string;
} {
  const legacyEstimate = row.powerSource.startsWith("estimated_");
  const garminPower = legacyEstimate ? null : row.averagePower;
  const calculatedPower = row.calculatedPower ?? (legacyEstimate ? row.averagePower : null);
  const averagePower = garminPower ?? calculatedPower;
  return {
    garminPower,
    calculatedPower,
    averagePower,
    averagePowerEstimated: garminPower === null && calculatedPower !== null,
    displayPowerSource: garminPower === null && calculatedPower !== null
      ? "estimated_speed_v1"
      : row.powerSource,
  };
}

/** Converts a persisted activity row into the shared client model. */
export function serializeRunActivity(row: typeof runActivities.$inferSelect): RunActivity {
  const distanceMiles = row.distanceMeters / 1609.344;
  const power = resolveSummaryPower(row);
  return {
    id: row.id,
    providerActivityId: row.providerActivityId,
    source: row.source,
    powerSource: power.displayPowerSource,
    activityName: row.activityName,
    activityType: row.activityType,
    eventType: row.eventType,
    localDate: row.localDate,
    startTimeLocal: row.startTimeLocal,
    startTimeGmt: row.startTimeGmt.toISOString(),
    distanceMiles: Math.round(distanceMiles * 100) / 100,
    durationSeconds: row.durationSeconds,
    movingDurationSeconds: row.movingDurationSeconds,
    averagePaceMinutesPerMile: distanceMiles > 0 ? row.durationSeconds / 60 / distanceMiles : null,
    elevationGainMeters: row.elevationGainMeters,
    averageHeartRate: row.averageHeartRate,
    maxHeartRate: row.maxHeartRate,
    averageCadence: row.averageCadence,
    garminPower: power.garminPower,
    calculatedPower: power.calculatedPower,
    averagePower: power.averagePower,
    averagePowerEstimated: power.averagePowerEstimated,
    calories: row.calories,
    deviceName: row.deviceName,
    planId: row.planId,
    weekNumber: row.weekNumber,
    dayOfWeek: row.dayOfWeek,
    plannedWorkoutId: row.plannedWorkoutId,
    matchConfidence: row.matchConfidence as RunActivity["matchConfidence"],
    qualityScore: row.qualityScore,
    excludedFromAnalytics: row.excludedFromAnalytics,
    predictionExcluded: row.predictionExcluded,
    raceClassification: row.raceClassification,
    raceNotes: row.raceNotes,
    sampleCount: row.sampleCount,
    samplesFetchedAt: row.samplesFetchedAt?.toISOString() ?? null,
    detailFetchStatus: row.detailFetchStatus,
    detailLastError: row.detailLastError,
    syncedAt: row.syncedAt.toISOString(),
  };
}
