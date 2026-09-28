// ============================================================
// EnduroLab — Goal Marathon Scorecard
// ============================================================
// Objective readiness checks for a goal marathon attempt.
// Standards are resolved from the plan's goal time and pace zones
// so one card can score any goal; sub-3 is the curated preset.
// Scores are intentionally conservative when data is not tracked.
// ============================================================

import {
  DailyLog,
  MarathonPlan,
  PaceZones,
  WeeklyPlan,
  Workout,
  formatPace,
  formatTime,
  minutesToTime,
} from "./models";
import { recommendedPeakMileage } from "./goal-assessment";

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

export interface GoalScorecard {
  standards: ScorecardStandards;
  plan: ScorecardSummary;
  actual: ScorecardSummary;
  rows: ScorecardRow[];
}

/**
 * Numeric thresholds behind every scorecard row. The sub-3 preset
 * carries the curated standards; other goals derive theirs from the
 * plan's goal time and pace zones (see deriveScorecardStandards).
 */
export interface ScorecardStandards {
  /** Display label, e.g. "Sub-3" or "Sub-3:30". */
  label: string;
  /** Goal marathon time, minutes. */
  goalTimeMinutes: number;
  /** Goal marathon pace, min/mile. */
  marathonPace: number;
  /** Slowest pace that still counts as a goal-pace workout, min/mile. */
  marathonWorkoutPaceMax: number;
  /** Long-run marathon-pace finish window, min/mile. */
  longRunFinishPaceMin: number;
  longRunFinishPaceMax: number;
  /** Continuous threshold tempo window, min/mile. */
  tempoPaceMin: number;
  tempoPaceMax: number;
  /** Cruise-interval window, min/mile. */
  cruisePaceMin: number;
  cruisePaceMax: number;
  /** Mileage a peak week must reach. */
  peakWeekMileage: number;
  /** Peak weeks required in the cycle. */
  peakWeekCount: number;
  /** Final-12-week average mileage a base block must hold. */
  averageWeekMileage: number;
  /** Long-run distance window, miles. */
  longRunMilesMin: number;
  longRunMilesMax: number;
  longRunCount: number;
  /** Long-run quality window, miles. */
  longRunFinishMilesMin: number;
  longRunFinishMilesMax: number;
  longRunFinishCount: number;
  /** Medium-long run window, miles. */
  mediumLongMilesMin: number;
  mediumLongMilesMax: number;
  /** Race-result equivalents of the goal, minutes. */
  halfMarathonMinutes: number;
  tenKMinutes: number;
  fiveKMinutes: number;
}

const MARATHON_MILES = 26.2;
const TEN_K_MILES = 6.21371;
const FIVE_K_MILES = 3.10686;
// Standard Riegel endurance exponent for race-time equivalents.
const RIEGEL_EXPONENT = 1.06;
// Paces inside this tolerance of the plan's own zone still count as on-target.
const PACE_TOLERANCE = 3 / 60;
const TEMPO_WINDOW = 5 / 60;
const CRUISE_WINDOW = 10 / 60;
const LONG_RUN_FINISH_WINDOW = 8 / 60;
// A goal within half a minute of 3:00 uses the curated sub-3 preset.
const SUB3_PRESET_GOAL_MINUTES = 180;
const SUB3_PRESET_TOLERANCE_MINUTES = 0.5;
// The sub-3 preset asks for 65 peak miles and a 50-mile average while the
// generator recommends a 90-mile peak for a sub-3 goal. Slower goals scale
// those same 65/90 and 50/65 ratios down from their own recommended peak.
const SUB3_PEAK_WEEK_MILEAGE = 65;
const SUB3_AVERAGE_WEEK_MILEAGE = 50;
const SUB3_RECOMMENDED_PEAK_MILEAGE = 90;

/**
 * Curated sub-3 standards. This is the preset the scorecard has always
 * scored, kept bit-for-bit so the sub-3 card is unchanged.
 */
export const SUB3_SCORECARD_STANDARDS: ScorecardStandards = {
  label: "Sub-3",
  goalTimeMinutes: SUB3_PRESET_GOAL_MINUTES,
  marathonPace: SUB3_PRESET_GOAL_MINUTES / MARATHON_MILES,
  marathonWorkoutPaceMax: SUB3_PRESET_GOAL_MINUTES / MARATHON_MILES,
  longRunFinishPaceMin: 6 + 52 / 60,
  longRunFinishPaceMax: 7,
  tempoPaceMin: 6 + 20 / 60,
  tempoPaceMax: 6.5,
  cruisePaceMin: 6.25,
  cruisePaceMax: 6 + 25 / 60,
  peakWeekMileage: SUB3_PEAK_WEEK_MILEAGE,
  peakWeekCount: 4,
  averageWeekMileage: SUB3_AVERAGE_WEEK_MILEAGE,
  longRunMilesMin: 18,
  longRunMilesMax: 22,
  longRunCount: 3,
  longRunFinishMilesMin: 6,
  longRunFinishMilesMax: 10,
  longRunFinishCount: 2,
  mediumLongMilesMin: 12,
  mediumLongMilesMax: 15,
  halfMarathonMinutes: 85,
  tenKMinutes: 38.5,
  fiveKMinutes: 18 + 20 / 60,
};

function raceTimeLabel(minutes: number): string {
  return formatTime(minutesToTime(minutes));
}

function goalLabel(goalMinutes: number): string {
  const roundedMinutes = Math.ceil(goalMinutes - 1e-9);
  if (roundedMinutes === SUB3_PRESET_GOAL_MINUTES) return SUB3_SCORECARD_STANDARDS.label;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return `Sub-${hours}:${String(minutes).padStart(2, "0")}`;
}

function riegelMinutes(goalMinutes: number, targetMiles: number): number {
  return goalMinutes * (targetMiles / MARATHON_MILES) ** RIEGEL_EXPONENT;
}

/**
 * Standards for a goal other than sub-3. Training paces come from the
 * plan's own pace zones so the card scores the work the plan schedules;
 * mileage scales from the generator's goal-based recommended peak, and
 * race-result rows use Riegel equivalents of the goal time.
 */
export function deriveScorecardStandards(goalMinutes: number, paceZones: PaceZones): ScorecardStandards {
  const peakWeekMileage = Math.round(
    recommendedPeakMileage(goalMinutes) * (SUB3_PEAK_WEEK_MILEAGE / SUB3_RECOMMENDED_PEAK_MILEAGE)
  );
  const averageWeekMileage = Math.round(
    peakWeekMileage * (SUB3_AVERAGE_WEEK_MILEAGE / SUB3_PEAK_WEEK_MILEAGE)
  );

  return {
    label: goalLabel(goalMinutes),
    goalTimeMinutes: goalMinutes,
    marathonPace: paceZones.marathon,
    marathonWorkoutPaceMax: paceZones.marathon + PACE_TOLERANCE,
    longRunFinishPaceMin: paceZones.marathon - PACE_TOLERANCE,
    longRunFinishPaceMax: paceZones.marathon + LONG_RUN_FINISH_WINDOW,
    tempoPaceMin: paceZones.threshold - TEMPO_WINDOW,
    tempoPaceMax: paceZones.threshold + TEMPO_WINDOW,
    cruisePaceMin: paceZones.threshold - CRUISE_WINDOW,
    cruisePaceMax: paceZones.threshold,
    peakWeekMileage,
    peakWeekCount: 4,
    averageWeekMileage,
    longRunMilesMin: 18,
    longRunMilesMax: 22,
    longRunCount: 3,
    longRunFinishMilesMin: 6,
    longRunFinishMilesMax: 10,
    longRunFinishCount: 2,
    mediumLongMilesMin: 12,
    mediumLongMilesMax: 15,
    halfMarathonMinutes: riegelMinutes(goalMinutes, 13.1),
    tenKMinutes: riegelMinutes(goalMinutes, TEN_K_MILES),
    fiveKMinutes: riegelMinutes(goalMinutes, FIVE_K_MILES),
  };
}

/** Resolves the standards a plan is scored against: sub-3 preset or goal-derived. */
export function scorecardStandardsForPlan(plan: MarathonPlan): ScorecardStandards {
  const goalMinutes = plan.runnerProfile.goalMarathonTime;
  if (Math.abs(goalMinutes - SUB3_PRESET_GOAL_MINUTES) <= SUB3_PRESET_TOLERANCE_MINUTES) {
    return SUB3_SCORECARD_STANDARDS;
  }
  return deriveScorecardStandards(goalMinutes, plan.paceZones);
}

function inRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && value >= min && value <= max;
}

function summarize(score: number, label: string): string {
  if (score >= 13) return `Strong ${label.toLowerCase()} probability`;
  if (score >= 11) return "Borderline but realistic if conditions are good";
  if (score >= 9) return "Likely not ready yet; would need race-day perfection";
  return `${label} is unlikely right now`;
}

function statusFromBoolean(value: boolean): ScoreStatus {
  return value ? "earned" : "missed";
}

function scoreRows(rows: ScorecardRow[], side: "plan" | "actual", label: string): ScorecardSummary {
  const score = rows.filter((row) => row[side].status === "earned").length;
  return {
    score,
    maxScore: rows.length,
    interpretation: summarize(score, label),
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
  return dailyLogs.some(
    (log) => log.completed && (log.plannedWorkoutId === workout.id || log.runId === workout.id)
  );
}

function hasCompletedMatchingWorkout(plan: MarathonPlan, dailyLogs: DailyLog[], predicate: (workout: Workout) => boolean): boolean {
  return workouts(plan).some((workout) => predicate(workout) && completedWorkout(plan, workout, dailyLogs));
}

function longRunActuals(plan: MarathonPlan, dailyLogs: DailyLog[]): number[] {
  return plan.weeks.flatMap((week) => {
    const longRunDay = week.days.find((day) => day.workout?.type === "long");
    if (!longRunDay) return [];
    const longRunWorkoutId = longRunDay.workout?.id;
    if (!longRunWorkoutId) return [];
    const actualMileage = Math.round(
      dailyLogs
        .filter((entry) => entry.weekNumber === week.weekNumber && entry.plannedWorkoutId === longRunWorkoutId)
        .reduce((sum, entry) => sum + entry.actualMileage, 0) * 10
    ) / 10;
    return actualMileage > 0 ? [actualMileage] : [];
  });
}

function hasLongRunWithMarathonFinish(workout: Workout, standards: ScorecardStandards): boolean {
  if (workout.type !== "long") return false;
  const marathonMiles = workout.segments
    .filter(
      (segment) =>
        segment.type === "marathon_pace" &&
        inRange(segment.pace, standards.longRunFinishPaceMin, standards.longRunFinishPaceMax)
    )
    .reduce((sum, segment) => sum + (segment.distance ?? 0), 0);
  return marathonMiles >= standards.longRunFinishMilesMin && marathonMiles <= standards.longRunFinishMilesMax;
}

function hasTempoWorkout(workout: Workout, standards: ScorecardStandards): boolean {
  return workout.segments.some(
    (segment) =>
      segment.type === "threshold" &&
      !segment.repetitions &&
      (segment.distance ?? 0) >= 4 &&
      (segment.distance ?? 0) <= 6 &&
      inRange(segment.pace, standards.tempoPaceMin, standards.tempoPaceMax)
  );
}

function hasCruiseWorkout(workout: Workout, standards: ScorecardStandards): boolean {
  return workout.segments.some(
    (segment) =>
      segment.type === "threshold" &&
      (segment.repetitions ?? 0) >= 3 &&
      (segment.distance ?? 0) >= 2 &&
      inRange(segment.pace, standards.cruisePaceMin, standards.cruisePaceMax)
  );
}

function hasMarathonPaceWorkout(workout: Workout, standards: ScorecardStandards): boolean {
  return workout.segments.some(
    (segment) =>
      segment.type === "marathon_pace" &&
      (segment.distance ?? 0) >= 3 &&
      segment.pace !== undefined &&
      segment.pace <= standards.marathonWorkoutPaceMax
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

export function buildGoalScorecard(
  plan: MarathonPlan,
  dailyLogs: DailyLog[],
  standards: ScorecardStandards = scorecardStandardsForPlan(plan)
): GoalScorecard {
  const allWorkouts = workouts(plan);
  const mileageActuals = weeklyActualMileage(plan, dailyLogs);
  const final12Plan = plan.weeks.slice(-12);
  const final12Actuals = mileageActuals.slice(-12).filter((entry) => entry.actual !== null);
  const buildWeeks = plan.weeks.filter((week) => week.phase === "marathon_build");

  const peakPlanWeeks = plan.weeks.filter((week) => week.totalMileage >= standards.peakWeekMileage).length;
  const peakActualWeeks = mileageActuals.filter((entry) => (entry.actual ?? 0) >= standards.peakWeekMileage).length;
  const final12PlanAverage = final12Plan.reduce((sum, week) => sum + week.totalMileage, 0) / Math.max(1, final12Plan.length);
  const final12ActualAverage =
    final12Actuals.length === 12
      ? final12Actuals.reduce((sum, entry) => sum + (entry.actual ?? 0), 0) / 12
      : null;
  const longRuns = allWorkouts.filter(
    (workout) =>
      workout.type === "long" &&
      workout.totalDistance >= standards.longRunMilesMin &&
      workout.totalDistance <= standards.longRunMilesMax
  ).length;
  const actualLongRuns = longRunActuals(plan, dailyLogs).filter(
    (miles) => miles >= standards.longRunMilesMin && miles <= standards.longRunMilesMax
  ).length;
  const longRunQualityCount = allWorkouts.filter((workout) => hasLongRunWithMarathonFinish(workout, standards)).length;
  const completedLongRunQualityCount = allWorkouts.filter(
    (workout) => hasLongRunWithMarathonFinish(workout, standards) && completedWorkout(plan, workout, dailyLogs)
  ).length;
  const mediumLongBuildWeeks = buildWeeks.filter((week) =>
    week.days.some(
      (day) =>
        day.workout?.type !== "long" &&
        (day.workout?.totalDistance ?? 0) >= standards.mediumLongMilesMin &&
        (day.workout?.totalDistance ?? 0) <= standards.mediumLongMilesMax
    )
  ).length;
  const actualMediumLongBuildWeeks = buildWeeks.filter((week) =>
    week.days.some((day) => {
      if (day.workout?.type === "long") return false;
      const workoutId = day.workout?.id;
      if (!workoutId) return false;
      const actualMileage = dailyLogs
        .filter((entry) => entry.weekNumber === week.weekNumber && entry.plannedWorkoutId === workoutId)
        .reduce((sum, entry) => sum + entry.actualMileage, 0);
      return actualMileage >= standards.mediumLongMilesMin && actualMileage <= standards.mediumLongMilesMax;
    })
  ).length;
  const gapDays = longestCompletedGapDays(plan, dailyLogs);
  const marathonPacePlanned = allWorkouts.some((workout) => hasMarathonPaceWorkout(workout, standards));
  const marathonPaceCompleted = hasCompletedMatchingWorkout(plan, dailyLogs, (workout) =>
    hasMarathonPaceWorkout(workout, standards)
  );
  const halfPR = plan.runnerProfile.currentHalfMarathonPR;

  const rows: ScorecardRow[] = [
    {
      category: "Marathon pace",
      objective: "Goal pace ability",
      standard: `Can hold ${formatPace(standards.marathonPace)}/mile for marathon pace workouts`,
      plan: {
        status: statusFromBoolean(marathonPacePlanned),
        evidence: marathonPacePlanned
          ? `${standards.label} marathon-pace workout scheduled`
          : `No scheduled marathon-pace workout at ${formatPace(standards.marathonWorkoutPaceMax)}/mi or faster`,
      },
      actual: {
        status: statusFromBoolean(marathonPaceCompleted),
        evidence: marathonPaceCompleted
          ? "Completed a qualifying scheduled marathon-pace workout"
          : "No completed qualifying marathon-pace workout logged",
      },
    },
    {
      category: "Weekly mileage",
      objective: "Peak mileage",
      standard: `${standards.peakWeekMileage}+ miles/week for at least ${standards.peakWeekCount} weeks in cycle`,
      plan: { status: statusFromBoolean(peakPlanWeeks >= standards.peakWeekCount), evidence: `${peakPlanWeeks} planned weeks at ${standards.peakWeekMileage}+ miles` },
      actual: { status: statusFromBoolean(peakActualWeeks >= standards.peakWeekCount), evidence: `${peakActualWeeks} logged weeks at ${standards.peakWeekMileage}+ miles` },
    },
    {
      category: "Weekly mileage",
      objective: "Base consistency",
      standard: `Average ${standards.averageWeekMileage}+ miles/week for prior 12 weeks`,
      plan: { status: statusFromBoolean(final12PlanAverage >= standards.averageWeekMileage), evidence: `${Math.round(final12PlanAverage)} planned mi/week average over final 12 weeks` },
      actual: {
        status: final12ActualAverage === null ? "untracked" : statusFromBoolean(final12ActualAverage >= standards.averageWeekMileage),
        evidence: final12ActualAverage === null ? "Need all final 12 weeks logged" : `${Math.round(final12ActualAverage)} logged mi/week average over final 12 weeks`,
      },
    },
    {
      category: "Long run",
      objective: "Long run duration",
      standard: `At least ${standards.longRunCount} runs of ${standards.longRunMilesMin}-${standards.longRunMilesMax} miles`,
      plan: { status: statusFromBoolean(longRuns >= standards.longRunCount), evidence: `${longRuns} planned long runs of ${standards.longRunMilesMin}-${standards.longRunMilesMax} miles` },
      actual: { status: statusFromBoolean(actualLongRuns >= standards.longRunCount), evidence: `${actualLongRuns} logged long runs of ${standards.longRunMilesMin}-${standards.longRunMilesMax} miles` },
    },
    {
      category: "Long run quality",
      objective: "Marathon pace finish",
      standard: `At least ${standards.longRunFinishCount} long runs with ${standards.longRunFinishMilesMin}-${standards.longRunFinishMilesMax} miles at ${formatPace(standards.longRunFinishPaceMin)}-${formatPace(standards.longRunFinishPaceMax)}/mile late in run`,
      plan: {
        status: statusFromBoolean(longRunQualityCount >= standards.longRunFinishCount),
        evidence: `${longRunQualityCount} qualifying planned long runs`,
      },
      actual: {
        status: statusFromBoolean(completedLongRunQualityCount >= standards.longRunFinishCount),
        evidence: `${completedLongRunQualityCount} qualifying completed long runs`,
      },
    },
    {
      category: "Threshold",
      objective: "Tempo pace",
      standard: `Can run 4-6 miles continuously at ${formatPace(standards.tempoPaceMin)}-${formatPace(standards.tempoPaceMax)}/mile`,
      plan: { status: statusFromBoolean(allWorkouts.some((workout) => hasTempoWorkout(workout, standards))), evidence: allWorkouts.some((workout) => hasTempoWorkout(workout, standards)) ? "Qualifying tempo scheduled" : "No qualifying tempo scheduled" },
      actual: { status: statusFromBoolean(hasCompletedMatchingWorkout(plan, dailyLogs, (workout) => hasTempoWorkout(workout, standards))), evidence: hasCompletedMatchingWorkout(plan, dailyLogs, (workout) => hasTempoWorkout(workout, standards)) ? "Qualifying tempo completed" : "No qualifying tempo completion logged" },
    },
    {
      category: "Threshold",
      objective: "Cruise intervals",
      standard: `Can complete 3 x 2 miles at ${formatPace(standards.cruisePaceMin)}-${formatPace(standards.cruisePaceMax)}/mile with short recovery`,
      plan: { status: statusFromBoolean(allWorkouts.some((workout) => hasCruiseWorkout(workout, standards))), evidence: allWorkouts.some((workout) => hasCruiseWorkout(workout, standards)) ? "Qualifying cruise intervals scheduled" : "No qualifying cruise intervals scheduled" },
      actual: { status: statusFromBoolean(hasCompletedMatchingWorkout(plan, dailyLogs, (workout) => hasCruiseWorkout(workout, standards))), evidence: hasCompletedMatchingWorkout(plan, dailyLogs, (workout) => hasCruiseWorkout(workout, standards)) ? "Qualifying cruise intervals completed" : "No qualifying cruise interval completion logged" },
    },
    {
      category: "Half marathon fitness",
      objective: "Race result",
      standard: `Recent half marathon of ${raceTimeLabel(standards.halfMarathonMinutes)} or faster`,
      plan: { status: "untracked", evidence: "Race-result fitness is profile data, not a plan workout" },
      actual: {
        status: halfPR === null ? "untracked" : statusFromBoolean(halfPR <= standards.halfMarathonMinutes),
        evidence: halfPR === null ? "No half marathon result entered" : `Half PR: ${raceTimeLabel(halfPR)}`,
      },
    },
    {
      category: "10K fitness",
      objective: "Race result",
      standard: `Recent 10K of ${raceTimeLabel(standards.tenKMinutes)} or faster`,
      plan: { status: "untracked", evidence: "10K result is not captured in this plan" },
      actual: { status: "untracked", evidence: "10K result is not currently tracked" },
    },
    {
      category: "Speed reserve",
      objective: "5K result",
      standard: `Recent 5K of ${raceTimeLabel(standards.fiveKMinutes)} or faster`,
      plan: { status: "untracked", evidence: "5K result is not captured in this plan" },
      actual: { status: "untracked", evidence: "5K result is not currently tracked" },
    },
    {
      category: "Aerobic durability",
      objective: "Medium long run",
      standard: `Weekly ${standards.mediumLongMilesMin}-${standards.mediumLongMilesMax} mile medium long run during build`,
      plan: { status: statusFromBoolean(mediumLongBuildWeeks >= Math.max(1, buildWeeks.length - 1)), evidence: `${mediumLongBuildWeeks}/${buildWeeks.length} build weeks include a ${standards.mediumLongMilesMin}-${standards.mediumLongMilesMax} mile medium long run` },
      actual: { status: statusFromBoolean(actualMediumLongBuildWeeks >= Math.max(1, buildWeeks.length - 1)), evidence: `${actualMediumLongBuildWeeks}/${buildWeeks.length} build weeks logged a ${standards.mediumLongMilesMin}-${standards.mediumLongMilesMax} mile medium long run` },
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
    standards,
    plan: scoreRows(rows, "plan", standards.label),
    actual: scoreRows(rows, "actual", standards.label),
    rows,
  };
}