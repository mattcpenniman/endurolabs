// ============================================================
// EnduroLab — Plan Diff Builder
// ============================================================
// Produces structured future-only diffs between current and
// proposed weekly plans, preserving completed days.
// ============================================================

import type { DailyPlan, WeeklyPlan } from '@/lib/training/models';

export interface DayDiff {
  weekNumber: number;
  date: string;
  field: string;
  before: unknown;
  after: unknown;
}

interface WeekSummary {
  weekNumber: number;
  phase: string;
  mileageBefore: number;
  mileageAfter: number;
  longRunBefore: number;
  longRunAfter: number;
  dayDiffs: DayDiff[];
}

function workoutId(workout: { id: string } | null): string | null {
  return workout?.id ?? null;
}

function computeDayDiffs(before: DailyPlan, after: DailyPlan, weekNumber: number): DayDiff[] {
  const diffs: DayDiff[] = [];

  const beforePrimary = before.workout ?? null;
  const afterPrimary = after.workout ?? null;
  if (workoutId(beforePrimary) !== workoutId(afterPrimary)) {
    diffs.push({
      weekNumber,
      date: before.date,
      field: 'primary_workout',
      before: workoutId(beforePrimary),
      after: workoutId(afterPrimary),
    });
  }

  const beforeSecondary = before.secondaryWorkout ?? null;
  const afterSecondary = after.secondaryWorkout ?? null;
  if (workoutId(beforeSecondary) !== workoutId(afterSecondary)) {
    diffs.push({
      weekNumber,
      date: before.date,
      field: 'secondary_workout',
      before: workoutId(beforeSecondary),
      after: workoutId(afterSecondary),
    });
  }

  if (before.plannedMileage !== after.plannedMileage) {
    diffs.push({
      weekNumber,
      date: before.date,
      field: 'planned_mileage',
      before: before.plannedMileage,
      after: after.plannedMileage,
    });
  }

  if (before.isRestDay !== after.isRestDay) {
    diffs.push({
      weekNumber,
      date: before.date,
      field: 'is_rest_day',
      before: before.isRestDay,
      after: after.isRestDay,
    });
  }

  return diffs;
}

function computeWeekDiff(before: WeeklyPlan, after: WeeklyPlan): WeekSummary {
  const dayDiffs: DayDiff[] = [];

  for (let i = 0; i < Math.min(before.days.length, after.days.length); i++) {
    dayDiffs.push(...computeDayDiffs(before.days[i], after.days[i], before.weekNumber));
  }

  if (before.days.length !== after.days.length) {
    dayDiffs.push({
      weekNumber: before.weekNumber,
      date: '',
      field: 'day_count',
      before: before.days.length,
      after: after.days.length,
    });
  }

  return {
    weekNumber: before.weekNumber,
    phase: after.phase,
    mileageBefore: before.totalMileage,
    mileageAfter: after.totalMileage,
    longRunBefore: before.longRunDistance,
    longRunAfter: after.longRunDistance,
    dayDiffs,
  };
}

interface DiffOptions {
  completedWeeks?: number[];
}

/**
 * Compute a structured diff between current and proposed plan.
 * Completed weeks are preserved and excluded from the diff output.
 */
export function computePlanDiff(
  before: WeeklyPlan[],
  after: WeeklyPlan[],
  options: DiffOptions = {},
): WeekSummary[] {
  const diffs: WeekSummary[] = [];

  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (options.completedWeeks?.includes(before[i].weekNumber)) continue;
    diffs.push(computeWeekDiff(before[i], after[i]));
  }

  if (before.length !== after.length) {
    for (let i = before.length; i < after.length; i++) {
      diffs.push({
        weekNumber: after[i].weekNumber,
        phase: after[i].phase,
        mileageBefore: 0,
        mileageAfter: after[i].totalMileage,
        longRunBefore: 0,
        longRunAfter: after[i].longRunDistance,
        dayDiffs: [{
          weekNumber: after[i].weekNumber,
          date: '',
          field: 'added_week',
          before: null,
          after: `Week ${after[i].weekNumber} added`,
        }],
      });
    }
  }

  return diffs.filter(d => d.dayDiffs.length > 0 || d.mileageBefore !== d.mileageAfter);
}

/**
 * Determine which weeks are fully completed based on today's date.
 */
export function identifyCompletedWeeks(weeklyPlans: readonly WeeklyPlan[], asOfDate: string): number[] {
  const completed: number[] = [];
  const cutoff = new Date(asOfDate).getTime();

  for (const week of weeklyPlans) {
    const end = new Date(week.endDate).getTime();
    if (end < cutoff) {
      completed.push(week.weekNumber);
    }
  }

  return completed;
}
