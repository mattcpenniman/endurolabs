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
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activitySamples,
  plans,
  runActivities,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { MarathonPlan } from "@/lib/training/models";
import { RunActivity } from "@/lib/activities/models";
import { comparePlans } from "@/lib/analytics/plan-comparison";
import {
  analyzePlanFitness,
  SampleWithActivityStart,
} from "@/lib/analytics/plan-fitness";
import { ActivitySampleInput } from "@/lib/analytics/models";
import { ANALYTICS_QUALITY_THRESHOLD } from "@/lib/analytics/activity-quality";

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

function loadPlanActivitySamples(user: { id: string }, planId: string): Promise<{
  activityId: string;
  activityStartDate: string;
  samples: ActivitySampleInput[];
}[]> {
  const activityRowsQuery = db
    .select()
    .from(runActivities)
    .where(and(
      eq(runActivities.userId, user.id),
      eq(runActivities.planId, planId),
      eq(runActivities.excludedFromAnalytics, false),
      or(isNull(runActivities.qualityScore), gte(runActivities.qualityScore, ANALYTICS_QUALITY_THRESHOLD))
    ))
    .orderBy(asc(runActivities.startTimeGmt));
  return activityRowsQuery.then((activities) => {
    if (activities.length === 0) return [];
    const activityIds = activities.map((a) => a.id);
    return db
      .select()
      .from(activitySamples)
      .where(inArray(activitySamples.activityId, activityIds))
      .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds))
      .then((rows) => {
        const byActivity = new Map<string, ActivitySampleInput[]>();
        for (const row of rows) {
          const arr = byActivity.get(row.activityId) ?? [];
          arr.push({
            activityId: row.activityId,
            elapsedSeconds: row.elapsedSeconds,
            heartRate: row.heartRate,
            power: row.power,
            speedMetersPerSecond: row.speedMetersPerSecond,
            cadence: row.cadence,
          });
          byActivity.set(row.activityId, arr);
        }
        return activities
          .map((activity) => ({
            activityId: activity.id,
            activityStartDate: activity.localDate,
            samples: byActivity.get(activity.id) ?? [],
          }))
          .filter((group) => group.samples.length > 0);
      });
  });
}

function samplesAsInputs(stored: {
  activityId: string;
  activityStartDate: string;
  samples: ActivitySampleInput[];
}[]): SampleWithActivityStart[] {
  const out: SampleWithActivityStart[] = [];
  for (const group of stored) {
    for (const sample of group.samples) {
      out.push({
        ...sample,
        activityStartDate: group.activityStartDate,
      });
    }
  }
  return out;
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

    let priorActivities: RunActivity[] = [];
    if (priorRow) {
      const priorActivityRows = await db
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

    // Sample traces per plan, if any.
    const [currentSampleGroups, priorSampleGroups] = await Promise.all([
      loadPlanActivitySamples(user, currentRow.id),
      priorRow ? loadPlanActivitySamples(user, priorRow.id) : Promise.resolve([]),
    ]);

    const currentSamples = samplesAsInputs(currentSampleGroups);
    const priorSamples = samplesAsInputs(priorSampleGroups);

    // Derive weekly + plan-level Power @ HR models per plan.
    const currentFitness = currentSamples.length > 0
      ? analyzePlanFitness({
          weekWindows: currentPlan.weeks
            .map((w) => ({
              start: w.startDate.slice(0, 10),
              end: (w.days[w.days.length - 1]?.date ?? w.endDate).slice(0, 10),
            })),
          samples: currentSamples,
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
