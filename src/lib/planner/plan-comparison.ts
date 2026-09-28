// ============================================================
// EnduroLab — Plan Comparison
// ============================================================
// Pure summaries of planned training load and a stable,
// side-by-side comparison between two stored plans. Used by the
// plan:compare CLI; no database or UI dependencies.
// ============================================================

import type { MarathonPlan, WeeklyPlan, Workout } from '@/lib/training/models';

export interface PlanTrainingSummary {
  planId: string;
  raceName: string | null;
  raceDate: string;
  goalMinutes: number | null;
  marathonPace: number | null;
  totalWeeks: number;
  startDate: string;
  endDate: string;
  totalMileage: number;
  peakWeeklyMileage: number;
  weeksAtOrAbove85PercentOfPeak: number;
  weeksAtOrAbove90PercentOfPeak: number;
  downWeeks: number;
  longRunMax: number;
  longRunsAtLeast16: number;
  longRunsAtLeast18: number;
  longRunsAtLeast20: number;
  thresholdMiles: number;
  marathonPaceMiles: number;
  marathonPaceMidweekMiles: number;
  marathonPaceLongRunMiles: number;
  vo2Miles: number;
  weeksWithThreshold: number;
  weeksWithMarathonPace: number;
  weeksWithMarathonPaceLongRun: number;
  taperWeeks: number;
  taperReductionPercent: number | null;
}

export type ComparisonUnit = 'count' | 'miles' | 'minutes' | 'pace' | 'percent';

export interface PlanComparisonMetric {
  id: string;
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  deltaPercent: number | null;
  unit: ComparisonUnit;
}

export interface PlanComparison {
  before: PlanTrainingSummary;
  after: PlanTrainingSummary;
  metrics: PlanComparisonMetric[];
}

function segmentMiles(segment: { distance?: number; repetitions?: number }): number {
  return (segment.distance ?? 0) * (segment.repetitions ?? 1);
}

function workoutsFor(week: WeeklyPlan): Workout[] {
  return week.days
    .flatMap((day) => [day.workout, day.secondaryWorkout ?? null])
    .filter((workout): workout is Workout => workout != null && workout.type !== 'race');
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Summarize the planned training load of a marathon plan: volume,
 * time spent near peak, long-run exposure, specific work, recovery,
 * and taper. Deterministic for a fixed plan.
 */
export function summarizePlanTraining(plan: MarathonPlan): PlanTrainingSummary {
  const weeks = plan.weeks;
  const peak = plan.peakWeeklyMileage;

  let thresholdMiles = 0;
  let marathonPaceMiles = 0;
  let marathonPaceMidweekMiles = 0;
  let marathonPaceLongRunMiles = 0;
  let vo2Miles = 0;
  let weeksWithThreshold = 0;
  let weeksWithMarathonPace = 0;
  let weeksWithMarathonPaceLongRun = 0;

  for (const week of weeks) {
    let hasThreshold = false;
    let hasMarathonPace = false;
    let hasMarathonPaceLongRun = false;

    for (const workout of workoutsFor(week)) {
      for (const segment of workout.segments ?? []) {
        const miles = segmentMiles(segment);
        if (segment.type === 'threshold') {
          thresholdMiles += miles;
          hasThreshold = true;
        } else if (segment.type === 'marathon_pace') {
          marathonPaceMiles += miles;
          hasMarathonPace = true;
          if (workout.type === 'long') {
            marathonPaceLongRunMiles += miles;
            hasMarathonPaceLongRun = true;
          } else {
            marathonPaceMidweekMiles += miles;
          }
        } else if (segment.type === 'vo2') {
          vo2Miles += miles;
        }
      }
    }

    if (hasThreshold) weeksWithThreshold++;
    if (hasMarathonPace) weeksWithMarathonPace++;
    if (hasMarathonPaceLongRun) weeksWithMarathonPaceLongRun++;
  }

  const longRuns = weeks.map((week) => week.longRunDistance);
  const taperWeeks = weeks.filter((week) => week.phase === 'peak_taper');
  const preTaperWeeks = weeks.filter((week) => week.phase !== 'peak_taper');
  const taperAverage = average(taperWeeks.map((week) => week.totalMileage));
  const preTaperAverage = average(preTaperWeeks.map((week) => week.totalMileage));

  return {
    planId: plan.id,
    raceName: plan.runnerProfile.raceName ?? null,
    raceDate: plan.raceDay,
    goalMinutes: plan.runnerProfile.goalMarathonTime ?? null,
    marathonPace: plan.paceZones?.marathon ?? null,
    totalWeeks: plan.totalWeeks,
    startDate: weeks[0]?.startDate ?? '',
    endDate: weeks[weeks.length - 1]?.endDate ?? '',
    totalMileage: Math.round(weeks.reduce((sum, week) => sum + week.totalMileage, 0)),
    peakWeeklyMileage: peak,
    weeksAtOrAbove85PercentOfPeak: weeks.filter((week) => week.totalMileage >= peak * 0.85).length,
    weeksAtOrAbove90PercentOfPeak: weeks.filter((week) => week.totalMileage >= peak * 0.9).length,
    downWeeks: weeks.filter((week) => week.isDownWeek).length,
    longRunMax: Math.max(0, ...longRuns),
    longRunsAtLeast16: longRuns.filter((miles) => miles >= 16).length,
    longRunsAtLeast18: longRuns.filter((miles) => miles >= 18).length,
    longRunsAtLeast20: longRuns.filter((miles) => miles >= 20).length,
    thresholdMiles: Math.round(thresholdMiles * 10) / 10,
    marathonPaceMiles: Math.round(marathonPaceMiles * 10) / 10,
    marathonPaceMidweekMiles: Math.round(marathonPaceMidweekMiles * 10) / 10,
    marathonPaceLongRunMiles: Math.round(marathonPaceLongRunMiles * 10) / 10,
    vo2Miles: Math.round(vo2Miles * 10) / 10,
    weeksWithThreshold,
    weeksWithMarathonPace,
    weeksWithMarathonPaceLongRun,
    taperWeeks: taperWeeks.length,
    taperReductionPercent:
      taperAverage != null && preTaperAverage != null && preTaperAverage > 0
        ? Math.round((1 - taperAverage / preTaperAverage) * 1000) / 10
        : null,
  };
}

function metric(
  id: string,
  label: string,
  unit: ComparisonUnit,
  before: number | null,
  after: number | null,
): PlanComparisonMetric {
  const delta = before != null && after != null ? after - before : null;
  const deltaPercent = delta != null && before ? Math.round((delta / before) * 1000) / 10 : null;
  return { id, label, before, after, delta, deltaPercent, unit };
}

/**
 * Compare two plans in fixed metric order, newest plan as `after`.
 * `delta` is after - before.
 */
export function comparePlanTraining(before: MarathonPlan, after: MarathonPlan): PlanComparison {
  const beforeSummary = summarizePlanTraining(before);
  const afterSummary = summarizePlanTraining(after);

  const metrics: PlanComparisonMetric[] = [
    metric('totalWeeks', 'Weeks', 'count', beforeSummary.totalWeeks, afterSummary.totalWeeks),
    metric('totalMileage', 'Total planned miles', 'miles', beforeSummary.totalMileage, afterSummary.totalMileage),
    metric('peakWeeklyMileage', 'Peak weekly miles', 'miles', beforeSummary.peakWeeklyMileage, afterSummary.peakWeeklyMileage),
    metric('weeksAtOrAbove85PercentOfPeak', 'Weeks >= 85% of peak', 'count', beforeSummary.weeksAtOrAbove85PercentOfPeak, afterSummary.weeksAtOrAbove85PercentOfPeak),
    metric('weeksAtOrAbove90PercentOfPeak', 'Weeks >= 90% of peak', 'count', beforeSummary.weeksAtOrAbove90PercentOfPeak, afterSummary.weeksAtOrAbove90PercentOfPeak),
    metric('downWeeks', 'Down weeks', 'count', beforeSummary.downWeeks, afterSummary.downWeeks),
    metric('longRunMax', 'Longest run', 'miles', beforeSummary.longRunMax, afterSummary.longRunMax),
    metric('longRunsAtLeast18', 'Long runs >= 18 mi', 'count', beforeSummary.longRunsAtLeast18, afterSummary.longRunsAtLeast18),
    metric('longRunsAtLeast20', 'Long runs >= 20 mi', 'count', beforeSummary.longRunsAtLeast20, afterSummary.longRunsAtLeast20),
    metric('thresholdMiles', 'Threshold miles', 'miles', beforeSummary.thresholdMiles, afterSummary.thresholdMiles),
    metric('marathonPaceMiles', 'Marathon-pace miles', 'miles', beforeSummary.marathonPaceMiles, afterSummary.marathonPaceMiles),
    metric('marathonPaceLongRunMiles', 'Marathon pace in long runs', 'miles', beforeSummary.marathonPaceLongRunMiles, afterSummary.marathonPaceLongRunMiles),
    metric('weeksWithThreshold', 'Weeks with threshold work', 'count', beforeSummary.weeksWithThreshold, afterSummary.weeksWithThreshold),
    metric('weeksWithMarathonPace', 'Weeks with marathon-pace work', 'count', beforeSummary.weeksWithMarathonPace, afterSummary.weeksWithMarathonPace),
    metric('vo2Miles', 'VO2 miles', 'miles', beforeSummary.vo2Miles, afterSummary.vo2Miles),
    metric('taperReductionPercent', 'Taper volume reduction', 'percent', beforeSummary.taperReductionPercent, afterSummary.taperReductionPercent),
    metric('goalMinutes', 'Goal time', 'minutes', beforeSummary.goalMinutes, afterSummary.goalMinutes),
    metric('marathonPace', 'Marathon pace', 'pace', beforeSummary.marathonPace, afterSummary.marathonPace),
  ];

  return { before: beforeSummary, after: afterSummary, metrics };
}