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
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  plans,
  runActivities,
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
  getPlanFitnessHeadline,
  loadFitnessWindowData,
  normalizePowerSource,
} from "@/lib/analytics/fitness-cache";

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
    const currentActivityRows = await db
      .select()
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, user.id),
        eq(runActivities.planId, currentRow.id),
        eq(runActivities.excludedFromAnalytics, false)
      ))
      .orderBy(desc(runActivities.startTimeGmt))
      .limit(2000);
    const currentActivities = currentActivityRows.map(serializeActivity);

    let priorActivityRows: Array<typeof runActivities.$inferSelect> = [];
    let priorActivities: RunActivity[] = [];
    if (priorRow) {
      priorActivityRows = await db
        .select()
        .from(runActivities)
        .where(and(
          eq(runActivities.userId, user.id),
          eq(runActivities.planId, priorRow.id),
          eq(runActivities.excludedFromAnalytics, false)
        ))
        .orderBy(desc(runActivities.startTimeGmt))
        .limit(2000);
      priorActivities = priorActivityRows.map(serializeActivity);
    }

    // Sample traces are windowed by local activity date, matching the snapshot cache key.
    const currentWindow = planWindow(currentPlan);
    const priorWindow = priorPlan ? planWindow(priorPlan) : null;
    const currentPowerSource = primaryPowerSource(currentActivityRows);
    const priorPowerSource = primaryPowerSource(priorActivityRows);
    const [currentWindowData, priorWindowData] = await Promise.all([
      loadFitnessWindowData(user.id, currentWindow, currentPowerSource),
      priorWindow ? loadFitnessWindowData(user.id, priorWindow, priorPowerSource) : Promise.resolve(null),
    ]);

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

    // Derive weekly + plan-level Power @ HR models per plan.
    const currentFitness = currentSamples.length > 0
      ? analyzePlanFitness({
          weekWindows: currentPlan.weeks
            .map((w) => ({
              start: w.startDate.slice(0, 10),
              end: (w.days[w.days.length - 1]?.date ?? w.endDate).slice(0, 10),
            })),
          samples: currentSamples,
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
          source: normalizePowerSource(priorPowerSource),
          headlineModel: priorHeadline,
        })
      : null;

    const comparison = comparePlans({
      currentPlan,
      priorPlan,
      currentActivities,
      priorActivities,
      currentFitnessByWeek: currentFitness?.weeks,
      priorFitnessByWeek: priorFitness?.weeks,
    });

    return NextResponse.json({
      currentPlanId: currentRow.id,
      priorPlanId: priorRow?.id ?? null,
      comparison,
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
