// ============================================================
// EnduroLab — Stats API (current vs prior plan, week by week)
// ============================================================
// GET /api/stats?currentPlanId=<id>&priorPlanId=<id>
//   Returns a compact comparison payload: for each plan week,
//   planned vs actuals (mileage, pace, HR, power, long run,
//   adherence) side-by-side with delta, plus a plan-level
//   Power @ HR headline when sample-level Garmin data exists.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  plans,
  planRunLogs,
  runActivities,
  weightMeasurements,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { MarathonPlan } from "@/lib/training/models";
import { RunActivity } from "@/lib/activities/models";
import { comparePlans } from "@/lib/analytics/plan-comparison";
import {
  analyzePlanFitness,
} from "@/lib/analytics/plan-fitness";
import { ANALYTICS_QUALITY_THRESHOLD } from "@/lib/analytics/activity-quality";
import {
  FitnessWindow,
  FitnessWindowData,
  getPlanFitnessHeadline,
  loadFitnessWindowData,
  loadModeledFitnessWindowData,
  normalizePowerSource,
} from "@/lib/analytics/fitness-cache";
import { fitSpeedPowerModel } from "@/lib/analytics/modeled-power";
import { analyzeAerobicDecouplingByActivity } from "@/lib/analytics/running-fitness";

interface SerializedDecouplingResult {
  activityId: string;
  activityName: string;
  localDate: string;
  percentage: number;
  usableMinutes: number;
}

function serializeDecoupling(
  samples: FitnessWindowData["samples"],
  activities: RunActivity[],
): SerializedDecouplingResult[] {
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  return analyzeAerobicDecouplingByActivity(samples)
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
  return {
    id: row.id,
    providerActivityId: row.providerActivityId,
    source: row.source,
    powerSource: row.powerSource,
    activityName: row.activityName,
    activityType: row.activityType,
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
    averagePower: row.averagePower,
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
      row.sampleCount === 0
      || (row.qualityScore !== null && row.qualityScore < ANALYTICS_QUALITY_THRESHOLD)
    ) continue;
    sampleTotals.set(row.powerSource, (sampleTotals.get(row.powerSource) ?? 0) + row.sampleCount);
  }
  return [...sampleTotals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "garmin";
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
      averagePower: null,
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
    const currentSpeedPowerModel = fitSpeedPowerModel(currentActivityRows);
    const priorSpeedPowerModel = fitSpeedPowerModel(priorActivityRows);
    const [currentWindowData, priorWindowData, currentModeledWindowData, priorModeledWindowData, latestWeight] = await Promise.all([
      loadFitnessWindowData(user.id, currentWindow, currentPowerSource),
      priorWindow ? loadFitnessWindowData(user.id, priorWindow, priorPowerSource) : Promise.resolve(null),
      currentSpeedPowerModel
        ? loadModeledFitnessWindowData(user.id, currentWindow, currentSpeedPowerModel)
        : Promise.resolve(null),
      priorWindow && priorSpeedPowerModel
        ? loadModeledFitnessWindowData(user.id, priorWindow, priorSpeedPowerModel)
        : Promise.resolve(null),
      db.select({ weightKg: weightMeasurements.weightKg })
        .from(weightMeasurements)
        .where(eq(weightMeasurements.userId, user.id))
        .orderBy(desc(weightMeasurements.measuredAt))
        .limit(1),
    ]);
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
    const currentDecoupling = serializeDecoupling(currentSamples, currentActivities);
    const priorDecoupling = serializeDecoupling(priorSamples, priorActivities);

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

    return NextResponse.json({
      currentPlanId: currentRow.id,
      priorPlanId: priorRow?.id ?? null,
      comparison,
      aerobicDecoupling: {
        current: currentDecoupling,
        prior: priorDecoupling,
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
