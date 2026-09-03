// ============================================================
// EnduroLab - Manual and Provider Activity Reconciliation
// ============================================================

export const MANUAL_ACTIVITY_DISTANCE_TOLERANCE_MILES = 0.3;

export interface ManualMergeLog {
  id: string;
  date: string;
  actualMileageHundredths: number;
  planId?: string;
  weekNumber?: number;
  plannedWorkoutId?: string | null;
}

export interface ManualMergeActivity {
  id: string;
  localDate: string;
  distanceMeters: number;
  planId?: string | null;
  weekNumber?: number | null;
  plannedWorkoutId?: string | null;
}

export interface ManualActivityMerge {
  logId: string;
  activityId: string;
}

export interface GarminLogValidation {
  garminDistanceHundredths: number;
  garminVarianceHundredths: number;
  status: "validated" | "variance";
}

export function getGarminLogValidation(
  actualMileageHundredths: number,
  distanceMeters: number,
): GarminLogValidation {
  const garminDistanceHundredths = Math.round((distanceMeters / 1609.344) * 100);
  const garminVarianceHundredths = actualMileageHundredths - garminDistanceHundredths;
  return {
    garminDistanceHundredths,
    garminVarianceHundredths,
    status: garminVarianceHundredths === 0 ? "validated" : "variance",
  };
}

/** Produce deterministic one-to-one same-day, nearest-distance matches. */
export function matchManualLogsToActivities(
  logs: ManualMergeLog[],
  activities: ManualMergeActivity[],
): ManualActivityMerge[] {
  const candidates = logs.flatMap((log) => activities
    .map((activity) => {
      const isAssignedWorkout = Boolean(
        log.planId
        && log.plannedWorkoutId
        && activity.planId === log.planId
        && activity.weekNumber === log.weekNumber
        && activity.plannedWorkoutId === log.plannedWorkoutId
      );
      return {
        logId: log.id,
        activityId: activity.id,
        difference: Math.abs(log.actualMileageHundredths / 100 - activity.distanceMeters / 1609.344),
        priority: isAssignedWorkout ? 0 : 1,
        isCandidate: isAssignedWorkout || activity.localDate === log.date.slice(0, 10),
      };
    })
    .filter((candidate) => candidate.isCandidate)
    .filter((candidate) => candidate.priority === 0 || candidate.difference <= MANUAL_ACTIVITY_DISTANCE_TOLERANCE_MILES))
    .sort((a, b) => a.priority - b.priority || a.difference - b.difference || a.logId.localeCompare(b.logId) || a.activityId.localeCompare(b.activityId));

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
