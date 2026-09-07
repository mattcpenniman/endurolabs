// ============================================================
// EnduroLab - Race Prediction Evidence Loader
// ============================================================
// Prefers canonical finish results while retaining unlinked Garmin
// race activities as clearly counted fallback evidence.

import { and, asc, eq, inArray, lt, lte, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { raceResults, runActivities } from "@/lib/db/schema";
import type { RaceAnalysisActivity } from "@/lib/analytics/race-performance-analysis";
import { isPredictionEligibleRaceResult } from "@/lib/races/results";

export interface LoadedRaceEvidence {
  races: RaceAnalysisActivity[];
  /** Non-race activities prior to the as-of date, used to drive the bounded
   *  readiness effects. Empty when includeTrainingActivities is unset. */
  trainingActivities: RaceAnalysisActivity[];
  maximumSourceTimestamp: Date | null;
  sourceCoverage: {
    canonicalResults: number;
    verifiedResults: number;
    garminFallbacks: number;
    measuredPowerRaces: number;
    modeledPowerRaces: number;
  };
}

export interface LoadRaceEvidenceOptions {
  /** Include races completed on the as-of date. Default false (strictly before).
   *  /race-predictor sets true so same-day completed races appear; backtests
   *  and snapshot issuance stay strictly before to remain leakage-safe. */
  includeSameDay?: boolean;
  /** When true, also return non-race activities (strictly before asOf) for
   *  the bounded readiness effects (volume, long-run, consistency). */
  includeTrainingActivities?: boolean;
}

const ACTIVITY_FIELDS = {
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
  predictionExcluded: runActivities.predictionExcluded,
  raceClassification: runActivities.raceClassification,
  updatedAt: runActivities.updatedAt,
} as const;

/** Loads the exact race evidence available before an as-of date. */
export async function loadRaceEvidence(
  userId: string,
  asOf: string,
  options: LoadRaceEvidenceOptions = {},
): Promise<LoadedRaceEvidence> {
  const sameDay = options.includeSameDay === true;
  const activityDateClause = sameDay ? lte(runActivities.localDate, asOf) : lt(runActivities.localDate, asOf);

  const [activities, allResults] = await Promise.all([
    db.select(ACTIVITY_FIELDS)
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, userId),
        eq(runActivities.eventType, "race"),
        activityDateClause,
      ))
      .orderBy(asc(runActivities.localDate), asc(runActivities.startTimeGmt)),
    db.select({
      id: raceResults.id,
      raceDate: raceResults.raceDate,
      officialDistanceMeters: raceResults.officialDistanceMeters,
      chipTimeSeconds: raceResults.chipTimeSeconds,
      gunTimeSeconds: raceResults.gunTimeSeconds,
      verificationStatus: raceResults.verificationStatus,
      status: raceResults.status,
      classification: raceResults.classification,
      predictionExcluded: raceResults.predictionExcluded,
      linkedActivityId: raceResults.linkedActivityId,
      elevationGainMeters: raceResults.elevationGainMeters,
      updatedAt: raceResults.updatedAt,
      activityAverageHeartRate: runActivities.averageHeartRate,
      activityAveragePower: runActivities.averagePower,
      activityCalculatedPower: runActivities.calculatedPower,
    })
      .from(raceResults)
      .leftJoin(runActivities, eq(raceResults.linkedActivityId, runActivities.id))
      .where(eq(raceResults.userId, userId))
      .orderBy(asc(raceResults.raceDate)),
  ]);

  const canonicalResults = allResults.filter((row) => (
    sameDay ? row.raceDate <= asOf : row.raceDate < asOf
  ));

  let trainingActivities: RaceAnalysisActivity[] = [];
  if (options.includeTrainingActivities === true) {
    const trainingRows = await db.select({
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
    })
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, userId),
        notInArray(runActivities.eventType, ["race"]),
        lt(runActivities.localDate, asOf),
      ))
      .orderBy(asc(runActivities.localDate), asc(runActivities.startTimeGmt));
    trainingActivities = trainingRows as RaceAnalysisActivity[];
  }

  const usableResults = canonicalResults.filter(isPredictionEligibleRaceResult);
  const canonicalActivityIds = new Set(canonicalResults.flatMap((result) =>
    result.linkedActivityId ? [result.linkedActivityId] : [],
  ));
  const fallbackActivities = activities.filter((activity) => (
    !canonicalActivityIds.has(activity.id)
    && !activity.excludedFromAnalytics
    && !activity.predictionExcluded
    && (activity.raceClassification === null || activity.raceClassification === "official")
  ));
  const labeledFallbackActivities: RaceAnalysisActivity[] = fallbackActivities.map((activity) => ({
    ...activity,
    resultSource: "garmin",
    verificationStatus: null,
  }));
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
    resultSource: "canonical",
    verificationStatus: result.verificationStatus as RaceAnalysisActivity["verificationStatus"],
  }));
  const races = [...labeledFallbackActivities, ...canonicalActivities]
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const sourceTimestamps = [
    ...activities.map((activity) => activity.updatedAt),
    ...canonicalResults.map((result) => result.updatedAt),
  ];

  return {
    races,
    trainingActivities,
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
