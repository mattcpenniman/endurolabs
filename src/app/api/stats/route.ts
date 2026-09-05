// ============================================================
// EnduroLab — Stats API (current vs prior plan, week by week)
// ============================================================
// GET /api/stats?currentPlanId=<id>&priorPlanId=<id>
//   Returns a compact comparison payload: for each plan week,
//   planned vs actuals (mileage, pace, HR, power, long run,
//   adherence) side-by-side with delta, plus a plan-level
//   Power @ HR headline when sample-level Garmin data exists.
// ============================================================

import { after, NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  plans,
  planRunLogs,
  runActivities,
  activitySamples,
  activityAnalytics,
  weightMeasurements,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { MarathonPlan } from "@/lib/training/models";
import { RunActivity } from "@/lib/activities/models";
import { resolveSummaryPower } from "@/lib/activities/serialize";
import { applyCalculatedSummaryPower, loadSummaryPowerModel } from "@/lib/activities/summary-power-estimate";
import { comparePlans } from "@/lib/analytics/plan-comparison";
import {
  analyzePlanFitness,
} from "@/lib/analytics/plan-fitness";
import { ANALYTICS_QUALITY_THRESHOLD } from "@/lib/analytics/activity-quality";
import { ACTIVITY_ANALYTICS_VERSION, StoredActivityAnalyticsMetrics } from "@/lib/analytics/activity-summary";
import { recomputeActivityAnalytics } from "@/lib/analytics/activity-summary-persistence";
import {
  FitnessWindow,
  FitnessWindowData,
  getPlanFitnessHeadline,
  normalizePowerSource,
} from "@/lib/analytics/fitness-cache";
import { SpeedPowerModel } from "@/lib/analytics/modeled-power";
import { analyzeAerobicDecouplingByActivity } from "@/lib/analytics/running-fitness";
import {
  calculateLongRunDurability,
  LongRunClassification,
} from "@/lib/analytics/long-run-durability";
import {
  analyzeCadenceByPace,
  CadenceByPaceResult,
} from "@/lib/analytics/cadence-by-pace";
import {
  analyzeElevationAndGrade,
  ElevationGradeAnalysisResult,
} from "@/lib/analytics/elevation-grade";

interface SerializedDecouplingResult {
  activityId: string;
  activityName: string;
  localDate: string;
  percentage: number;
  usableMinutes: number;
}

interface SerializedDurabilityResult {
  activityId: string;
  activityName: string;
  localDate: string;
  classification: LongRunClassification;
  powerRetention: number | null;
  paceRetention: number;
  heartRateDrift: number;
  usableMinutes: number;
}

type StatsSample = Pick<typeof activitySamples.$inferSelect,
  "activityId" | "elapsedSeconds" | "heartRate" | "power" | "speedMetersPerSecond"
  | "elevationMeters" | "cadence" | "latitude" | "longitude"
>;

interface StatsActivityMetadata {
  id: string;
  localDate: string;
  powerSource: string;
  qualityScore: number | null;
  excludedFromAnalytics: boolean;
  averagePower: number | null;
  calculatedPower: number | null;
  sampleCount: number;
  samplesFetchedAt: Date | null;
  updatedAt: Date;
}

interface StatsSampleData {
  activities: StatsActivityMetadata[];
  samplesByActivity: Map<string, StatsSample[]>;
  analyticsByActivity: Map<string, StoredActivityAnalyticsMetrics>;
  analyticsBackfillIds: string[];
}

function serializeCadenceByPace(
  plan: MarathonPlan,
  rows: Array<typeof runActivities.$inferSelect>,
  samplesByActivity: StatsSampleData["samplesByActivity"],
): CadenceByPaceResult {
  const eligible = rows.filter((row) => row.sampleCount > 0);
  if (eligible.length === 0) return { bands: [] };
  const activityDates = new Map(eligible.map((row) => [row.id, row.localDate]));
  const sampleRows = eligible.flatMap((row) => samplesByActivity.get(row.id) ?? []);

  return analyzeCadenceByPace(
    sampleRows.flatMap((sample) => {
      const activityStartDate = activityDates.get(sample.activityId);
      return activityStartDate ? [{ ...sample, activityStartDate }] : [];
    }),
    plan.weeks.map((week) => ({
      weekNumber: week.weekNumber,
      startDate: week.startDate.slice(0, 10),
      endDate: (week.days[week.days.length - 1]?.date ?? week.endDate).slice(0, 10),
    })),
  );
}

function serializeElevationGrade(
  plan: MarathonPlan,
  rows: Array<typeof runActivities.$inferSelect>,
  hasMeasuredPower: boolean,
  samplesByActivity: StatsSampleData["samplesByActivity"],
): ElevationGradeAnalysisResult {
  const eligible = rows.filter((row) => row.sampleCount > 0);
  if (eligible.length === 0) {
    return {
      totalActivities: 0,
      qualifyingActivities: 0,
      elevationGainFeetPerMile: null,
      distanceMiles: 0,
      weeks: [],
      bands: [],
      rejectionReasons: {},
      partialNote: null,
      suppressReason: "No activity detail samples are stored for this plan yet.",
    };
  }
  const activities = eligible.map((row) => ({
    activityId: row.id,
    activityStartDate: row.localDate,
    summaryDistanceMeters: row.distanceMeters,
    samples: (samplesByActivity.get(row.id) ?? []).map((sample) => ({
      activityId: sample.activityId,
      elapsedSeconds: sample.elapsedSeconds,
      heartRate: sample.heartRate,
      power: sample.power,
      speedMetersPerSecond: sample.speedMetersPerSecond,
      elevationMeters: sample.elevationMeters,
      latitude: sample.latitude,
      longitude: sample.longitude,
    })),
  })).filter((activity) => activity.samples.length > 0);

  if (activities.length === 0) {
    return {
      totalActivities: eligible.length,
      qualifyingActivities: 0,
      elevationGainFeetPerMile: null,
      distanceMiles: 0,
      weeks: [],
      bands: [],
      rejectionReasons: {
        too_short: 0,
        too_short_distance: 0,
        insufficient_gps: 0,
        insufficient_elevation: eligible.length,
        insufficient_speed: 0,
      },
      partialNote: null,
      suppressReason: `None of the ${eligible.length} runs qualified — ${eligible.length} ${eligible.length === 1 ? "run has" : "runs have"} no usable sample data.`,
    };
  }

  return analyzeElevationAndGrade(
    activities,
    plan.weeks.map((week) => ({
      weekNumber: week.weekNumber,
      startDate: week.startDate.slice(0, 10),
      endDate: (week.days[week.days.length - 1]?.date ?? week.endDate).slice(0, 10),
    })),
    hasMeasuredPower,
  );
}

function durabilityCandidates(plan: MarathonPlan): Map<string, LongRunClassification> {
  const candidates = new Map<string, LongRunClassification>();
  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (const workout of [day.workout, day.secondaryWorkout]) {
        if (!workout) continue;
        if (workout.type !== "long" && workout.type !== "progression") continue;
        if (workout.type === "progression" && workout.totalDistance < Math.max(8, week.longRunDistance * 0.75)) continue;
        const classification: LongRunClassification = workout.type === "progression"
          ? "progression"
          : workout.type === "long" && workout.segments.every((segment) => ["easy", "recovery", "long"].includes(segment.type))
            ? "steady"
            : "structured";
        candidates.set(workout.id, classification);
      }
    }
  }
  return candidates;
}

function serializeDurability(
  plan: MarathonPlan,
  rows: Array<typeof runActivities.$inferSelect>,
  samplesByActivity: StatsSampleData["samplesByActivity"],
  analyticsByActivity: StatsSampleData["analyticsByActivity"],
): SerializedDurabilityResult[] {
  const candidates = durabilityCandidates(plan);
  const eligible = rows.filter((row) => row.plannedWorkoutId && candidates.has(row.plannedWorkoutId) && row.sampleCount > 0);
  if (eligible.length === 0) return [];
  return eligible.flatMap((activity) => {
    const classification = candidates.get(activity.plannedWorkoutId!);
    if (!classification) return [];
    const cached = analyticsByActivity.get(activity.id)?.durability;
    const hasMeasuredPower = !activity.powerSource.startsWith("estimated_");
    const result = cached
      ? { ...cached, powerRetention: hasMeasuredPower ? cached.powerRetention : null }
      : calculateLongRunDurability(samplesByActivity.get(activity.id) ?? [], hasMeasuredPower);
    if (!result.suitable || result.paceRetention === null || result.heartRateDrift === null) return [];
    return [{
      activityId: activity.id,
      activityName: activity.activityName,
      localDate: activity.localDate,
      classification,
      powerRetention: result.powerRetention === null ? null : Math.round(result.powerRetention * 10) / 10,
      paceRetention: Math.round(result.paceRetention * 10) / 10,
      heartRateDrift: Math.round(result.heartRateDrift * 10) / 10,
      usableMinutes: Math.round(result.usableMinutes),
    }];
  }).sort((a, b) => a.localDate.localeCompare(b.localDate));
}

function serializeDecoupling(
  samples: FitnessWindowData["samples"],
  activities: RunActivity[],
  analyticsByActivity: StatsSampleData["analyticsByActivity"],
): SerializedDecouplingResult[] {
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const eligibleActivityIds = new Set(samples.map((sample) => sample.activityId));
  const uncachedSamples = samples.filter((sample) => !analyticsByActivity.has(sample.activityId));
  const results = [
    ...[...eligibleActivityIds].flatMap((activityId) => {
      const cached = analyticsByActivity.get(activityId)?.decoupling;
      return cached ? [cached] : [];
    }),
    ...analyzeAerobicDecouplingByActivity(uncachedSamples),
  ];
  return results
    .filter((result) => result.suitable)
    .flatMap((result) => {
      const activity = activityById.get(result.activityId);
      if (!activity) return [];
      return [{
        activityId: result.activityId,
        activityName: activity.activityName,
        localDate: activity.localDate,
        percentage: Math.round(result.percentage * 10) / 10,
        usableMinutes: Math.round(result.usableMinutes),
      }];
    })
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}

function serializeActivity(row: typeof runActivities.$inferSelect): RunActivity {
  const distanceMiles = Math.max(0, row.distanceMeters) / 1609.344;
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
    matchConfidence: row.matchConfidence as RunActivity["matchConfidence"] ?? null,
    qualityScore: row.qualityScore,
    excludedFromAnalytics: row.excludedFromAnalytics,
    sampleCount: row.sampleCount,
    samplesFetchedAt: row.samplesFetchedAt?.toISOString() ?? null,
    detailFetchStatus: row.detailFetchStatus,
    detailLastError: row.detailLastError,
    syncedAt: row.syncedAt.toISOString(),
  };
}

function planWindow(plan: MarathonPlan): FitnessWindow {
  const firstWeek = plan.weeks[0];
  const lastWeek = plan.weeks[plan.weeks.length - 1];
  return {
    startDate: firstWeek.startDate.slice(0, 10),
    endDate: (lastWeek.days[lastWeek.days.length - 1]?.date ?? lastWeek.endDate).slice(0, 10),
  };
}

function primaryPowerSource(rows: Array<typeof runActivities.$inferSelect>): string {
  const sampleTotals = new Map<string, number>();
  for (const row of rows) {
    if (
      row.powerSource.startsWith("estimated_")
      || row.sampleCount === 0
      || (row.qualityScore !== null && row.qualityScore < ANALYTICS_QUALITY_THRESHOLD)
    ) continue;
    sampleTotals.set(row.powerSource, (sampleTotals.get(row.powerSource) ?? 0) + row.sampleCount);
  }
  return [...sampleTotals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "garmin";
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function loadStatsSampleData(
  userId: string,
  windows: FitnessWindow[],
  planRows: Array<typeof runActivities.$inferSelect>,
): Promise<StatsSampleData> {
  const startDate = windows.map((window) => window.startDate).sort()[0];
  const endDate = windows.map((window) => window.endDate).sort().at(-1);
  const activities = startDate && endDate
    ? await db.select({
        id: runActivities.id,
        localDate: runActivities.localDate,
        powerSource: runActivities.powerSource,
        qualityScore: runActivities.qualityScore,
        excludedFromAnalytics: runActivities.excludedFromAnalytics,
        averagePower: runActivities.averagePower,
        calculatedPower: runActivities.calculatedPower,
        sampleCount: runActivities.sampleCount,
        samplesFetchedAt: runActivities.samplesFetchedAt,
        updatedAt: runActivities.updatedAt,
      }).from(runActivities).where(and(
        eq(runActivities.userId, userId),
        gte(runActivities.localDate, startDate),
        lt(runActivities.localDate, nextDate(endDate)),
      ))
    : [];
  const activityIds = [...new Set([...activities.map((activity) => activity.id), ...planRows.map((row) => row.id)])];
  if (activityIds.length === 0) {
    return { activities, samplesByActivity: new Map(), analyticsByActivity: new Map(), analyticsBackfillIds: [] };
  }

  const [samples, cachedAnalytics] = await Promise.all([
    db.select({
      activityId: activitySamples.activityId,
      elapsedSeconds: activitySamples.elapsedSeconds,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
      elevationMeters: activitySamples.elevationMeters,
      cadence: activitySamples.cadence,
      latitude: activitySamples.latitude,
      longitude: activitySamples.longitude,
    }).from(activitySamples)
      .where(inArray(activitySamples.activityId, activityIds))
      .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds)),
    db.select({
      activityId: activityAnalytics.activityId,
      sourceSampleCount: activityAnalytics.sourceSampleCount,
      sourceSamplesFetchedAt: activityAnalytics.sourceSamplesFetchedAt,
      metrics: activityAnalytics.metrics,
    }).from(activityAnalytics).where(and(
      inArray(activityAnalytics.activityId, activityIds),
      eq(activityAnalytics.algorithmVersion, ACTIVITY_ANALYTICS_VERSION),
    )),
  ]);
  const samplesByActivity = new Map<string, StatsSample[]>();
  for (const sample of samples) {
    const activitySamplesForId = samplesByActivity.get(sample.activityId) ?? [];
    activitySamplesForId.push(sample);
    samplesByActivity.set(sample.activityId, activitySamplesForId);
  }
  const metadataById = new Map<string, { sampleCount: number; samplesFetchedAt: Date | null }>([
    ...activities.map((activity) => [activity.id, activity] as const),
    ...planRows.map((activity) => [activity.id, activity] as const),
  ]);
  const cachedById = new Map(cachedAnalytics.map((analytics) => [analytics.activityId, analytics]));
  const analyticsByActivity = new Map<string, StoredActivityAnalyticsMetrics>();
  const analyticsBackfillIds = activityIds.filter((activityId) => {
    const metadata = metadataById.get(activityId);
    const cached = cachedById.get(activityId);
    const stale = Boolean(metadata && metadata.sampleCount > 0 && (
      !cached
        || cached.sourceSampleCount !== metadata.sampleCount
        || cached.sourceSamplesFetchedAt?.getTime() !== metadata.samplesFetchedAt?.getTime()
    ));
    if (cached && !stale) analyticsByActivity.set(activityId, cached.metrics as StoredActivityAnalyticsMetrics);
    return stale;
  });
  return { activities, samplesByActivity, analyticsByActivity, analyticsBackfillIds };
}

function fitnessWindowData(
  data: StatsSampleData,
  window: FitnessWindow,
  powerSource: string,
): FitnessWindowData {
  const activities = data.activities.filter((activity) => (
    activity.localDate >= window.startDate && activity.localDate <= window.endDate
  ));
  const eligible = activities.filter((activity) => (
    activity.powerSource === powerSource
      && !activity.excludedFromAnalytics
      && (activity.qualityScore === null || activity.qualityScore >= ANALYTICS_QUALITY_THRESHOLD)
  ));
  return {
    latestDataAt: activities.reduce<Date | null>(
      (latest, activity) => !latest || activity.updatedAt > latest ? activity.updatedAt : latest,
      null,
    ),
    samples: eligible.flatMap((activity) => (data.samplesByActivity.get(activity.id) ?? []).map((sample) => ({
      ...sample,
      activityStartDate: activity.localDate,
    }))),
  };
}

function modeledFitnessWindowData(
  data: StatsSampleData,
  window: FitnessWindow,
  model: SpeedPowerModel,
): FitnessWindowData {
  const activities = data.activities.filter((activity) => (
    activity.localDate >= window.startDate
      && activity.localDate <= window.endDate
      && !activity.excludedFromAnalytics
      && ((activity.averagePower === null && activity.calculatedPower !== null) || activity.powerSource.startsWith("estimated_"))
  ));
  return {
    latestDataAt: activities.reduce<Date | null>(
      (latest, activity) => !latest || activity.updatedAt > latest ? activity.updatedAt : latest,
      null,
    ),
    samples: activities.flatMap((activity) => (data.samplesByActivity.get(activity.id) ?? []).map((sample) => ({
      ...sample,
      power: sample.speedMetersPerSecond === null
        ? null
        : model.intercept + model.slope * sample.speedMetersPerSecond,
      activityStartDate: activity.localDate,
    }))),
  };
}

async function loadPlanActuals(userId: string, planId: string): Promise<{
  rows: Array<typeof runActivities.$inferSelect>;
  activities: RunActivity[];
}> {
  const logs = await db.select().from(planRunLogs).where(and(
    eq(planRunLogs.userId, userId),
    eq(planRunLogs.planId, planId),
    eq(planRunLogs.completed, 1),
  ));
  const mergedIds = logs.map((log) => log.mergedActivityId).filter((id): id is string => Boolean(id));
  const rows = await db.select().from(runActivities).where(and(
    eq(runActivities.userId, userId),
    eq(runActivities.excludedFromAnalytics, false),
    mergedIds.length > 0
      ? or(eq(runActivities.planId, planId), inArray(runActivities.id, mergedIds))
      : eq(runActivities.planId, planId),
  )).orderBy(desc(runActivities.startTimeGmt)).limit(2000);
  const activities = rows.map(serializeActivity);
  for (const log of logs) {
    if (log.mergedActivityId) continue;
    activities.push({
      id: `manual:${log.id}`,
      providerActivityId: log.id,
      source: "manual",
      powerSource: "manual",
      activityName: log.runTitle ?? "Manual run",
      activityType: "running",
      eventType: null,
      localDate: log.date.slice(0, 10),
      startTimeLocal: log.date,
      startTimeGmt: new Date(`${log.date.slice(0, 10)}T12:00:00Z`).toISOString(),
      distanceMiles: log.actualMileage / 100,
      durationSeconds: 0,
      movingDurationSeconds: null,
      averagePaceMinutesPerMile: null,
      elevationGainMeters: null,
      averageHeartRate: null,
      maxHeartRate: null,
      averageCadence: null,
      garminPower: null,
      calculatedPower: null,
      averagePower: null,
      averagePowerEstimated: false,
      calories: null,
      deviceName: null,
      planId,
      weekNumber: log.weekNumber,
      dayOfWeek: log.dayOfWeek,
      plannedWorkoutId: log.plannedWorkoutId,
      matchConfidence: null,
      sampleCount: 0,
      samplesFetchedAt: null,
      syncedAt: log.updatedAt.toISOString(),
    });
  }
  return { rows, activities };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const currentPlanId = searchParams.get("currentPlanId");
  const priorPlanId = searchParams.get("priorPlanId");
  if (!currentPlanId) {
    return NextResponse.json({ error: "currentPlanId is required" }, { status: 400 });
  }

  try {
    const currentRows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, currentPlanId), eq(plans.userId, user.id)))
      .limit(1);
    if (currentRows.length === 0) {
      return NextResponse.json({ error: "Current plan not found" }, { status: 404 });
    }
    const currentRow = currentRows[0];

    let priorRow: typeof plans.$inferSelect | null = null;
    if (priorPlanId) {
      const candidateRows = await db
        .select()
        .from(plans)
        .where(and(eq(plans.id, priorPlanId), eq(plans.userId, user.id)))
        .limit(1);
      if (candidateRows.length === 0) {
        return NextResponse.json({ error: "Prior plan not found" }, { status: 404 });
      }
      priorRow = candidateRows[0];
    }

    const currentPlan = (currentRow.planData as MarathonPlan) ?? (currentRow.runnerProfile as unknown as MarathonPlan);
    currentPlan.id = currentRow.id;
    const priorPlan = priorRow
      ? ((priorRow.planData as MarathonPlan) ?? (priorRow.runnerProfile as unknown as MarathonPlan))
      : null;
    if (priorPlan) priorPlan.id = priorRow!.id;

    // Keep the stored fallback and sample-level modeled power on the same
    // athlete-wide calibration, including plans with no measured power of their own.
    const summaryPowerModel = await loadSummaryPowerModel(user.id);
    if (summaryPowerModel) await applyCalculatedSummaryPower(user.id, summaryPowerModel);

    // Activity summaries per plan, scoped to user.
    const currentActuals = await loadPlanActuals(user.id, currentRow.id);
    const currentActivityRows = currentActuals.rows;
    const currentActivities = currentActuals.activities;

    let priorActivityRows: Array<typeof runActivities.$inferSelect> = [];
    let priorActivities: RunActivity[] = [];
    if (priorRow) {
      const priorActuals = await loadPlanActuals(user.id, priorRow.id);
      priorActivityRows = priorActuals.rows;
      priorActivities = priorActuals.activities;
    }

    // Sample traces are windowed by local activity date, matching the snapshot cache key.
    const currentWindow = planWindow(currentPlan);
    const priorWindow = priorPlan ? planWindow(priorPlan) : null;
    const currentPowerSource = primaryPowerSource(currentActivityRows);
    const priorPowerSource = primaryPowerSource(priorActivityRows);
    const [sampleData, latestWeight] = await Promise.all([
      loadStatsSampleData(
        user.id,
        priorWindow ? [currentWindow, priorWindow] : [currentWindow],
        [...currentActivityRows, ...priorActivityRows],
      ),
      db.select({ weightKg: weightMeasurements.weightKg })
        .from(weightMeasurements)
        .where(eq(weightMeasurements.userId, user.id))
        .orderBy(desc(weightMeasurements.measuredAt))
        .limit(1),
    ]);
    const currentWindowData = fitnessWindowData(sampleData, currentWindow, currentPowerSource);
    const priorWindowData = priorWindow ? fitnessWindowData(sampleData, priorWindow, priorPowerSource) : null;
    const currentModeledWindowData = summaryPowerModel
      ? modeledFitnessWindowData(sampleData, currentWindow, summaryPowerModel)
      : null;
    const priorModeledWindowData = priorWindow && summaryPowerModel
      ? modeledFitnessWindowData(sampleData, priorWindow, summaryPowerModel)
      : null;
    const weightKg = latestWeight[0]?.weightKg ?? null;

    const [currentHeadline, priorHeadline] = await Promise.all([
      getPlanFitnessHeadline({
        userId: user.id,
        window: currentWindow,
        powerSource: currentPowerSource,
        data: currentWindowData,
      }),
      priorWindow && priorWindowData
        ? getPlanFitnessHeadline({
            userId: user.id,
            window: priorWindow,
            powerSource: priorPowerSource,
            data: priorWindowData,
          })
        : Promise.resolve(null),
    ]);
    const currentSamples = currentWindowData.samples;
    const priorSamples = priorWindowData?.samples ?? [];
    const currentDecoupling = serializeDecoupling(currentSamples, currentActivities, sampleData.analyticsByActivity);
    const priorDecoupling = serializeDecoupling(priorSamples, priorActivities, sampleData.analyticsByActivity);
    const [currentDurability, priorDurability, currentCadenceByPace, priorCadenceByPace, currentElevationGrade, priorElevationGrade] = [
      serializeDurability(currentPlan, currentActivityRows, sampleData.samplesByActivity, sampleData.analyticsByActivity),
      priorPlan ? serializeDurability(priorPlan, priorActivityRows, sampleData.samplesByActivity, sampleData.analyticsByActivity) : [],
      serializeCadenceByPace(currentPlan, currentActivityRows, sampleData.samplesByActivity),
      priorPlan ? serializeCadenceByPace(priorPlan, priorActivityRows, sampleData.samplesByActivity) : { bands: [] },
      serializeElevationGrade(currentPlan, currentActivityRows, !currentPowerSource.startsWith("estimated_"), sampleData.samplesByActivity),
      priorPlan ? serializeElevationGrade(priorPlan, priorActivityRows, !priorPowerSource.startsWith("estimated_"), sampleData.samplesByActivity) : {
          totalActivities: 0,
          qualifyingActivities: 0,
          elevationGainFeetPerMile: null,
          distanceMiles: 0,
          weeks: [],
          bands: [],
          rejectionReasons: {},
          partialNote: null,
          suppressReason: "No prior plan selected.",
      } as ElevationGradeAnalysisResult,
    ];

    // Derive weekly + plan-level Power @ HR models per plan.
    const currentFitness = currentSamples.length > 0
      ? analyzePlanFitness({
          weekWindows: currentPlan.weeks
            .map((w) => ({
              start: w.startDate.slice(0, 10),
              end: (w.days[w.days.length - 1]?.date ?? w.endDate).slice(0, 10),
            })),
          samples: currentSamples,
          defaultWeightKg: weightKg,
          source: normalizePowerSource(currentPowerSource),
          headlineModel: currentHeadline,
        })
      : null;
    const priorFitness = priorPlan && priorSamples.length > 0
      ? analyzePlanFitness({
          weekWindows: priorPlan.weeks
            .map((w) => ({
              start: w.startDate.slice(0, 10),
              end: (w.days[w.days.length - 1]?.date ?? w.endDate).slice(0, 10),
            })),
          samples: priorSamples,
          defaultWeightKg: weightKg,
          source: normalizePowerSource(priorPowerSource),
          headlineModel: priorHeadline,
        })
      : null;
    const currentModeledFitness = currentModeledWindowData?.samples.length
      ? analyzePlanFitness({
          weekWindows: currentPlan.weeks.map((week) => ({
            start: week.startDate.slice(0, 10),
            end: (week.days[week.days.length - 1]?.date ?? week.endDate).slice(0, 10),
          })),
          samples: currentModeledWindowData.samples,
          defaultWeightKg: weightKg,
          source: "other",
        })
      : null;
    const priorModeledFitness = priorPlan && priorModeledWindowData?.samples.length
      ? analyzePlanFitness({
          weekWindows: priorPlan.weeks.map((week) => ({
            start: week.startDate.slice(0, 10),
            end: (week.days[week.days.length - 1]?.date ?? week.endDate).slice(0, 10),
          })),
          samples: priorModeledWindowData.samples,
          defaultWeightKg: weightKg,
          source: "other",
        })
      : null;

    const comparison = comparePlans({
      currentPlan,
      priorPlan,
      currentActivities,
      priorActivities,
      currentFitnessByWeek: currentFitness?.weeks,
      priorFitnessByWeek: priorFitness?.weeks,
      currentModeledFitnessByWeek: currentModeledFitness?.weeks,
      priorModeledFitnessByWeek: priorModeledFitness?.weeks,
    });

    const analyticsBackfillIds = sampleData.analyticsBackfillIds.slice(0, 5);
    if (analyticsBackfillIds.length > 0) {
      after(async () => {
        for (const activityId of analyticsBackfillIds) {
          try {
            await recomputeActivityAnalytics(activityId);
          } catch (error) {
            console.error(`Failed to backfill activity analytics for ${activityId}:`, error);
          }
        }
      });
    }

    return NextResponse.json({
      currentPlanId: currentRow.id,
      priorPlanId: priorRow?.id ?? null,
      comparison,
      aerobicDecoupling: {
        current: currentDecoupling,
        prior: priorDecoupling,
      },
      longRunDurability: {
        current: currentDurability,
        prior: priorDurability,
      },
      cadenceByPace: {
        current: currentCadenceByPace,
        prior: priorCadenceByPace,
      },
      elevationGrade: {
        current: currentElevationGrade,
        prior: priorElevationGrade,
      },
      fitness: {
        current: currentFitness
          ? {
              headline: currentFitness.headline,
              bestWeekModel: currentFitness.bestWeekModel,
              best140: currentFitness.best140,
              best140Wkg: currentFitness.best140Wkg,
            }
          : null,
        prior: priorFitness
          ? {
              headline: priorFitness.headline,
              bestWeekModel: priorFitness.bestWeekModel,
              best140: priorFitness.best140,
              best140Wkg: priorFitness.best140Wkg,
            }
          : null,
        hasCurrentSamples: currentSamples.length > 0,
        hasPriorSamples: priorSamples.length > 0,
      },
    });
  } catch (error) {
    console.error("Failed to compute stats:", error);
    return NextResponse.json({ error: "Failed to compute stats" }, { status: 500 });
  }
}
