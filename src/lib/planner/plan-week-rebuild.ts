// ============================================================
// EnduroLab — Plan Week Rebuild
// ============================================================
// Regenerates a single week of a stored plan from the current
// generator while leaving every other week untouched. Used to
// apply generator fixes (for example a corrected race week) to
// a live plan without losing manual alignment, activity matches,
// or run logs.
// ============================================================

import { MarathonPlan, RunnerProfile, WeeklyPlan } from "@/lib/training/models";
import { generatePlan } from "@/lib/training/plan-generator";

export interface PlanWeekRebuildOptions {
  /** 1-based week number to rebuild. Defaults to the final week (race week). */
  weekNumber?: number;
}

export interface PlanWeekRebuildSummary {
  weekNumber: number;
  startDate: string;
  endDate: string;
  previousTotalMileage: number;
  totalMileage: number;
  previousLongRun: number;
  longRunDistance: number;
  isRaceWeek: boolean;
  changed: boolean;
}

export interface PlanWeekRebuildResult {
  plan: MarathonPlan;
  summary: PlanWeekRebuildSummary;
  /** Workout ids that exist in the replaced week; callers must check for references. */
  replacedWorkoutIds: string[];
}

function dateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function workoutIds(week: WeeklyPlan): string[] {
  return week.days.flatMap((day) =>
    [day.workout, day.secondaryWorkout]
      .filter((workout): workout is NonNullable<typeof workout> => Boolean(workout))
      .map((workout) => workout.id)
  );
}

/**
 * Replace one week of `plan` with the current generator's output for that week.
 * The regenerated week must fall on the same start date as the stored week,
 * otherwise the plan was manually realigned and rebuilding would move dates.
 */
export function rebuildPlanWeek(
  plan: MarathonPlan,
  options: PlanWeekRebuildOptions = {}
): PlanWeekRebuildResult {
  const weekNumber = options.weekNumber ?? plan.weeks.length;
  const index = plan.weeks.findIndex((week) => week.weekNumber === weekNumber);
  if (index < 0) throw new Error(`Plan has no week ${weekNumber}`);

  const current = plan.weeks[index];
  const regenerated = generatePlan(plan.runnerProfile as RunnerProfile);
  const replacement = regenerated.weeks.find((week) => week.weekNumber === weekNumber);
  if (!replacement) throw new Error(`Regenerated plan has no week ${weekNumber}`);

  if (dateKey(current.startDate) !== dateKey(replacement.startDate)) {
    throw new Error(
      `Refusing to rebuild week ${weekNumber}: stored week starts ${dateKey(current.startDate)} but the regenerated week starts ${dateKey(replacement.startDate)}`
    );
  }

  const currentIds = workoutIds(current);
  const replacementIds = workoutIds(replacement);
  const weeks = plan.weeks.map((week, weekIndex) => (weekIndex === index ? replacement : week));

  return {
    plan: { ...plan, weeks },
    summary: {
      weekNumber,
      startDate: dateKey(current.startDate),
      endDate: dateKey(current.endDate),
      previousTotalMileage: current.totalMileage,
      totalMileage: replacement.totalMileage,
      previousLongRun: current.longRunDistance,
      longRunDistance: replacement.longRunDistance,
      isRaceWeek: Boolean(replacement.isRaceWeek),
      changed: JSON.stringify(currentIds) !== JSON.stringify(replacementIds),
    },
    replacedWorkoutIds: currentIds,
  };
}
