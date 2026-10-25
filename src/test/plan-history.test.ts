import { describe, expect, it } from 'vitest';
import { buildPlanHistory, type StoredTrainingPlan } from '@/lib/planner/plan-history';
import { generatePlan } from '@/lib/training/plan-generator';
import type { RunnerProfile } from '@/lib/training/models';
import type { RaceAnalysisActivity } from '@/lib/analytics/race-performance-analysis';

const profile: RunnerProfile = {
  currentWeeklyMileage: 43, peakHistoricalWeeklyMileage: 100,
  currentMarathonPR: null, currentHalfMarathonPR: null, goalMarathonTime: 179.983,
  raceDate: '2027-04-17', trainingDaysPerWeek: 6, preferredRestDay: 'Wednesday',
  recentInjuryHistory: 'None', averageEasyPace: null, averageMarathonPace: null,
  averageThresholdPace: null, hasAppleWatchPower: false, longestRecentLongRun: 18,
  comfortLevelWithWorkouts: 'intermediate', availableLongRunDays: ['Saturday'],
  strengthTrainingAvailability: 'light', peakMileageOverride: 75, weeksOverride: 24,
};

function stored(id: string, raceDate: string): StoredTrainingPlan {
  return { id, raceName: id, plan: generatePlan({ ...profile, raceDate }) };
}

function activity(date: string, miles: number, overrides: Partial<RaceAnalysisActivity> = {}): RaceAnalysisActivity {
  return { id: `${date}-${miles}`, localDate: date, distanceMeters: miles * 1609.344,
    durationSeconds: 12000, movingDurationSeconds: null, eventType: null,
    averageHeartRate: null, averagePower: null, calculatedPower: null,
    elevationGainMeters: null, excludedFromAnalytics: false, ...overrides };
}

const current = stored('current', '2027-04-17');
const past = stored('past', '2026-04-18');

function report(activities: RaceAnalysisActivity[], plans: StoredTrainingPlan[] = [past]) {
  return buildPlanHistory({ current, plans, activities, asOf: '2026-10-25', goalMinutes: 179.983 });
}

describe('historical marathon cycle analysis', () => {
  it('uses only pre-race training in matched 112-day windows, without canonical duplicates', () => {
    const result = report([
      activity('2025-12-26', 100), // before the window
      activity('2025-12-27', 20), // first included day
      activity('2026-04-17', 5),
      activity('2026-04-18', 26.2, { eventType: 'race' }),
      activity('2026-04-18', 26.2, { eventType: 'race', resultSource: 'canonical', trainingExcluded: true }),
      activity('2026-04-19', 100),
      activity('2026-04-16', 100, { excludedFromAnalytics: true }),
    ]);
    const cycle = result.cycles[0];
    expect(cycle.actualFinal16Weeks.miles).toBe(25);
    expect(cycle.actualFinal16Weeks.runsAtLeast20Miles).toBe(1);
    expect(cycle.result?.source).toBe('canonical');
    expect(cycle.plannedFinal16Weeks.longestRunMiles).toBeLessThan(26);
  });

  it('excludes the cutoff day and future data, including future race outcomes', () => {
    const result = report([
      activity('2026-10-24', 10), activity('2026-10-25', 50),
      activity('2027-04-17', 26.2, { eventType: 'race' }),
    ]);
    expect(result.recent.miles).toBe(10);
    expect(result.current.result).toBeNull();
    expect(result.current.actualFinal16Weeks.miles).toBe(0);
  });

  it('keeps same-race drafts separate and deduplicates earlier race cycles', () => {
    const draft = stored('draft', current.plan.raceDay);
    const result = report([], [draft, past, { ...past, id: 'past-copy' }, current]);
    expect(result.current.planId).toBe('current');
    expect(result.alternatives.map(row => row.planId)).toEqual(['draft']);
    expect(result.cycles.map(row => row.planId)).toEqual(['past']);
    expect(result.bestCycleId).toBeNull();
    expect(result.recommendations.some(row => row.id === 'sustained-volume')).toBe(false);
  });

  it('bases durability comparisons on actual training in the fastest matched cycle', () => {
    const runs = Array.from({ length: 16 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 3, 17) - index * 7 * 86400000).toISOString().slice(0, 10);
      return [activity(date, 20), activity(date, 60)];
    }).flat();
    const result = report([...runs, activity('2026-04-18', 26.2, { eventType: 'race', executionQuality: 'blow_up' })]);
    expect(result.bestCycleId).toBe('past');
    expect(result.recommendations.map(row => row.id)).toEqual(expect.arrayContaining(['sustained-volume', 'long-run-durability', 'race-execution']));
    const weeks = result.recommendations.find(row => row.id === 'long-run-durability')!.candidateWeeks!;
    expect(weeks.length).toBeGreaterThan(0);
    for (const number of weeks) {
      const week = current.plan.weeks.find(row => row.weekNumber === number)!;
      expect(week.phase).toBe('marathon_build');
      expect(week.isDownWeek).toBe(false);
    }
  });

  it('keeps pace and half benchmarks goal-relative without adding a goal probability', () => {
    const result = report([]);
    expect(result.goalPaceMinutesPerMile).toBeCloseTo(6.866, 2);
    expect(result.halfMarathonEquivalentSeconds).toBe(5180);
    expect(result.daysToRace).toBe(174);
  });
});
