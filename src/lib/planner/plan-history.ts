/**
 * Goal-directed, read-only comparison of stored marathon cycles.
 * Race-relative 112-day windows make different plan lengths comparable.
 * Historical schedules are mutable context; actual training is observed evidence.
 */

import { buildRaceTrainingFeatures, predictEquivalentRaceSeconds, type RaceAnalysisActivity, type RaceTrainingFeatures } from '@/lib/analytics/race-performance-analysis';
import { summarizePlanTraining, type PlanTrainingSummary } from './plan-comparison';
import type { MarathonPlan } from '@/lib/training/models';

export interface StoredTrainingPlan {
  id: string;
  raceName: string | null;
  plan: MarathonPlan;
}

export interface HistoricalCycle {
  planId: string;
  raceName: string;
  raceDate: string;
  planned: PlanTrainingSummary;
  /** Training workouts only, excluding the target race and post-race runs. */
  plannedFinal16Weeks: RaceTrainingFeatures;
  actualFinal16Weeks: RaceTrainingFeatures;
  result: { id: string; seconds: number; source: string; execution: RaceAnalysisActivity['executionQuality'] } | null;
}

export interface HistoryRecommendation {
  id: string;
  priority: 'high' | 'medium';
  action: string;
  evidence: string[];
  /** Future build weeks to inspect, not an applied workout prescription. */
  candidateWeeks?: number[];
}

export interface PlanHistoryReport {
  version: 'plan-history-v1';
  asOf: string;
  goalMinutes: number;
  goalPaceMinutesPerMile: number;
  halfMarathonEquivalentSeconds: number;
  daysToRace: number;
  current: HistoricalCycle;
  recent: RaceTrainingFeatures;
  cycles: HistoricalCycle[];
  alternatives: HistoricalCycle[];
  bestCycleId: string | null;
  recommendations: HistoryRecommendation[];
  caveats: string[];
}

function eligiblePlan(row: StoredTrainingPlan): boolean {
  return Array.isArray(row.plan.weeks) && row.plan.weeks.every(week => Array.isArray(week.days))
    && /^\d{4}-\d{2}-\d{2}$/.test(row.plan.raceDay ?? '')
    && (row.plan.runnerProfile.raceDistance ?? 'marathon') === 'marathon';
}

function plannedActivities(plan: MarathonPlan): RaceAnalysisActivity[] {
  return plan.weeks.flatMap(week => week.days.flatMap(day =>
    [day.workout, day.secondaryWorkout].flatMap(workout =>
      !workout || workout.type === 'race' || day.isRaceDay ? [] : [{
        id: workout.id, localDate: day.date.slice(0, 10),
        distanceMeters: workout.totalDistance * 1609.344,
        // Duration only makes a scheduled workout eligible for the shared volume builder.
        durationSeconds: Math.max(1, workout.estimatedDuration * 60),
        movingDurationSeconds: null, eventType: null, averageHeartRate: null,
        averagePower: null, calculatedPower: null, elevationGainMeters: null,
        excludedFromAnalytics: false,
      }],
    ),
  ));
}

function cycle(row: StoredTrainingPlan, activities: RaceAnalysisActivity[], asOf: string): HistoricalCycle {
  const plan = { ...row.plan, id: row.id };
  const raceDate = plan.raceDay;
  const results = activities.filter(activity => activity.localDate === raceDate && activity.localDate < asOf
    && activity.eventType === 'race' && !activity.excludedFromAnalytics
    && Math.abs(activity.distanceMeters - 42195) / 42195 < 0.05 && activity.durationSeconds > 0)
    .sort((a, b) => Number(b.resultSource === 'canonical') - Number(a.resultSource === 'canonical'));
  const result = results[0];
  return {
    planId: row.id, raceName: row.raceName ?? plan.runnerProfile.raceName ?? 'Unnamed', raceDate,
    planned: summarizePlanTraining(plan),
    plannedFinal16Weeks: buildRaceTrainingFeatures(plannedActivities(plan), raceDate, 112),
    actualFinal16Weeks: buildRaceTrainingFeatures(activities.filter(a => a.localDate < asOf), raceDate, 112),
    result: result ? { id: result.id, seconds: result.durationSeconds,
      source: result.resultSource ?? 'garmin', execution: result.executionQuality ?? null } : null,
  };
}

/** Compare a selected plan with all earlier marathon cycles and same-race drafts. */
export function buildPlanHistory(input: {
  current: StoredTrainingPlan;
  plans: StoredTrainingPlan[];
  activities: RaceAnalysisActivity[];
  asOf: string;
  goalMinutes: number;
}): PlanHistoryReport {
  if (!eligiblePlan(input.current)) throw new Error('Historical comparison requires a complete marathon plan');
  const { asOf, goalMinutes } = input;
  const activities = input.activities.filter(a => a.localDate < asOf);
  const current = cycle(input.current, activities, asOf);
  const others = input.plans.filter(row => row.id !== input.current.id && eligiblePlan(row));
  // One row per historical race date. The selected current plan always remains explicit.
  const byDate = new Map<string, StoredTrainingPlan>();
  for (const row of others) {
    if (row.plan.raceDay < asOf && row.plan.raceDay < current.raceDate && !byDate.has(row.plan.raceDay)) {
      byDate.set(row.plan.raceDay, row);
    }
  }
  const cycles = [...byDate.values()].map(row => cycle(row, activities, asOf))
    .sort((a, b) => a.raceDate.localeCompare(b.raceDate));
  const alternatives = others.filter(row => row.plan.raceDay === current.raceDate).map(row => cycle(row, activities, asOf));
  const best = cycles.filter(row => row.result).sort((a, b) => a.result!.seconds - b.result!.seconds)[0];
  const recent = buildRaceTrainingFeatures(activities, asOf, 112);
  const recommendations: HistoryRecommendation[] = [];
  const planned = current.plannedFinal16Weeks;
  if (best && planned.averageWeeklyMiles < best.actualFinal16Weeks.averageWeeklyMiles * 0.9) {
    recommendations.push({ id: 'sustained-volume', priority: 'high',
      action: 'Review sustained build volume against your fastest cycle; progress from recent actual mileage, preserve down weeks, and increase easy mileage before adding intensity.',
      evidence: [`Current final-16-week schedule: ${planned.averageWeeklyMiles} mi/week; fastest cycle (${best.raceName}) actual: ${best.actualFinal16Weeks.averageWeeklyMiles} mi/week.`,
        `Recent 28-day average: ${(recent.milesLast28Days / 4).toFixed(1)} mi/week. A historical peak is not an immediate mileage target.`] });
  }
  if (best && planned.runsAtLeast18Miles < best.actualFinal16Weeks.runsAtLeast18Miles) {
    recommendations.push({ id: 'long-run-durability', priority: 'high',
      action: 'Progress selected build long runs toward 18–20 miles, with recovery runs between them; replace easy mileage rather than stacking extra long-run and quality load.',
      candidateWeeks: input.current.plan.weeks.filter(week => week.phase === 'marathon_build'
        && !week.isDownWeek && week.longRunDistance >= 16 && week.startDate.slice(0, 10) >= asOf)
        .map(week => week.weekNumber),
      evidence: [`Current final 16 weeks: ${planned.runsAtLeast18Miles} runs >=18 mi, ${planned.runsAtLeast20Miles} >=20 mi; fastest cycle actual: ${best.actualFinal16Weeks.runsAtLeast18Miles} and ${best.actualFinal16Weeks.runsAtLeast20Miles}.`,
        `Current longest scheduled training run: ${planned.longestRunMiles} mi. Distance alone does not establish readiness.`] });
  }
  const fades = cycles.filter(row => row.result?.execution === 'blow_up' || row.result?.execution === 'positive_split');
  if (fades.length > 0) {
    recommendations.push({ id: 'race-execution', priority: 'high',
      action: 'Use selected long runs to rehearse an even-effort start, race fueling and fluids, and controlled marathon-pace finishes. Review the cause of late fade before adding more VO2 work.',
      evidence: [`${fades.length} of ${cycles.filter(row => row.result).length} matched marathon results show positive split or blow-up.`,
        ...fades.map(row => `${row.raceName}: ${row.result!.execution}.`)] });
  }
  recommendations.push({ id: 'specificity', priority: 'medium',
    action: 'Keep threshold work controlled at demonstrated fitness and build marathon-pace blocks gradually within selected long runs; avoid making every long run hard.',
    evidence: [`Current full plan: ${current.planned.thresholdMiles} threshold miles and ${current.planned.marathonPaceLongRunMiles} marathon-pace miles in long runs.`,
      'Specificity is coaching context, not a validated seconds-gained estimate.'] });
  recommendations.push({ id: 'checkpoint', priority: 'medium',
    action: 'Use a tune-up half marathon and repeatable fueled long runs to reassess the goal before the taper; preserve recovery and taper rather than chasing missed miles.',
    evidence: ['The half-marathon equivalent is a Riegel speed benchmark only; it does not prove marathon durability or account for the Newport course and weather.'] });
  return {
    version: 'plan-history-v1', asOf, goalMinutes,
    goalPaceMinutesPerMile: goalMinutes / (42195 / 1609.344),
    halfMarathonEquivalentSeconds: Math.round(predictEquivalentRaceSeconds(goalMinutes * 60, 42195, 21097.5)),
    daysToRace: Math.round((Date.parse(current.raceDate) - Date.parse(asOf)) / 86_400_000),
    current, recent, cycles, alternatives, bestCycleId: best?.planId ?? null, recommendations,
    caveats: [
      'All cycle volume comparisons use the 112 days strictly before race day; current actual training stops strictly before as-of and is incomplete before the race.',
      'Historical plans can be reconstructed or edited after the race. Scheduled training is context, not immutable evidence or a causal explanation of results.',
      'Actual volume uses recorded activities only; missing uploads or manual-only runs may understate it. Canonical results are not counted again as training.',
      'Garmin fallback results use GPS distance and elapsed duration, not verified official chip times.',
      'These are athlete-specific coaching comparisons, not calibrated goal probabilities or estimates of time gained from plan changes.',
    ],
  };
}
