import { describe, it, expect } from 'vitest';
import { comparePlanTraining, summarizePlanTraining } from '@/lib/planner/plan-comparison';
import { generatePlan } from '@/lib/training/plan-generator';
import type { MarathonPlan, RunnerProfile, WeeklyPlan, Workout } from '@/lib/training/models';

function baseProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 60,
    peakHistoricalWeeklyMileage: 100,
    currentMarathonPR: null,
    currentHalfMarathonPR: null,
    goalMarathonTime: 179.983,
    raceDate: '2027-04-17',
    raceName: 'Newport Marathon 2027',
    trainingDaysPerWeek: 6,
    preferredRestDay: 'Wednesday',
    recentInjuryHistory: 'None',
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 20,
    comfortLevelWithWorkouts: 'intermediate',
    availableLongRunDays: ['Saturday'],
    strengthTrainingAvailability: 'light',
    peakMileageOverride: 90,
    ...overrides,
  };
}

function makePlan(weeks: Array<{ phase?: WeeklyPlan['phase']; totalMileage: number; isDownWeek?: boolean; longRunDistance?: number; days?: WeeklyPlan['days'] }>): MarathonPlan {
  return {
    id: 'plan-test',
    runnerProfile: baseProfile(),
    paceZones: { marathon: 6.87 } as any,
    phases: [],
    weeks: weeks.map((week, index) => ({
      weekNumber: index + 1,
      startDate: '2026-11-02T00:00:00.000Z',
      endDate: '2026-11-08T00:00:00.000Z',
      phase: week.phase ?? 'marathon_build',
      days: week.days ?? [],
      totalMileage: week.totalMileage,
      isDownWeek: week.isDownWeek ?? false,
      longRunDistance: week.longRunDistance ?? 0,
      intensityDistribution: { easy: 0, threshold: 0, marathon: 0, vo2: 0 },
    })),
    totalWeeks: weeks.length,
    peakWeeklyMileage: Math.max(...weeks.map((week) => week.totalMileage)),
    raceDay: '2027-04-17',
    generatedAt: '2026-11-01',
    goalAssessment: {} as any,
    riskWarnings: [],
    adjustmentRules: [],
  };
}

function workout(type: Workout['type'], segments: Workout['segments']): Workout {
  return {
    id: `w-${type}-${segments.length}`,
    type,
    title: type,
    description: '',
    segments,
    totalDistance: segments.reduce((sum, segment) => sum + (segment.distance ?? 0) * (segment.repetitions ?? 1), 0),
    estimatedDuration: 0,
    weeklyMileageContribution: 0,
    intensityCategory: 'moderate',
  };
}

describe('summarizePlanTraining', () => {
  it('counts repetitions in interval segments', () => {
    const plan = makePlan([{
      totalMileage: 40,
      days: [{
        date: '', dayOfWeek: 'Tuesday', isRestDay: false, plannedMileage: 7,
        workout: workout('threshold', [
          { description: 'warm-up', distance: 2, type: 'easy' },
          { description: 'intervals', distance: 1, repetitions: 3, type: 'threshold' },
          { description: 'cool-down', distance: 2, type: 'easy' },
        ]),
      }],
    }]);

    const summary = summarizePlanTraining(plan);
    expect(summary.thresholdMiles).toBe(3);
    expect(summary.weeksWithThreshold).toBe(1);
    expect(summary.marathonPaceMiles).toBe(0);
  });

  it('separates marathon pace inside long runs from midweek work', () => {
    const longRun = workout('long', [
      { description: 'easy', distance: 15, type: 'long' },
      { description: 'fast finish', distance: 5, type: 'marathon_pace' },
    ]);
    const midweek = workout('marathon_pace', [
      { description: 'MP block', distance: 8, repetitions: 1, type: 'marathon_pace' },
    ]);
    const plan = makePlan([{
      totalMileage: 70,
      longRunDistance: 20,
      days: [
        { date: '', dayOfWeek: 'Tuesday', isRestDay: false, plannedMileage: 12, workout: midweek },
        { date: '', dayOfWeek: 'Saturday', isRestDay: false, plannedMileage: 20, workout: longRun },
      ],
    }]);

    const summary = summarizePlanTraining(plan);
    expect(summary.marathonPaceMiles).toBe(13);
    expect(summary.marathonPaceLongRunMiles).toBe(5);
    expect(summary.marathonPaceMidweekMiles).toBe(8);
    expect(summary.weeksWithMarathonPaceLongRun).toBe(1);
  });

  it('ignores race-day segments in specific-work counts', () => {
    const plan = makePlan([{
      totalMileage: 26.2,
      days: [{
        date: '', dayOfWeek: 'Saturday', isRestDay: false, plannedMileage: 26.2, isRaceDay: true,
        workout: workout('race', [{ description: 'race', distance: 26.2, type: 'marathon_pace' }]),
      }],
    }]);

    const summary = summarizePlanTraining(plan);
    expect(summary.marathonPaceMiles).toBe(0);
  });

  it('computes taper reduction against pre-taper volume', () => {
    const plan = makePlan([
      { totalMileage: 80 },
      { totalMileage: 80 },
      { phase: 'peak_taper', totalMileage: 40 },
      { phase: 'peak_taper', totalMileage: 20 },
    ]);

    const summary = summarizePlanTraining(plan);
    expect(summary.taperWeeks).toBe(2);
    expect(summary.taperReductionPercent).toBe(62.5);
  });

  it('summarizes a generated plan with volume, long runs, and specific work', () => {
    const plan = generatePlan(baseProfile({ weeksOverride: 24 }));
    const summary = summarizePlanTraining(plan);

    expect(summary.totalWeeks).toBe(24);
    expect(summary.totalMileage).toBe(Math.round(plan.weeks.reduce((sum, week) => sum + week.totalMileage, 0)));
    expect(summary.peakWeeklyMileage).toBe(plan.peakWeeklyMileage);
    expect(summary.longRunsAtLeast16).toBeGreaterThanOrEqual(summary.longRunsAtLeast18);
    expect(summary.longRunsAtLeast18).toBeGreaterThanOrEqual(summary.longRunsAtLeast20);
    expect(summary.thresholdMiles).toBeGreaterThan(0);
    expect(summary.marathonPaceMiles).toBeGreaterThan(0);
    expect(summary.weeksWithMarathonPace).toBeGreaterThan(0);
    expect(summary.marathonPaceMiles).toBeCloseTo(
      summary.marathonPaceMidweekMiles + summary.marathonPaceLongRunMiles,
      0,
    );
    expect(summary.taperReductionPercent).not.toBeNull();
    expect(summary.taperReductionPercent!).toBeGreaterThan(0);
    expect(summary.taperReductionPercent!).toBeLessThan(100);
  });
});

describe('comparePlanTraining', () => {
  it('reports after - before for every metric', () => {
    const before = generatePlan(baseProfile({ raceDate: '2026-09-27', weeksOverride: 20 }));
    const after = generatePlan(baseProfile({ weeksOverride: 24 }));
    const comparison = comparePlanTraining(before, after);

    const weeks = comparison.metrics.find((metric) => metric.id === 'totalWeeks')!;
    expect(weeks.before).toBe(20);
    expect(weeks.after).toBe(24);
    expect(weeks.delta).toBe(4);

    const mileage = comparison.metrics.find((metric) => metric.id === 'totalMileage')!;
    expect(mileage.delta).toBe(mileage.after! - mileage.before!);
    expect(mileage.delta!).toBeGreaterThan(0);

    for (const metric of comparison.metrics) {
      if (metric.before != null && metric.after != null) {
        expect(metric.delta).toBeCloseTo(metric.after - metric.before, 5);
      }
    }
  });

  it('produces zero deltas when comparing a plan with itself', () => {
    const plan = generatePlan(baseProfile({ weeksOverride: 24 }));
    const comparison = comparePlanTraining(plan, plan);

    for (const metric of comparison.metrics) {
      expect(metric.delta).toBe(0);
    }
  });
});