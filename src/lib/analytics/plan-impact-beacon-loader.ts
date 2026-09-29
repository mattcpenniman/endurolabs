// ============================================================
// EnduroLab — Plan Impact Beacon Loader
// ============================================================
// Loads the plan-scoped inputs for the plan-vs-actual impact
// beacon: the stored plan, Garmin activities matched to the plan,
// manual run logs, and per-activity time at effort computed from
// stored samples with each activity's linked plan zones. Read-only.

import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planRunLogs, plans, runActivities } from "@/lib/db/schema";
import {
  impactBeaconComparisonWindow,
  metersToMiles,
  resolveBeaconPower,
  type ImpactBeaconRun,
} from "@/lib/analytics/impact-beacon";
import {
  loadTimeAtEffort,
  normalizePlanData,
} from "@/lib/analytics/race-analysis-loader";
import type { MarathonPlan, PowerZones } from "@/lib/training/models";

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

interface ImpactBeaconActivityRow {
  id: string;
  localDate: string;
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  averagePower: number | null;
  eventType: string | null;
  planId: string | null;
  powerSource: string;
}

const ACTIVITY_COLUMNS = {
  id: runActivities.id,
  localDate: runActivities.localDate,
  distanceMeters: runActivities.distanceMeters,
  durationSeconds: runActivities.durationSeconds,
  movingDurationSeconds: runActivities.movingDurationSeconds,
  averagePower: runActivities.averagePower,
  eventType: runActivities.eventType,
  planId: runActivities.planId,
  powerSource: runActivities.powerSource,
};

function toSummaryRun(activity: ImpactBeaconActivityRow): ImpactBeaconRun {
  return {
    date: activity.localDate,
    miles: metersToMiles(activity.distanceMeters),
    durationSeconds: activity.durationSeconds,
    movingDurationSeconds: activity.movingDurationSeconds,
    averagePower: activity.averagePower,
    powerSource: activity.powerSource,
    race: activity.eventType === "race",
    timeAtEffort: null,
  };
}

/**
 * Resolved watt boundaries for the compared plan, measured from the same
 * window the report compares. They bucket measured sample power for activities
 * whose linked plan carries no power zones, so the beacon can measure power
 * effort wherever it can already display power targets.
 */
function fallbackPowerZones(
  plan: MarathonPlan,
  asOf: string,
  activityRows: ImpactBeaconActivityRow[],
): PowerZones | null {
  const comparison = impactBeaconComparisonWindow(plan, asOf);
  if (!comparison) return null;
  const inWindow = activityRows
    .map(toSummaryRun)
    .filter((run) => run.date >= comparison.start && run.date <= comparison.end);
  return resolveBeaconPower(plan, inWindow).zones;
}

async function activityRuns(
  activityRows: ImpactBeaconActivityRow[],
  powerZones: PowerZones | null,
): Promise<ImpactBeaconRun[]> {
  const effortByActivity = await loadTimeAtEffort(activityRows, { fallbackPowerZones: powerZones });
  return activityRows.map((activity) => ({
    ...toSummaryRun(activity),
    timeAtEffort: effortByActivity.get(activity.id) ?? null,
  }));
}

function appendManualLogs(runs: ImpactBeaconRun[], logs: Array<{
  date: string;
  actualMileage: number;
  mergedActivityId: string | null;
}>): void {
  for (const log of logs) {
    if (log.mergedActivityId) continue;
    runs.push({
      date: log.date.slice(0, 10),
      miles: log.actualMileage / 100,
      durationSeconds: null,
      timeAtEffort: null,
    });
  }
}

export interface LoadImpactBeaconRunsInput {
  userId: string;
  planId: string;
  /** The compared plan, whose resolved zones bucket activities without plan zones. */
  plan: MarathonPlan;
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
  const activityRows = await db.select(ACTIVITY_COLUMNS)
    .from(runActivities)
    .where(and(
      eq(runActivities.userId, input.userId),
      eq(runActivities.excludedFromAnalytics, false),
      lte(runActivities.localDate, input.asOf),
      mergedIds.length > 0
        ? or(eq(runActivities.planId, input.planId), inArray(runActivities.id, mergedIds))
        : eq(runActivities.planId, input.planId),
    ))
    .orderBy(asc(runActivities.localDate));

  const runs = await activityRuns(
    activityRows,
    fallbackPowerZones(input.plan, input.asOf, activityRows),
  );
  appendManualLogs(runs, logs);
  return runs;
}

export interface LoadImpactBeaconBaselineRunsInput {
  userId: string;
  /** The proposed plan, whose resolved zones bucket activities without plan zones. */
  plan: MarathonPlan;
  /** First day of the trailing window (YYYY-MM-DD). */
  since: string;
  /** Last day of the trailing window (YYYY-MM-DD). */
  asOf: string;
}

/**
 * Builds the trailing actual-run list for a plan that has not started yet:
 * every non-excluded activity in the window, whichever plan it is linked to,
 * merged with completed manual logs the same way the plan-scoped loader does.
 * Time at effort still uses each activity's own linked plan zones.
 */
export async function loadImpactBeaconBaselineRuns(
  input: LoadImpactBeaconBaselineRunsInput,
): Promise<ImpactBeaconRun[]> {
  const logs = await db.select({
    id: planRunLogs.id,
    date: planRunLogs.date,
    actualMileage: planRunLogs.actualMileage,
    mergedActivityId: planRunLogs.mergedActivityId,
  }).from(planRunLogs)
    .where(and(
      eq(planRunLogs.userId, input.userId),
      eq(planRunLogs.completed, 1),
      gte(planRunLogs.date, input.since),
      lte(planRunLogs.date, input.asOf),
    ))
    .orderBy(asc(planRunLogs.date));

  const activityRows = await db.select(ACTIVITY_COLUMNS)
    .from(runActivities)
    .where(and(
      eq(runActivities.userId, input.userId),
      eq(runActivities.excludedFromAnalytics, false),
      gte(runActivities.localDate, input.since),
      lte(runActivities.localDate, input.asOf),
    ))
    .orderBy(asc(runActivities.localDate));

  const runs = await activityRuns(
    activityRows,
    fallbackPowerZones(input.plan, input.asOf, activityRows),
  );
  appendManualLogs(runs, logs);
  return runs;
}