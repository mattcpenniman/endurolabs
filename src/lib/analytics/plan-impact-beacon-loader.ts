// ============================================================
// EnduroLab — Plan Impact Beacon Loader
// ============================================================
// Loads the plan-scoped inputs for the plan-vs-actual impact
// beacon: the stored plan, Garmin activities matched to the plan,
// manual run logs, and per-activity time at effort computed from
// stored samples with each activity's linked plan zones. Read-only.

import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planRunLogs, plans, runActivities } from "@/lib/db/schema";
import { metersToMiles, type ImpactBeaconRun } from "@/lib/analytics/impact-beacon";
import {
  loadTimeAtEffort,
  normalizePlanData,
} from "@/lib/analytics/race-analysis-loader";
import type { MarathonPlan } from "@/lib/training/models";

/** Loads a user-owned plan, tolerating legacy string-encoded plan data. */
export async function loadImpactBeaconPlan(
  userId: string,
  planId: string,
): Promise<MarathonPlan | null> {
  const [row] = await db.select({ planData: plans.planData })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);
  return normalizePlanData(row?.planData);
}

export interface LoadImpactBeaconRunsInput {
  userId: string;
  planId: string;
  asOf: string;
}

/**
 * Builds the actual-run list for a plan through the as-of date. Garmin
 * activities tagged with the plan are merged with completed manual logs the
 * same way the stats page merges them: a log that points at a merged activity
 * is represented by that activity, and other logs stand on their own.
 */
export async function loadImpactBeaconRuns(
  input: LoadImpactBeaconRunsInput,
): Promise<ImpactBeaconRun[]> {
  const logs = await db.select({
    id: planRunLogs.id,
    date: planRunLogs.date,
    actualMileage: planRunLogs.actualMileage,
    mergedActivityId: planRunLogs.mergedActivityId,
  }).from(planRunLogs)
    .where(and(
      eq(planRunLogs.userId, input.userId),
      eq(planRunLogs.planId, input.planId),
      eq(planRunLogs.completed, 1),
      lte(planRunLogs.date, input.asOf),
    ))
    .orderBy(asc(planRunLogs.date));

  const mergedIds = logs.flatMap((log) => (log.mergedActivityId ? [log.mergedActivityId] : []));
  const activityRows = await db.select({
    id: runActivities.id,
    localDate: runActivities.localDate,
    distanceMeters: runActivities.distanceMeters,
    durationSeconds: runActivities.durationSeconds,
    eventType: runActivities.eventType,
    planId: runActivities.planId,
    powerSource: runActivities.powerSource,
  }).from(runActivities)
    .where(and(
      eq(runActivities.userId, input.userId),
      eq(runActivities.excludedFromAnalytics, false),
      lte(runActivities.localDate, input.asOf),
      mergedIds.length > 0
        ? or(eq(runActivities.planId, input.planId), inArray(runActivities.id, mergedIds))
        : eq(runActivities.planId, input.planId),
    ))
    .orderBy(asc(runActivities.localDate));

  const effortByActivity = await loadTimeAtEffort(activityRows);

  const runs: ImpactBeaconRun[] = activityRows.map((activity) => ({
    date: activity.localDate,
    miles: metersToMiles(activity.distanceMeters),
    durationSeconds: activity.durationSeconds,
    race: activity.eventType === "race",
    timeAtEffort: effortByActivity.get(activity.id) ?? null,
  }));

  for (const log of logs) {
    if (log.mergedActivityId) continue;
    runs.push({
      date: log.date.slice(0, 10),
      miles: log.actualMileage / 100,
      durationSeconds: null,
      timeAtEffort: null,
    });
  }

  return runs;
}