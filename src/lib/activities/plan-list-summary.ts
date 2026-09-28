// ============================================================
// EnduroLab - Saved Plan List Summaries
// ============================================================

import type { MarathonPlan, RunnerProfile } from "@/lib/training/models";

const METERS_PER_MILE = 1609.344;

/** Minimal saved-plan shape needed to order plans by the day their final week ends. */
export interface PlanEndDateSource {
  planData: Pick<MarathonPlan, "weeks" | "raceDay">;
  runnerProfile: Pick<RunnerProfile, "raceDate">;
}

function planEndDateKey(plan: PlanEndDateSource): string {
  const lastWeek = plan.planData.weeks[plan.planData.weeks.length - 1];
  const endDate = lastWeek?.endDate ?? plan.planData.raceDay ?? plan.runnerProfile.raceDate;
  return endDate?.slice(0, 10) ?? "";
}

/** Sorts saved plans by the final day the plan covers, newest first; undated plans sort last. */
export function sortPlansByEndDateDesc<T extends PlanEndDateSource>(plans: readonly T[]): T[] {
  return [...plans].sort((a, b) => planEndDateKey(b).localeCompare(planEndDateKey(a)));
}

export interface PlanListSummary {
  plannedMileage: number;
  actualMileage: number;
  actualRunCount: number;
  actualElevationGainMeters: number | null;
  averagePaceMinutesPerMile: number | null;
}

interface PlanSummaryActivity {
  id: string;
  planId: string | null;
  distanceMeters: number;
  durationSeconds: number;
  elevationGainMeters: number | null;
}

interface PlanSummaryLog {
  planId: string;
  actualMileage: number;
  mergedActivityId: string | null;
}

export function buildPlanListSummaries(
  savedPlans: Array<{ id: string; planData: MarathonPlan }>,
  activities: PlanSummaryActivity[],
  logs: PlanSummaryLog[],
): Map<string, PlanListSummary> {
  const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));

  return new Map(savedPlans.map((savedPlan) => {
    const planActivities = new Map(
      activities
        .filter((activity) => activity.planId === savedPlan.id)
        .map((activity) => [activity.id, activity]),
    );
    const planLogs = logs.filter((log) => log.planId === savedPlan.id);

    for (const log of planLogs) {
      if (!log.mergedActivityId) continue;
      const activity = activitiesById.get(log.mergedActivityId);
      if (activity) planActivities.set(activity.id, activity);
    }

    const activityRows = [...planActivities.values()];
    const manualLogs = planLogs.filter((log) => !log.mergedActivityId);
    const activityDistanceMeters = activityRows.reduce((sum, activity) => sum + Math.max(0, activity.distanceMeters), 0);
    const pacedActivities = activityRows.filter((activity) => activity.distanceMeters > 0 && activity.durationSeconds > 0);
    const pacedDistanceMeters = pacedActivities.reduce((sum, activity) => sum + activity.distanceMeters, 0);
    const durationSeconds = pacedActivities.reduce((sum, activity) => sum + activity.durationSeconds, 0);
    const elevationRows = activityRows.filter((activity) => activity.elevationGainMeters !== null);

    return [savedPlan.id, {
      plannedMileage: savedPlan.planData.weeks.reduce((sum, week) => sum + week.totalMileage, 0),
      actualMileage: activityDistanceMeters / METERS_PER_MILE
        + manualLogs.reduce((sum, log) => sum + Math.max(0, log.actualMileage) / 100, 0),
      actualRunCount: activityRows.length + manualLogs.length,
      actualElevationGainMeters: elevationRows.length > 0
        ? elevationRows.reduce((sum, activity) => sum + (activity.elevationGainMeters ?? 0), 0)
        : null,
      averagePaceMinutesPerMile: pacedDistanceMeters > 0
        ? durationSeconds / 60 / (pacedDistanceMeters / METERS_PER_MILE)
        : null,
    }];
  }));
}
