// ============================================================
// EnduroLab - Manual and Provider Activity Reconciliation
// ============================================================

export const MANUAL_ACTIVITY_DISTANCE_TOLERANCE_MILES = 0.3;

export interface ManualMergeLog {
  id: string;
  date: string;
  actualMileageHundredths: number;
}

export interface ManualMergeActivity {
  id: string;
  localDate: string;
  distanceMeters: number;
}

export interface ManualActivityMerge {
  logId: string;
  activityId: string;
}

/** Produce deterministic one-to-one same-day, nearest-distance matches. */
export function matchManualLogsToActivities(
  logs: ManualMergeLog[],
  activities: ManualMergeActivity[],
): ManualActivityMerge[] {
  const candidates = logs.flatMap((log) => activities
    .filter((activity) => activity.localDate === log.date.slice(0, 10))
    .map((activity) => ({
      logId: log.id,
      activityId: activity.id,
      difference: Math.abs(log.actualMileageHundredths / 100 - activity.distanceMeters / 1609.344),
    })))
    .filter((candidate) => candidate.difference <= MANUAL_ACTIVITY_DISTANCE_TOLERANCE_MILES)
    .sort((a, b) => a.difference - b.difference || a.logId.localeCompare(b.logId) || a.activityId.localeCompare(b.activityId));

  const usedLogs = new Set<string>();
  const usedActivities = new Set<string>();
  const matches: ManualActivityMerge[] = [];
  for (const candidate of candidates) {
    if (usedLogs.has(candidate.logId) || usedActivities.has(candidate.activityId)) continue;
    usedLogs.add(candidate.logId);
    usedActivities.add(candidate.activityId);
    matches.push({ logId: candidate.logId, activityId: candidate.activityId });
  }
  return matches;
}
