// ============================================================
// EnduroLab - Race Prediction Evidence Loader
// ============================================================
// Prefers canonical finish results while retaining unlinked Garmin
// race activities as clearly counted fallback evidence.

import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { raceResults, runActivities } from "@/lib/db/schema";
import type { RaceAnalysisActivity } from "@/lib/analytics/race-performance-analysis";

export interface LoadedRaceEvidence {
  races: RaceAnalysisActivity[];
  maximumSourceTimestamp: Date | null;
  sourceCoverage: {
    canonicalResults: number;
    verifiedResults: number;
    garminFallbacks: number;
    measuredPowerRaces: number;
    modeledPowerRaces: number;
  };
}

/** Loads the exact race evidence available before an as-of date. */
export async function loadRaceEvidence(userId: string, asOf: string): Promise<LoadedRaceEvidence> {
  const [activities, canonicalResults] = await Promise.all([
    db.select({
      id: runActivities.id,
      localDate: runActivities.localDate,
      distanceMeters: runActivities.distanceMeters,
      durationSeconds: runActivities.durationSeconds,
      movingDurationSeconds: runActivities.movingDurationSeconds,
      eventType: runActivities.eventType,
      averageHeartRate: runActivities.averageHeartRate,
      averagePower: runActivities.averagePower,
      calculatedPower: runActivities.calculatedPower,
      elevationGainMeters: runActivities.elevationGainMeters,
      excludedFromAnalytics: runActivities.excludedFromAnalytics,
      updatedAt: runActivities.updatedAt,
    })
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, userId),
        eq(runActivities.eventType, "race"),
        lt(runActivities.localDate, asOf),
      ))
      .orderBy(asc(runActivities.localDate), asc(runActivities.startTimeGmt)),
    db.select({
      id: raceResults.id,
      raceDate: raceResults.raceDate,
      officialDistanceMeters: raceResults.officialDistanceMeters,
      chipTimeSeconds: raceResults.chipTimeSeconds,
      gunTimeSeconds: raceResults.gunTimeSeconds,
      verificationStatus: raceResults.verificationStatus,
      linkedActivityId: raceResults.linkedActivityId,
      elevationGainMeters: raceResults.elevationGainMeters,
      updatedAt: raceResults.updatedAt,
      activityAverageHeartRate: runActivities.averageHeartRate,
      activityAveragePower: runActivities.averagePower,
      activityCalculatedPower: runActivities.calculatedPower,
    })
      .from(raceResults)
      .leftJoin(runActivities, eq(raceResults.linkedActivityId, runActivities.id))
      .where(and(
        eq(raceResults.userId, userId),
        eq(raceResults.status, "finish"),
        lt(raceResults.raceDate, asOf),
      ))
      .orderBy(asc(raceResults.raceDate)),
  ]);

  const usableResults = canonicalResults.filter((result) =>
    (result.chipTimeSeconds ?? result.gunTimeSeconds ?? 0) > 0,
  );
  const canonicalActivityIds = new Set(usableResults.flatMap((result) =>
    result.linkedActivityId ? [result.linkedActivityId] : [],
  ));
  const fallbackActivities = activities.filter((activity) => !canonicalActivityIds.has(activity.id));
  const canonicalActivities: RaceAnalysisActivity[] = usableResults.map((result) => ({
    id: result.id,
    localDate: result.raceDate,
    distanceMeters: result.officialDistanceMeters,
    durationSeconds: result.chipTimeSeconds ?? result.gunTimeSeconds as number,
    movingDurationSeconds: null,
    eventType: "race",
    averageHeartRate: result.activityAverageHeartRate,
    averagePower: result.activityAveragePower,
    calculatedPower: result.activityCalculatedPower,
    elevationGainMeters: result.elevationGainMeters,
    excludedFromAnalytics: false,
  }));
  const races = [...fallbackActivities, ...canonicalActivities]
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const sourceTimestamps = [
    ...fallbackActivities.map((activity) => activity.updatedAt),
    ...usableResults.map((result) => result.updatedAt),
  ];

  return {
    races,
    maximumSourceTimestamp: sourceTimestamps.length > 0
      ? new Date(Math.max(...sourceTimestamps.map((timestamp) => timestamp.getTime())))
      : null,
    sourceCoverage: {
      canonicalResults: usableResults.length,
      verifiedResults: usableResults.filter((result) => result.verificationStatus === "verified").length,
      garminFallbacks: fallbackActivities.length,
      measuredPowerRaces: races.filter((race) => race.averagePower !== null).length,
      modeledPowerRaces: races.filter((race) => race.averagePower === null && race.calculatedPower !== null).length,
    },
  };
}
