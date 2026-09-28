// ============================================================
// EnduroLab — Race Analysis Data Loader
// ============================================================
// Loads the persisted inputs the pure race-analysis functions
// need: activities, canonical results, race-execution quality,
// plans, run logs, and — optionally — per-activity time at
// effort computed from stored samples with the activity's plan
// zones. All reads are bounded by the as-of date.

import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activityAnalytics,
  activitySamples,
  planRunLogs,
  plans,
  raceResults,
  runActivities,
  users,
} from "@/lib/db/schema";
import { isPredictionEligibleRaceResult } from "@/lib/races/results";
import {
  RACE_EXECUTION_VERSION,
  parseExecutionQuality,
  type RaceExecutionQuality,
} from "@/lib/analytics/race-execution";
import { summarizeTimeAtEffort } from "@/lib/analytics/time-at-effort";
import type { ActivityChartSample } from "@/lib/activities/models";
import type {
  RaceAnalysisActivity,
  RaceAnalysisLog,
  RaceAnalysisPlan,
  RaceAnalysisPlanRun,
} from "@/lib/analytics/race-performance-analysis";
import type { MarathonPlan, RunnerProfile, Workout } from "@/lib/training/models";

const DISTANCE_METERS: Record<string, number> = {
  marathon: 42_195,
  half_marathon: 21_097.5,
  "10k": 10_000,
  "5k": 5_000,
};
const SAMPLE_BATCH_SIZE = 25;

export interface RaceAnalysisUser {
  id: string;
  email: string;
}

export interface RaceAnalysisDataset {
  activities: RaceAnalysisActivity[];
  plans: RaceAnalysisPlan[];
  /** Count of activities that received a time-at-effort breakdown. */
  timeAtEffortActivities: number;
}

export interface LoadRaceAnalysisDatasetInput {
  userId: string;
  asOf: string;
  planId?: string | null;
  /** When true, computes time at effort from stored samples. */
  includeTimeAtEffort?: boolean;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Legacy plans may store plan_data as a JSON string; normalize before use. */
export function normalizePlanData(value: unknown): MarathonPlan | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as MarathonPlan;
    } catch {
      return null;
    }
  }
  return value as MarathonPlan;
}

function workouts(plan: MarathonPlan): RaceAnalysisPlanRun[] {
  // Legacy double-encoded plans can have week entries without a `days` array.
  return (plan.weeks ?? []).flatMap((week) => (week.days ?? []).flatMap((day) => {
    const values: Workout[] = [day.workout, day.secondaryWorkout].filter(
      (workout): workout is Workout => workout !== null && workout !== undefined,
    );
    return values.map((workout) => ({
      date: day.date.slice(0, 10),
      miles: workout.totalDistance,
      workoutType: workout.type,
    }));
  }));
}

function normalizePlan(input: {
  id: string;
  raceName: string | null;
  runnerProfile: unknown;
  planData: unknown;
  createdAt: Date;
  updatedAt: Date;
  logs: RaceAnalysisLog[];
}): RaceAnalysisPlan | null {
  const profile = input.runnerProfile as RunnerProfile | null;
  if (!profile || typeof profile.raceDate !== "string" || !validDate(profile.raceDate)) return null;
  const plan = normalizePlanData(input.planData);
  if (!plan) return null;
  const raceDistance = profile.raceDistance ?? "marathon";
  return {
    id: input.id,
    raceName: input.raceName ?? profile.raceName ?? null,
    raceDate: profile.raceDate.slice(0, 10),
    raceDistanceMeters: DISTANCE_METERS[raceDistance] ?? 42_195,
    goalSeconds: raceDistance === "marathon" ? profile.goalMarathonTime * 60 : null,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    plannedRuns: workouts(plan),
    logs: input.logs,
  };
}

/** Athletes with at least one Garmin-tagged race activity, for cohort validation. */
export async function listRaceAnalysisUsers(): Promise<RaceAnalysisUser[]> {
  return db.selectDistinct({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(runActivities, eq(runActivities.userId, users.id))
    .where(eq(runActivities.eventType, "race"))
    .orderBy(asc(users.email));
}

/** Resolves the athlete behind `--email` or the plan behind `--plan-id`. */
export async function findRaceAnalysisUser(input: {
  email?: string;
  planId?: string;
}): Promise<RaceAnalysisUser | null> {
  if (input.email) {
    const [row] = await db.select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    return row ?? null;
  }
  if (input.planId) {
    const [row] = await db.select({ id: users.id, email: users.email })
      .from(users)
      .innerJoin(plans, eq(plans.userId, users.id))
      .where(eq(plans.id, input.planId))
      .limit(1);
    return row ?? null;
  }
  return null;
}

/**
 * Computes per-activity time at effort from stored samples using each
 * activity's linked plan zones. Returns only activities that produced a
 * heart-rate or measured-power breakdown.
 */
export async function loadTimeAtEffort(
  activityRows: Array<{
    id: string;
    planId: string | null;
    durationSeconds: number;
    powerSource: string;
  }>,
): Promise<Map<string, NonNullable<RaceAnalysisActivity["timeAtEffort"]>>> {
  const result = new Map<string, NonNullable<RaceAnalysisActivity["timeAtEffort"]>>();
  const planIds = [...new Set(activityRows.flatMap((row) => (row.planId ? [row.planId] : [])))];
  const zonesByPlan = new Map<string, {
    heartRateZones: MarathonPlan["paceZones"]["heartRateZones"] | null;
    powerZones: MarathonPlan["powerZones"] | null;
  }>();
  if (planIds.length > 0) {
    const zoneRows = await db.select({ id: plans.id, planData: plans.planData })
      .from(plans)
      .where(inArray(plans.id, planIds));
    for (const row of zoneRows) {
      const plan = normalizePlanData(row.planData);
      zonesByPlan.set(row.id, {
        heartRateZones: plan?.paceZones?.heartRateZones ?? null,
        powerZones: plan?.powerZones ?? null,
      });
    }
  }

  for (let offset = 0; offset < activityRows.length; offset += SAMPLE_BATCH_SIZE) {
    const batch = activityRows.slice(offset, offset + SAMPLE_BATCH_SIZE);
    const sampleRows = await db.select({
      activityId: activitySamples.activityId,
      elapsedSeconds: activitySamples.elapsedSeconds,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
    }).from(activitySamples)
      .where(inArray(activitySamples.activityId, batch.map((row) => row.id)))
      .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds));

    const samplesByActivity = new Map<string, ActivityChartSample[]>();
    for (const sample of sampleRows) {
      const list = samplesByActivity.get(sample.activityId) ?? [];
      list.push({
        elapsedSeconds: sample.elapsedSeconds,
        heartRate: sample.heartRate,
        power: sample.power,
        cadence: null,
        speedMetersPerSecond: sample.speedMetersPerSecond,
      });
      samplesByActivity.set(sample.activityId, list);
    }

    for (const activity of batch) {
      const samples = samplesByActivity.get(activity.id);
      if (!samples || samples.length === 0) continue;
      const zones = activity.planId ? zonesByPlan.get(activity.planId) : undefined;
      const summary = summarizeTimeAtEffort({
        samples,
        heartRateZones: zones?.heartRateZones ?? null,
        powerZones: zones?.powerZones ?? null,
        hasMeasuredPower: !activity.powerSource.startsWith("estimated_"),
        durationSeconds: activity.durationSeconds,
      });
      if (summary.heartRate || summary.power) result.set(activity.id, summary);
    }
  }
  return result;
}

/**
 * Loads one athlete's race-analysis inputs in the shapes the pure
 * `race-performance-analysis` functions expect. Read-only.
 */
export async function loadRaceAnalysisDataset(
  input: LoadRaceAnalysisDatasetInput,
): Promise<RaceAnalysisDataset> {
  const activityRows = await db.select({
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
    planId: runActivities.planId,
    powerSource: runActivities.powerSource,
  }).from(runActivities)
    .where(and(
      eq(runActivities.userId, input.userId),
      lte(runActivities.localDate, input.asOf),
    ))
    .orderBy(asc(runActivities.localDate), asc(runActivities.startTimeGmt));

  const canonicalRows = await db.select({
    id: raceResults.id,
    raceDate: raceResults.raceDate,
    officialDistanceMeters: raceResults.officialDistanceMeters,
    chipTimeSeconds: raceResults.chipTimeSeconds,
    gunTimeSeconds: raceResults.gunTimeSeconds,
    status: raceResults.status,
    classification: raceResults.classification,
    predictionExcluded: raceResults.predictionExcluded,
    linkedActivityId: raceResults.linkedActivityId,
    elevationGainMeters: raceResults.elevationGainMeters,
    verificationStatus: raceResults.verificationStatus,
    activityAverageHeartRate: runActivities.averageHeartRate,
    activityAveragePower: runActivities.averagePower,
    activityCalculatedPower: runActivities.calculatedPower,
  }).from(raceResults)
    .leftJoin(runActivities, eq(runActivities.id, raceResults.linkedActivityId))
    .where(and(
      eq(raceResults.userId, input.userId),
      lte(raceResults.raceDate, input.asOf),
    ))
    .orderBy(asc(raceResults.raceDate), asc(raceResults.createdAt));

  const canonicalActivityIds = new Set(canonicalRows.flatMap((row) => (
    row.linkedActivityId ? [row.linkedActivityId] : []
  )));
  const executionActivityIds = [...new Set([
    ...activityRows.map((activity) => activity.id),
    ...canonicalActivityIds,
  ])];
  const executionByActivity = new Map<string, RaceExecutionQuality>();
  if (executionActivityIds.length > 0) {
    const executionRows = await db.select({
      activityId: activityAnalytics.activityId,
      metrics: activityAnalytics.metrics,
    }).from(activityAnalytics)
      .where(and(
        eq(activityAnalytics.algorithmVersion, RACE_EXECUTION_VERSION),
        inArray(activityAnalytics.activityId, executionActivityIds),
      ));
    for (const row of executionRows) {
      const quality = parseExecutionQuality(row.metrics);
      if (quality !== null) executionByActivity.set(row.activityId, quality);
    }
  }

  const effortByActivity = input.includeTimeAtEffort
    ? await loadTimeAtEffort(activityRows)
    : new Map();

  const activities: RaceAnalysisActivity[] = [
    ...activityRows.map((activity): RaceAnalysisActivity => ({
      id: activity.id,
      localDate: activity.localDate,
      distanceMeters: activity.distanceMeters,
      durationSeconds: activity.durationSeconds,
      movingDurationSeconds: activity.movingDurationSeconds,
      averageHeartRate: activity.averageHeartRate,
      averagePower: activity.averagePower,
      calculatedPower: activity.calculatedPower,
      elevationGainMeters: activity.elevationGainMeters,
      excludedFromAnalytics: activity.excludedFromAnalytics,
      executionQuality: executionByActivity.get(activity.id) ?? null,
      timeAtEffort: effortByActivity.get(activity.id) ?? null,
      eventType: canonicalActivityIds.has(activity.id)
        || activity.predictionExcluded
        || (activity.raceClassification !== null && activity.raceClassification !== "official")
        ? null
        : activity.eventType,
    })),
    ...canonicalRows.filter(isPredictionEligibleRaceResult).map((row): RaceAnalysisActivity => ({
      id: row.id,
      localDate: row.raceDate,
      distanceMeters: row.officialDistanceMeters,
      durationSeconds: (row.chipTimeSeconds ?? row.gunTimeSeconds) as number,
      movingDurationSeconds: null,
      eventType: "race",
      averageHeartRate: row.activityAverageHeartRate,
      averagePower: row.activityAveragePower,
      calculatedPower: row.activityCalculatedPower,
      elevationGainMeters: row.elevationGainMeters,
      excludedFromAnalytics: false,
      trainingExcluded: true,
      resultSource: "canonical",
      verificationStatus: row.verificationStatus as RaceAnalysisActivity["verificationStatus"],
      executionQuality: row.linkedActivityId
        ? executionByActivity.get(row.linkedActivityId) ?? null
        : null,
    })),
  ].sort((left, right) => left.localDate.localeCompare(right.localDate));

  const planRows = await db.select({
    id: plans.id,
    raceName: plans.raceName,
    runnerProfile: plans.runnerProfile,
    planData: plans.planData,
    createdAt: plans.createdAt,
    updatedAt: plans.updatedAt,
  }).from(plans)
    .where(and(
      eq(plans.userId, input.userId),
      input.planId ? eq(plans.id, input.planId) : undefined,
    ))
    .orderBy(asc(plans.createdAt));

  const logRows = planRows.length === 0 ? [] : await db.select({
    planId: planRunLogs.planId,
    date: planRunLogs.date,
    completed: planRunLogs.completed,
    actualMileage: planRunLogs.actualMileage,
    loggedAt: planRunLogs.loggedAt,
    isAdditionalRun: planRunLogs.isAdditionalRun,
  }).from(planRunLogs)
    .where(inArray(planRunLogs.planId, planRows.map((plan) => plan.id)))
    .orderBy(asc(planRunLogs.date), asc(planRunLogs.loggedAt));

  const logsByPlan = new Map<string, RaceAnalysisLog[]>();
  for (const log of logRows) {
    const list = logsByPlan.get(log.planId) ?? [];
    list.push({
      date: log.date.slice(0, 10),
      completed: log.completed === 1,
      actualMiles: log.actualMileage / 100,
      loggedAt: log.loggedAt.toISOString(),
      isAdditionalRun: log.isAdditionalRun === 1,
    });
    logsByPlan.set(log.planId, list);
  }

  const analysisPlans = planRows
    .map((plan) => normalizePlan({
      id: plan.id,
      raceName: plan.raceName,
      runnerProfile: plan.runnerProfile,
      planData: plan.planData,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      logs: logsByPlan.get(plan.id) ?? [],
    }))
    .filter((plan): plan is RaceAnalysisPlan => plan !== null);

  return {
    activities,
    plans: analysisPlans,
    timeAtEffortActivities: effortByActivity.size,
  };
}