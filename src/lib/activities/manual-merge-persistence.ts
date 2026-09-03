// ============================================================
// EnduroLab - Persisted Manual Activity Reconciliation
// ============================================================

import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planRunLogs, runActivities } from "@/lib/db/schema";
import { matchManualLogsToActivities } from "@/lib/activities/manual-merge";

export async function reconcileManualActivityMerges(userId: string, planId?: string): Promise<number> {
  const logs = await db.select({
    id: planRunLogs.id,
    date: planRunLogs.date,
    actualMileageHundredths: planRunLogs.actualMileage,
  }).from(planRunLogs).where(and(
    eq(planRunLogs.userId, userId),
    eq(planRunLogs.completed, 1),
    isNull(planRunLogs.mergedActivityId),
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
  }).from(runActivities).where(and(
    eq(runActivities.userId, userId),
    inArray(runActivities.localDate, dates),
  ));
  const matches = matchManualLogsToActivities(logs, activities.filter((activity) => !claimed.has(activity.id)));
  for (const match of matches) {
    await db.update(planRunLogs).set({ mergedActivityId: match.activityId, mergedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(planRunLogs.id, match.logId), isNull(planRunLogs.mergedActivityId)));
  }
  return matches.length;
}
