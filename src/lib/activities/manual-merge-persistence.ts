// ============================================================
// EnduroLab - Persisted Manual Activity Reconciliation
// ============================================================

import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planRunLogs, runActivities } from "@/lib/db/schema";
import { getGarminLogValidation, matchManualLogsToActivities } from "@/lib/activities/manual-merge";

export async function reconcileManualActivityMerges(userId: string, planId?: string): Promise<number> {
  const logs = await db.select({
    id: planRunLogs.id,
    date: planRunLogs.date,
    actualMileageHundredths: planRunLogs.actualMileage,
    planId: planRunLogs.planId,
    weekNumber: planRunLogs.weekNumber,
    plannedWorkoutId: planRunLogs.plannedWorkoutId,
    mergedActivityId: planRunLogs.mergedActivityId,
  }).from(planRunLogs).where(and(
    eq(planRunLogs.userId, userId),
    eq(planRunLogs.completed, 1),
    ...(planId ? [eq(planRunLogs.planId, planId)] : []),
  ));
  if (logs.length === 0) return 0;
  const dates = [...new Set(logs.map((log) => log.date.slice(0, 10)))];
  const claimedRows = await db.select({ activityId: planRunLogs.mergedActivityId })
    .from(planRunLogs)
    .where(eq(planRunLogs.userId, userId));
  const claimed = new Set(claimedRows.map((row) => row.activityId).filter((id): id is string => Boolean(id)));
  const activities = await db.select({
    id: runActivities.id,
    localDate: runActivities.localDate,
    distanceMeters: runActivities.distanceMeters,
    planId: runActivities.planId,
    weekNumber: runActivities.weekNumber,
    plannedWorkoutId: runActivities.plannedWorkoutId,
  }).from(runActivities).where(and(
    eq(runActivities.userId, userId),
    eq(runActivities.source, "garmin"),
    inArray(runActivities.localDate, dates),
  ));
  for (const log of logs) {
    if (!log.mergedActivityId) continue;
    const activity = activities.find((candidate) => candidate.id === log.mergedActivityId);
    if (!activity) continue;
    const validation = getGarminLogValidation(log.actualMileageHundredths, activity.distanceMeters);
    await db.update(planRunLogs).set({
      garminDistance: validation.garminDistanceHundredths,
      garminVariance: validation.garminVarianceHundredths,
      garminValidationStatus: validation.status,
      updatedAt: new Date(),
    }).where(eq(planRunLogs.id, log.id));
  }

  const unmergedLogs = logs.filter((log) => !log.mergedActivityId);
  const matches = matchManualLogsToActivities(unmergedLogs, activities.filter((activity) => !claimed.has(activity.id)));
  for (const match of matches) {
    const log = logs.find((candidate) => candidate.id === match.logId);
    const activity = activities.find((candidate) => candidate.id === match.activityId);
    if (!log || !activity) continue;
    const validation = getGarminLogValidation(log.actualMileageHundredths, activity.distanceMeters);
    await db.update(planRunLogs).set({
      mergedActivityId: match.activityId,
      mergedAt: new Date(),
      garminDistance: validation.garminDistanceHundredths,
      garminVariance: validation.garminVarianceHundredths,
      garminValidationStatus: validation.status,
      updatedAt: new Date(),
    })
      .where(and(eq(planRunLogs.id, match.logId), isNull(planRunLogs.mergedActivityId)));
  }
  return matches.length;
}
