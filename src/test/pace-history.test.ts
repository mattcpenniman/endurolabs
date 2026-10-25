import { describe, expect, it } from 'vitest';
import { actualPaceWindow, analyzePaceTrace, buildPaceHistory, prescribedIntensity } from '@/lib/planner/pace-history';
import { buildPlanHistory, type StoredTrainingPlan } from '@/lib/planner/plan-history';
import { generatePlan } from '@/lib/training/plan-generator';
import type { RunnerProfile } from '@/lib/training/models';
import type { ActivityChartSample } from '@/lib/activities/models';
import type { RaceAnalysisActivity } from '@/lib/analytics/race-performance-analysis';

const profile: RunnerProfile = {
  currentWeeklyMileage: 43, peakHistoricalWeeklyMileage: 100,
  currentMarathonPR: null, currentHalfMarathonPR: null, goalMarathonTime: 180,
  raceDate: '2027-04-17', trainingDaysPerWeek: 6, preferredRestDay: 'Wednesday',
  recentInjuryHistory: 'None', averageEasyPace: null, averageMarathonPace: null,
  averageThresholdPace: null, hasAppleWatchPower: false, longestRecentLongRun: 18,
  comfortLevelWithWorkouts: 'intermediate', availableLongRunDays: ['Saturday'],
  strengthTrainingAvailability: 'light', peakMileageOverride: 75, weeksOverride: 24,
};
const plan = generatePlan(profile);
// Fixed, ordered reference anchors independent of goal-fallback zone generation.
plan.paceZones = { ...plan.paceZones, easy: { min: 8, max: 9 }, recovery: 10, marathon: 7, threshold: 6.5, vo2: 6 };
const samples = (pace: number, slope = 0): ActivityChartSample[] => Array.from({ length: 61 }, (_, i) => ({
  elapsedSeconds: i * 10, speedMetersPerSecond: 1609.344 / (pace * 60),
  elevationMeters: i * 10 * 1609.344 / (pace * 60) * slope,
  heartRate: 150, power: 300, cadence: null,
}));
const trace = (pace = 7, slope = 0) => analyzePaceTrace({ samples: samples(pace, slope), plan, hasMeasuredPower: true, goalPace: 7 });
const activity = (id: string, date: string, overrides: Partial<RaceAnalysisActivity> = {}): RaceAnalysisActivity => ({
  id, localDate: date, distanceMeters: 16093.44, durationSeconds: 5400, movingDurationSeconds: 4800,
  eventType: null, averageHeartRate: 140, averagePower: null, calculatedPower: 350,
  elevationGainMeters: null, excludedFromAnalytics: false, ...overrides,
});

describe('completed pace evidence', () => {
  it('reports actual raw pace and continuous completed blocks, never prescribed workout type', () => {
    const result = trace();
    expect(result.rawSeconds.marathon).toBe(600);
    expect(result.gapSeconds.marathon).toBe(550); // first >=60s slope window
    expect(result.longestNearGoalBlock.minutes).toBeCloseTo(550 / 60);
    expect(result.longestNearGoalBlock.actualPace).toBeCloseTo(7);
    expect(result.longestNearGoalBlock.averageHr).toBe(150);
    const window = actualPaceWindow([activity('a', '2026-10-01')], new Map([['a', result]]), '2026-09-01', '2026-10-25');
    expect(window.completedRuns[0].actualMovingPace).toBeCloseTo(8);
    expect(window.completedRuns[0].actualElapsedPace).toBeCloseTo(9);
  });

  it('derives grade from elevation/speed, and keeps raw pace distinct from GAP', () => {
    const uphill = trace(8, 0.05);
    expect(uphill.rawSeconds.easy).toBe(600);
    expect(uphill.gapSeconds.easy).toBe(0);
    expect(uphill.gapSeconds.marathon + uphill.gapSeconds.threshold + uphill.gapSeconds.vo2).toBe(550);
    expect(trace(8, 0.3).gapSeconds).toEqual({ recovery: 0, easy: 0, marathon: 0, threshold: 0, vo2: 0 });
  });

  it('breaks sustained blocks and slope windows at pauses/gaps and missing elevation', () => {
    const values = samples(7).map((s, i) => ({ ...s, elapsedSeconds: s.elapsedSeconds + (i >= 30 ? 100 : 0) }));
    const result = analyzePaceTrace({ samples: values, plan, hasMeasuredPower: true, goalPace: 7 });
    expect(result.longestNearGoalBlock.minutes).toBeLessThan(5);
    const missing = analyzePaceTrace({ samples: samples(7).map(s => ({ ...s, elevationMeters: null })), plan, hasMeasuredPower: true, goalPace: 7 });
    expect(missing.rawSeconds.marathon).toBe(600);
    expect(missing.nearGoalSeconds).toBe(0);
    expect(missing.longestRawNearGoalBlock.minutes).toBeGreaterThan(9);
  });

  it('smooths GPS jitter for sustained blocks without replacing actual block pace with a target', () => {
    const speed = 1609.344 / (7 * 60);
    const jitter = samples(7).map((s, i) => ({ ...s, speedMetersPerSecond: speed * (i % 4 < 2 ? 0.9 : 1.1) }));
    const result = analyzePaceTrace({ samples: jitter, plan, hasMeasuredPower: false, goalPace: 7 });
    expect(result.longestRawNearGoalBlock.minutes).toBeGreaterThan(8);
    expect(result.longestRawNearGoalBlock.actualPace).toBeCloseTo(7, 1);
  });

  it('never buckets modeled watts and retains measured observations without zone anchors', () => {
    const measured = trace();
    expect(measured.powerSeconds).toEqual({ recovery: 0, easy: 0, marathon: 0, threshold: 0, vo2: 0 });
    expect(measured.measuredPowerSeconds).toBe(600);
    const modeled = analyzePaceTrace({ samples: samples(7), plan, hasMeasuredPower: false, goalPace: 7 });
    expect(modeled.measuredPowerSeconds).toBe(0);
    const anchored = { ...plan, runnerProfile: { ...profile, appleWatchPowerData: { marathonPower: 300, easyPower: null, thresholdPower: null } },
      powerZones: { easy: { min: 200, max: 270 }, marathon: 300, threshold: 330, vo2: 360 } };
    const anchoredTrace = analyzePaceTrace({ samples: samples(7), plan: anchored, hasMeasuredPower: true, goalPace: 7 });
    expect(anchoredTrace.powerSeconds.marathon).toBe(600);
  });

  it('uses all elapsed time for coverage and excludes cutoff, canonical duplicates and excluded runs', () => {
    const values = [activity('a', '2026-10-01'), activity('missing', '2026-10-02'),
      activity('canonical', '2026-10-01', { trainingExcluded: true }),
      activity('excluded', '2026-10-01', { excludedFromAnalytics: true }), activity('future', '2026-10-25')];
    const result = actualPaceWindow(values, new Map([['a', trace()]]), '2026-09-01', '2026-10-25');
    expect(result.runs).toBe(2);
    expect(result.miles).toBe(20);
    expect(result.gap.coverage).toBeCloseTo(550 / 10800, 3);
    expect(result.measuredSensorPower.averageWatts).toBe(300);
    expect(result.measuredSensorPower.coverage).toBeCloseTo(600 / 10800, 3);
    expect(result.completedRuns[1].averageGapPace).toBeNull();
  });

  it('rejects impossible summary moving pace and uses valid elapsed fallback', () => {
    const result = actualPaceWindow([activity('bad-moving', '2026-10-01', { movingDurationSeconds: 5 }),
      activity('bad-both', '2026-10-02', { movingDurationSeconds: 5, durationSeconds: 5 })], new Map(), '2026-09-01', '2026-10-25');
    expect(result.completedRuns[0].actualMovingPace).toBe(9);
    expect(result.completedRuns[1].actualMovingPace).toBeNull();
    expect(result.summaryPaceMinutesPerMile).toBe(9);
    expect(result.summaryPaceDistanceCoverage).toBe(0.5);
  });
});

describe('pace history context', () => {
  it('counts repeated work/recovery and retains missing segment time as unknown', () => {
    const p = structuredClone(plan);
    const day = p.weeks[0].days[0];
    day.isRaceDay = false; day.secondaryWorkout = null;
    day.workout = { id: 'work', title: 'Intervals', description: '', type: 'threshold',
      totalDistance: 5, estimatedDuration: 40, weeklyMileageContribution: 5, intensityCategory: 'hard',
      segments: [{ type: 'threshold', description: '', duration: 5, repetitions: 4, restBetween: 60 },
        { type: 'easy', description: '', distance: 1, pace: 8 }] };
    const result = prescribedIntensity(p, day.date.slice(0, 10), new Date(Date.parse(day.date) + 86400000).toISOString().slice(0, 10));
    expect(result.minutes.threshold).toBe(20);
    expect(result.minutes.recovery).toBe(3);
    expect(result.minutes.easy).toBe(8);
    expect(result.unknownMinutes).toBe(9);
  });

  it('keeps future scheduled windows distinct from recent actual training and excludes later speed results', () => {
    const current: StoredTrainingPlan = { id: 'current', raceName: 'Newport', plan };
    const activities = [activity('a', '2026-10-01'), activity('later-race', '2026-10-25', { eventType: 'race', distanceMeters: 5000 })];
    const history = buildPlanHistory({ current, plans: [current], activities, asOf: '2026-10-25', goalMinutes: 180 });
    const report = buildPaceHistory({ history, reference: current, plans: [current], activities, traces: new Map([['a', trace()]]) });
    expect(report.cycles[0].actual.runs).toBe(0);
    expect(report.cycles[0].actual.averageWeeklyMiles).toBeNull();
    expect(report.cycles[0].prescribedObservedWindow.totalEstimatedMinutes).toBe(0);
    expect(report.cycles[0].prescribedFinal112.totalEstimatedMinutes).toBeGreaterThan(0);
    expect(report.cycles[0].speedBenchmarks).toEqual([]);
    expect(report.recent.runs).toBe(1);
    expect(report.recommendations[0]).toContain('unassessed');
  });
});
