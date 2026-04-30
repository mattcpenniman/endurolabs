// ============================================================
// EnduroLab — Sub-3 Marathon Scorecard
// ============================================================
// Objective readiness checks for a sub-3 marathon attempt.
// Scores are intentionally conservative when data is not tracked.
// ============================================================

import { DailyLog, MarathonPlan, WeeklyPlan, Workout } from "./models";

export type ScoreStatus = "earned" | "missed" | "untracked";

export interface ScorecardRow {
  category: string;
  objective: string;
  standard: string;
  plan: {
    status: ScoreStatus;
    evidence: string;
  };
  actual: {
    status: ScoreStatus;
    evidence: string;
  };
}

export interface ScorecardSummary {
  score: number;
  maxScore: number;
  interpretation: string;
}

export interface Sub3Scorecard {
  plan: ScorecardSummary;
  actual: ScorecardSummary;
  rows: ScorecardRow[];
}

const SUB3_PACE = 180 / 26.2;
const MARATHON_PACE_MIN = 6 + 52 / 60;
const MARATHON_PACE_MAX = 7;
const TEMPO_MIN = 6 + 20 / 60;
const TEMPO_MAX = 6.5;
const CRUISE_MIN = 6.25;
const CRUISE_MAX = 6 + 25 / 60;

function inRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && value >= min && value <= max;
}

function summarize(score: number): string {
  if (score >= 13) return "Strong sub-3 probability";
  if (score >= 11) return "Borderline but realistic if conditions are good";
  if (score >= 9) return "Likely not ready yet; would need race-day perfection";
  return "Sub-3 is unlikely right now";
}

function statusFromBoolean(value: boolean): ScoreStatus {
  return value ? "earned" : "missed";
}

function scoreRows(rows: ScorecardRow[], side: "plan" | "actual"): ScorecardSummary {
  const score = rows.filter((row) => row[side].status === "earned").length;
  return {
    score,
    maxScore: rows.length,
    interpretation: summarize(score),
  };
}

function workouts(plan: MarathonPlan): Workout[] {
  return plan.weeks.flatMap((week) =>
    week.days.flatMap((day) => [
      ...(day.workout ? [day.workout] : []),
      ...(day.secondaryWorkout ? [day.secondaryWorkout] : []),
    ])
  );
}

function weeklyActualMileage(plan: MarathonPlan, dailyLogs: DailyLog[]): Array<{ week: WeeklyPlan; actual: number | null }> {
  return plan.weeks.map((week) => {
    const logs = dailyLogs.filter((log) => log.weekNumber === week.weekNumber);
    return {
      week,
      actual: logs.length > 0 ? Math.round(logs.reduce((sum, log) => sum + log.actualMileage, 0) * 10) / 10 : null,
    };
  });
}

function completedWorkout(plan: MarathonPlan, workout: Workout, dailyLogs: DailyLog[]): boolean {
  const day = plan.weeks
    .flatMap((week) => week.days)
    .find((dailyPlan) => dailyPlan.workout?.id === workout.id || dailyPlan.secondaryWorkout?.id === workout.id);

  if (!day) return false;
  return dailyLogs.some((log) => log.weekNumber === plan.weeks.find((week) => week.days.includes(day))?.weekNumber && log.dayOfWeek === day.dayOfWeek && log.completed);
}

function hasCompletedMatchingWorkout(plan: MarathonPlan, dailyLogs: DailyLog[], predicate: (workout: Workout) => boolean): boolean {
  return workouts(plan).some((workout) => predicate(workout) && completedWorkout(plan, workout, dailyLogs));
}

function longRunActuals(plan: MarathonPlan, dailyLogs: DailyLog[]): number[] {
  return plan.weeks.flatMap((week) => {
    const longRunDay = week.days.find((day) => day.workout?.type === "long");
    if (!longRunDay) return [];
    const log = dailyLogs.find((entry) => entry.weekNumber === week.weekNumber && entry.dayOfWeek === longRunDay.dayOfWeek);
    return log ? [log.actualMileage] : [];
  });
}

function hasLongRunWithMarathonFinish(workout: Workout): boolean {
  if (workout.type !== "long") return false;
  const marathonMiles = workout.segments
    .filter((segment) => segment.type === "marathon_pace" && inRange(segment.pace, MARATHON_PACE_MIN, MARATHON_PACE_MAX))
    .reduce((sum, segment) => sum + (segment.distance ?? 0), 0);
  return marathonMiles >= 6 && marathonMiles <= 10;
}

function hasTempoWorkout(workout: Workout): boolean {
  return workout.segments.some(
    (segment) =>
      segment.type === "threshold" &&
      !segment.repetitions &&
      (segment.distance ?? 0) >= 4 &&
      (segment.distance ?? 0) <= 6 &&
      inRange(segment.pace, TEMPO_MIN, TEMPO_MAX)
  );
}

function hasCruiseWorkout(workout: Workout): boolean {
  return workout.segments.some(
    (segment) =>
      segment.type === "threshold" &&
      (segment.repetitions ?? 0) >= 3 &&
      (segment.distance ?? 0) >= 2 &&
      inRange(segment.pace, CRUISE_MIN, CRUISE_MAX)
  );
}

function hasMarathonPaceWorkout(workout: Workout): boolean {
  return workout.segments.some(
    (segment) =>
      segment.type === "marathon_pace" &&
      (segment.distance ?? 0) >= 3 &&
      segment.pace !== undefined &&
      segment.pace <= SUB3_PACE
  );
}

function longestCompletedGapDays(plan: MarathonPlan, dailyLogs: DailyLog[]): number | null {
  const finalWeeks = plan.weeks.slice(-12);
  const completedDates = dailyLogs
    .filter((log) => finalWeeks.some((week) => week.weekNumber === log.weekNumber) && log.completed)
    .map((log) => new Date(log.date).getTime())
    .sort((a, b) => a - b);

  if (completedDates.length < 2) return null;

  let longestGap = 0;
  for (let i = 1; i < completedDates.length; i++) {
    const gapDays = (completedDates[i] - completedDates[i - 1]) / (1000 * 60 * 60 * 24);
    longestGap = Math.max(longestGap, gapDays);
  }
  return longestGap;
}

export function buildSub3Scorecard(plan: MarathonPlan, dailyLogs: DailyLog[]): Sub3Scorecard {
  const allWorkouts = workouts(plan);
  const mileageActuals = weeklyActualMileage(plan, dailyLogs);
  const final12Plan = plan.weeks.slice(-12);
  const final12Actuals = mileageActuals.slice(-12).filter((entry) => entry.actual !== null);
  const buildWeeks = plan.weeks.filter((week) => week.phase === "marathon_build");

  const peakPlanWeeks = plan.weeks.filter((week) => week.totalMileage >= 65).length;
  const peakActualWeeks = mileageActuals.filter((entry) => (entry.actual ?? 0) >= 65).length;
  const final12PlanAverage = final12Plan.reduce((sum, week) => sum + week.totalMileage, 0) / Math.max(1, final12Plan.length);
  const final12ActualAverage =
    final12Actuals.length === 12
      ? final12Actuals.reduce((sum, entry) => sum + (entry.actual ?? 0), 0) / 12
      : null;
  const longRuns18To22 = allWorkouts.filter((workout) => workout.type === "long" && workout.totalDistance >= 18 && workout.totalDistance <= 22).length;
  const actualLongRuns18To22 = longRunActuals(plan, dailyLogs).filter((miles) => miles >= 18 && miles <= 22).length;
  const mediumLongBuildWeeks = buildWeeks.filter((week) =>
    week.days.some((day) => day.workout?.type !== "long" && (day.workout?.totalDistance ?? 0) >= 12 && (day.workout?.totalDistance ?? 0) <= 15)
  ).length;
  const actualMediumLongBuildWeeks = buildWeeks.filter((week) =>
    week.days.some((day) => {
      if (day.workout?.type === "long") return false;
      const log = dailyLogs.find((entry) => entry.weekNumber === week.weekNumber && entry.dayOfWeek === day.dayOfWeek);
      return log !== undefined && log.actualMileage >= 12 && log.actualMileage <= 15;
    })
  ).length;
  const gapDays = longestCompletedGapDays(plan, dailyLogs);

  const rows: ScorecardRow[] = [
    {
      category: "Marathon pace",
      objective: "Goal pace ability",
      standard: "Can hold 6:52/mile for marathon pace workouts",
      plan: {
        status: statusFromBoolean(allWorkouts.some(hasMarathonPaceWorkout)),
        evidence: allWorkouts.some(hasMarathonPaceWorkout) ? "Sub-3 marathon-pace workout scheduled" : "No scheduled marathon-pace workout at 6:52/mi or faster",
      },
      actual: {
        status: statusFromBoolean(hasCompletedMatchingWorkout(plan, dailyLogs, hasMarathonPaceWorkout)),
        evidence: hasCompletedMatchingWorkout(plan, dailyLogs, hasMarathonPaceWorkout)
          ? "Completed a qualifying scheduled marathon-pace workout"
          : "No completed qualifying marathon-pace workout logged",
      },
    },
    {
      category: "Weekly mileage",
      objective: "Peak mileage",
      standard: "65+ miles/week for at least 4 weeks in cycle",
      plan: { status: statusFromBoolean(peakPlanWeeks >= 4), evidence: `${peakPlanWeeks} planned weeks at 65+ miles` },
      actual: { status: statusFromBoolean(peakActualWeeks >= 4), evidence: `${peakActualWeeks} logged weeks at 65+ miles` },
    },
    {
      category: "Weekly mileage",
      objective: "Base consistency",
      standard: "Average 50+ miles/week for prior 12 weeks",
      plan: { status: statusFromBoolean(final12PlanAverage >= 50), evidence: `${Math.round(final12PlanAverage)} planned mi/week average over final 12 weeks` },
      actual: {
        status: final12ActualAverage === null ? "untracked" : statusFromBoolean(final12ActualAverage >= 50),
        evidence: final12ActualAverage === null ? "Need all final 12 weeks logged" : `${Math.round(final12ActualAverage)} logged mi/week average over final 12 weeks`,
      },
    },
    {
      category: "Long run",
      objective: "Long run duration",
      standard: "At least 3 runs of 18-22 miles",
      plan: { status: statusFromBoolean(longRuns18To22 >= 3), evidence: `${longRuns18To22} planned long runs of 18-22 miles` },
      actual: { status: statusFromBoolean(actualLongRuns18To22 >= 3), evidence: `${actualLongRuns18To22} logged long runs of 18-22 miles` },
    },
    {
      category: "Long run quality",
      objective: "Marathon pace finish",
      standard: "At least 2 long runs with 6-10 miles at 6:52-7:00/mile late in run",
      plan: {
        status: statusFromBoolean(allWorkouts.filter(hasLongRunWithMarathonFinish).length >= 2),
        evidence: `${allWorkouts.filter(hasLongRunWithMarathonFinish).length} qualifying planned long runs`,
      },
      actual: {
        status: statusFromBoolean(allWorkouts.filter((workout) => hasLongRunWithMarathonFinish(workout) && completedWorkout(plan, workout, dailyLogs)).length >= 2),
        evidence: `${allWorkouts.filter((workout) => hasLongRunWithMarathonFinish(workout) && completedWorkout(plan, workout, dailyLogs)).length} qualifying completed long runs`,
      },
    },
    {
      category: "Threshold",
      objective: "Tempo pace",
      standard: "Can run 4-6 miles continuously at 6:20-6:30/mile",
      plan: { status: statusFromBoolean(allWorkouts.some(hasTempoWorkout)), evidence: allWorkouts.some(hasTempoWorkout) ? "Qualifying tempo scheduled" : "No qualifying tempo scheduled" },
      actual: { status: statusFromBoolean(hasCompletedMatchingWorkout(plan, dailyLogs, hasTempoWorkout)), evidence: hasCompletedMatchingWorkout(plan, dailyLogs, hasTempoWorkout) ? "Qualifying tempo completed" : "No qualifying tempo completion logged" },
    },
    {
      category: "Threshold",
      objective: "Cruise intervals",
      standard: "Can complete 3 x 2 miles at 6:15-6:25/mile with short recovery",
      plan: { status: statusFromBoolean(allWorkouts.some(hasCruiseWorkout)), evidence: allWorkouts.some(hasCruiseWorkout) ? "Qualifying cruise intervals scheduled" : "No qualifying cruise intervals scheduled" },
      actual: { status: statusFromBoolean(hasCompletedMatchingWorkout(plan, dailyLogs, hasCruiseWorkout)), evidence: hasCompletedMatchingWorkout(plan, dailyLogs, hasCruiseWorkout) ? "Qualifying cruise intervals completed" : "No qualifying cruise interval completion logged" },
    },
    {
      category: "Half marathon fitness",
      objective: "Race result",
      standard: "Recent half marathon of 1:25:00 or faster",
      plan: { status: "untracked", evidence: "Race-result fitness is profile data, not a plan workout" },
      actual: {
        status: plan.runnerProfile.currentHalfMarathonPR === null ? "untracked" : statusFromBoolean(plan.runnerProfile.currentHalfMarathonPR <= 85),
        evidence: plan.runnerProfile.currentHalfMarathonPR === null ? "No half marathon result entered" : `Half PR: ${plan.runnerProfile.currentHalfMarathonPR} minutes`,
      },
    },
    {
      category: "10K fitness",
      objective: "Race result",
      standard: "Recent 10K of 38:30 or faster",
      plan: { status: "untracked", evidence: "10K result is not captured in this plan" },
      actual: { status: "untracked", evidence: "10K result is not currently tracked" },
    },
    {
      category: "Speed reserve",
      objective: "5K result",
      standard: "Recent 5K of 18:20 or faster",
      plan: { status: "untracked", evidence: "5K result is not captured in this plan" },
      actual: { status: "untracked", evidence: "5K result is not currently tracked" },
    },
    {
      category: "Aerobic durability",
      objective: "Medium long run",
      standard: "Weekly 12-15 mile medium long run during build",
      plan: { status: statusFromBoolean(mediumLongBuildWeeks >= Math.max(1, buildWeeks.length - 1)), evidence: `${mediumLongBuildWeeks}/${buildWeeks.length} build weeks include a 12-15 mile medium long run` },
      actual: { status: statusFromBoolean(actualMediumLongBuildWeeks >= Math.max(1, buildWeeks.length - 1)), evidence: `${actualMediumLongBuildWeeks}/${buildWeeks.length} build weeks logged a 12-15 mile medium long run` },
    },
    {
      category: "Fueling",
      objective: "Carb intake",
      standard: "Can tolerate 60-90g carbs/hour in long runs",
      plan: { status: "untracked", evidence: "Fueling tolerance is not scheduled quantitatively" },
      actual: { status: "untracked", evidence: "Carb intake is not currently logged" },
    },
    {
      category: "Pacing control",
      objective: "Even pacing",
      standard: "In marathon-pace workouts, pace drift stays within about +/-5 sec/mile",
      plan: { status: "untracked", evidence: "Pace drift requires split data" },
      actual: { status: "untracked", evidence: "Workout split drift is not currently logged" },
    },
    {
      category: "Durability",
      objective: "Injury consistency",
      standard: "No training interruption longer than 7 days in final 12 weeks",
      plan: { status: statusFromBoolean(!plan.riskWarnings.some((warning) => warning.toLowerCase().includes("injury"))), evidence: "Plan has no scheduled training interruption" },
      actual: {
        status: gapDays === null ? "untracked" : statusFromBoolean(gapDays <= 7),
        evidence: gapDays === null ? "Need completed workout logs in final 12 weeks" : `Longest completed-training gap: ${Math.round(gapDays)} days`,
      },
    },
    {
      category: "Recovery",
      objective: "Sleep",
      standard: "Averaging 7.5+ hours/night during training block",
      plan: { status: "untracked", evidence: "Sleep is not part of the generated plan" },
      actual: { status: "untracked", evidence: "Sleep is not currently logged" },
    },
  ];

  return {
    plan: scoreRows(rows, "plan"),
    actual: scoreRows(rows, "actual"),
    rows,
  };
}
