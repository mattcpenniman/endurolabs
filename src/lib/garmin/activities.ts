// ============================================================
// EnduroLab - Garmin Activity Normalization and Matching
// ============================================================

import { MarathonPlan, Workout } from "@/lib/training/models";

export interface GarminActivityPayload {
  activityId: number | string;
  activityName?: string;
  startTimeLocal: string;
  startTimeGMT: string;
  activityType?: { typeKey?: string };
  distance?: number;
  duration?: number;
  movingDuration?: number;
  elevationGain?: number;
  averageHR?: number;
  maxHR?: number;
  averageRunningCadenceInStepsPerMinute?: number;
  avgPower?: number;
  calories?: number;
  manufacturer?: string;
}

export interface NormalizedGarminActivity {
  providerActivityId: string;
  activityName: string;
  activityType: string;
  localDate: string;
  startTimeLocal: string;
  startTimeGmt: Date;
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  elevationGainMeters: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averageCadence: number | null;
  averagePower: number | null;
  calories: number | null;
  deviceName: string | null;
}

export interface ActivityMatch {
  planId: string;
  weekNumber: number;
  dayOfWeek: string;
  plannedWorkoutId: string;
  matchConfidence: "high" | "medium" | "low";
}

function nullableRounded(value: number | undefined): number | null {
  return Number.isFinite(value) ? Math.round(value as number) : null;
}

export function isRunningActivity(activity: GarminActivityPayload): boolean {
  const type = activity.activityType?.typeKey?.toLowerCase() ?? "";
  return type.includes("running") || type.includes("run") || type === "track_running";
}

export function normalizeGarminActivity(activity: GarminActivityPayload): NormalizedGarminActivity {
  const localDate = activity.startTimeLocal.slice(0, 10);
  const startTimeGmt = new Date(activity.startTimeGMT.endsWith("Z") ? activity.startTimeGMT : `${activity.startTimeGMT}Z`);
  if (!activity.activityId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || Number.isNaN(startTimeGmt.getTime())) {
    throw new Error("Garmin returned an activity with invalid identity or timestamps");
  }

  return {
    providerActivityId: String(activity.activityId),
    activityName: activity.activityName?.trim() || "Garmin run",
    activityType: activity.activityType?.typeKey ?? "running",
    localDate,
    startTimeLocal: activity.startTimeLocal,
    startTimeGmt,
    distanceMeters: Math.max(0, Math.round(activity.distance ?? 0)),
    durationSeconds: Math.max(0, Math.round(activity.duration ?? 0)),
    movingDurationSeconds: nullableRounded(activity.movingDuration),
    elevationGainMeters: nullableRounded(activity.elevationGain),
    averageHeartRate: nullableRounded(activity.averageHR),
    maxHeartRate: nullableRounded(activity.maxHR),
    averageCadence: nullableRounded(activity.averageRunningCadenceInStepsPerMinute),
    averagePower: nullableRounded(activity.avgPower),
    calories: nullableRounded(activity.calories),
    deviceName: activity.manufacturer?.trim() || null,
  };
}

function workoutDistance(workout: Workout): number {
  return workout.weeklyMileageContribution || workout.totalDistance || 0;
}

export function matchActivityToPlan(
  activity: Pick<NormalizedGarminActivity, "localDate" | "distanceMeters">,
  plan: MarathonPlan,
  claimedWorkoutIds: ReadonlySet<string> = new Set()
): ActivityMatch | null {
  const day = plan.weeks
    .flatMap((week) => week.days.map((candidate) => ({ week, day: candidate })))
    .find(({ day: candidate }) => candidate.date.slice(0, 10) === activity.localDate);
  if (!day) return null;

  const workouts = [day.day.workout, day.day.secondaryWorkout]
    .filter((workout): workout is Workout => Boolean(workout))
    .filter((workout) => !claimedWorkoutIds.has(workout.id));
  if (workouts.length === 0) return null;

  const distanceMiles = activity.distanceMeters / 1609.344;
  const workout = workouts.reduce((nearest, candidate) =>
    Math.abs(workoutDistance(candidate) - distanceMiles) < Math.abs(workoutDistance(nearest) - distanceMiles)
      ? candidate
      : nearest
  );
  const plannedMiles = workoutDistance(workout);
  const difference = Math.abs(plannedMiles - distanceMiles);
  const differenceRatio = plannedMiles > 0 ? difference / plannedMiles : 1;

  return {
    planId: plan.id,
    weekNumber: day.week.weekNumber,
    dayOfWeek: day.day.dayOfWeek,
    plannedWorkoutId: workout.id,
    matchConfidence: differenceRatio <= 0.1 ? "high" : differenceRatio <= 0.25 ? "medium" : "low",
  };
}
