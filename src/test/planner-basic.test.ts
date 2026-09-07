import { describe, it, expect } from 'vitest';
import { parseGoalTime, parseDistance, DISTANCE_MAP } from '@/lib/planner/models';
import { buildAthleteSnapshot } from '@/lib/planner/athlete-snapshot';
import { computeGoalGap, identifyLimiters } from '@/lib/planner/goal-gap';
import { runSafetyGates } from '@/lib/planner/safety-gates';
import { buildRecommendations, formatReport } from '@/lib/planner/recommendations';
import type { MarathonPlan, WeeklyPlan } from '@/lib/training/models';
import type { RaceAnalysisActivity } from '@/lib/analytics/race-performance-analysis';

// ─── Goal Parsing ────────────────────────────────────────────

describe('parseGoalTime', () => {
  it('parses standard marathon time', () => {
    expect(parseGoalTime('3:00:00')).toBe(180);
  });

  it('parses sub-3 with seconds', () => {
    expect(parseGoalTime('2:59:59')).toBeCloseTo(179.983, 2);
  });

  it('rejects invalid formats', () => {
    expect(parseGoalTime('180')).toBeNull();
    expect(parseGoalTime('3:00')).toBeNull();
    expect(parseGoalTime('abc')).toBeNull();
  });
});

describe('parseDistance', () => {
  it('resolves known distances', () => {
    expect(parseDistance('marathon')?.meters).toBe(42195);
    expect(parseDistance('half_marathon')?.meters).toBe(21097.5);
    expect(parseDistance('5k')?.meters).toBe(5000);
  });

  it('resolves numeric mile inputs', () => {
    const r = parseDistance('13.1');
    expect(r).not.toBeNull();
    expect(r!.meters).toBeCloseTo(13.1 * 1609.344, 1);
    expect(r!.label).toContain('13.1');
  });

  it('rejects out-of-range values', () => {
    expect(parseDistance('0')).toBeNull();
    expect(parseDistance('200')).toBeNull();
    expect(parseDistance('abcdef')).toBeNull();
  });
});

describe('DISTANCE_MAP', () => {
  it('contains all standard keys', () => {
    expect(Object.keys(DISTANCE_MAP)).toContain('marathon');
    expect(Object.keys(DISTANCE_MAP)).toContain('half_marathon');
    expect(Object.keys(DISTANCE_MAP)).toContain('10k');
    expect(Object.keys(DISTANCE_MAP)).toContain('5k');
  });
});

// ─── Athlete Snapshot ────────────────────────────────────────

function makeActivity(date: string, distMiles: number, eventType: string | null = null): RaceAnalysisActivity {
  const milesInMeters = distMiles * 1609.344;
  return {
    id: `${date}-${distMiles}`,
    localDate: date,
    distanceMeters: milesInMeters,
    durationSeconds: Math.round(distMiles * 20 * 60),
    movingDurationSeconds: null,
    eventType,
    averageHeartRate: 155,
    averagePower: 300,
    calculatedPower: null,
    elevationGainMeters: 50,
    excludedFromAnalytics: false,
  };
}

describe('buildAthleteSnapshot', () => {
  it('produces snapshot with training features from activities', () => {
    const activities = [];
    for (let i = 0; i < 10; i++) {
      activities.push(makeActivity(`2026-07-${String(10 + i).padStart(2, '0')}`, 8));
    }

    const snap = buildAthleteSnapshot({
      plan: {} as MarathonPlan,
      activities,
      fitnessObservations: [],
      logs: [],
      asOf: '2026-08-01',
      sourceMaxTimestamp: '2026-07-31',
    });

    expect(snap.asOf).toBe('2026-08-01');
    expect(snap.trainingFeatures.runs).toBe(10);
    expect(snap.fitnessTrend).toBe('unknown');
    expect(snap.injuryFlags.length).toBe(0);
  });

  it('detects injury flags from log notes', () => {
    const snap = buildAthleteSnapshot({
      plan: {} as MarathonPlan,
      activities: [makeActivity('2026-07-15', 6)],
      fitnessObservations: [],
      logs: [{ weekNumber: 1, actualMileage: 30, plannedMileage: 40, longRunActual: 10, longRunPlanned: 12, feelRating: 5, adherence: 75, notes: 'Knee injury flared up', loggedAt: '2026-07-28T00:00:00Z' }],
      asOf: '2026-08-01',
      sourceMaxTimestamp: '2026-07-31',
    });

    expect(snap.injuryFlags.some(f => f.includes('injury'))).toBe(true);
  });
});

// ─── Goal Gap ────────────────────────────────────────────────

describe('identifyLimiters', () => {
  it('flags insufficient volume for ambitious goals', () => {
    const limiters = identifyLimiters(
      {
        consistencyRate: 0.8,
        peakWeeklyMiles: 40,
        trainingFeatures: { milesLast28Days: 25, longestRunMiles: 10, runsAtLeast12Miles: 0, runsAtLeast14Miles: 0, missingWeeks: 1, longestTrainingGapDays: 5, activeWeeks: 6, peakWeeklyMiles: 40 },
        injuryFlags: [],
        feelTrend: 7,
      },
      180, // sub-3
      42195,
    );

    const volId = limiters.find(l => l.id === 'insufficient_aerobic_volume');
    expect(volId).toBeDefined();
    expect(volId!.severity).toBe('high');
  });

  it('flags long run deficiency for marathon goal', () => {
    const limiters = identifyLimiters(
      {
        consistencyRate: 0.8,
        peakWeeklyMiles: 60,
        trainingFeatures: { milesLast28Days: 55, longestRunMiles: 12, runsAtLeast12Miles: 0, runsAtLeast14Miles: 0, missingWeeks: 1, longestTrainingGapDays: 3, activeWeeks: 7, peakWeeklyMiles: 60 },
        injuryFlags: [],
        feelTrend: 7,
      },
      210, // sub-3:30
      42195,
    );

    expect(limiters.some(l => l.id === 'inadequate_long_run_exposure')).toBe(true);
  });

  it('surfaces injury flags as limiters', () => {
    const limiters = identifyLimiters(
      {
        consistencyRate: 0.8,
        peakWeeklyMiles: 70,
        trainingFeatures: { milesLast28Days: 60, longestRunMiles: 20, runsAtLeast12Miles: 3, runsAtLeast14Miles: 2, missingWeeks: 1, longestTrainingGapDays: 2, activeWeeks: 8, peakWeeklyMiles: 70 },
        injuryFlags: ['Recent injury mentioned in training logs'],
        feelTrend: 6,
      },
      210,
      42195,
    );

    expect(limiters.some(l => l.label.includes('injury'))).toBe(true);
  });

  it('flags low consistency', () => {
    const limiters = identifyLimiters(
      {
        consistencyRate: 0.25,
        peakWeeklyMiles: 30,
        trainingFeatures: { milesLast28Days: 15, longestRunMiles: 6, runsAtLeast12Miles: 0, runsAtLeast14Miles: 0, missingWeeks: 5, longestTrainingGapDays: 21, activeWeeks: 3, peakWeeklyMiles: 30 },
        injuryFlags: [],
        feelTrend: null,
      },
      240,
      42195,
    );

    expect(limiters.some(l => l.id === 'poor_consistency_or_gaps')).toBe(true);
  });
});

describe('computeGoalGap', () => {
  it('returns unsupported when no race evidence exists', () => {
    const result = computeGoalGap(
      { plan: {} as MarathonPlan, activities: [], fitnessObservations: [], logs: [], asOf: '2026-08-01', sourceMaxTimestamp: '2026-07-31' },
      { goalMinutes: 210, distanceMeters: 42195, distanceLabel: 'Marathon' },
    );

    expect(result.classification).toBe('unsupported');
    expect(result.evidenceCount).toBe(0);
  });

  it('classifies supported goal when prediction is ahead of goal', () => {
    const race = makeActivity('2026-04-01', 26.2, 'race');
    race.durationSeconds = 7200; // exactly 2 hours at marathon

    const result = computeGoalGap(
      { plan: {} as MarathonPlan, activities: [race], fitnessObservations: [], logs: [], asOf: '2026-08-01', sourceMaxTimestamp: '2026-07-31' },
      { goalMinutes: 190, distanceMeters: 42195, distanceLabel: 'Marathon' }, // sub-3:10 - well ahead
    );

    expect(result.classification).toBe('supported');
  });
});

// ─── Safety Gates ────────────────────────────────────────────

function makeMinimalPlan(weeks: Partial<WeeklyPlan>[]): MarathonPlan {
  return {
    id: 'test-plan',
    runnerProfile: {} as any,
    paceZones: {} as any,
    phases: [],
    weeks: weeks.map((w, i) => ({
      weekNumber: i + 1,
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      phase: w.phase ?? 'base',
      days: w.days ?? [],
      totalMileage: w.totalMileage ?? 40,
      isDownWeek: w.isDownWeek ?? false,
      longRunDistance: w.longRunDistance ?? 10,
      intensityDistribution: w.intensityDistribution ?? { easy: 30, threshold: 5, marathon: 3, vo2: 1 },
    })),
    totalWeeks: weeks.length,
    peakWeeklyMileage: Math.max(...weeks.map(w => w.totalMileage ?? 40)),
    raceDay: '2026-10-01',
    generatedAt: '2026-06-01',
    goalAssessment: {} as any,
    riskWarnings: [],
    adjustmentRules: [],
  };
}

describe('runSafetyGates', () => {
  it('passes when plan has adequate recovery and taper', () => {
    const weeks = [
      { weekNumber: 1, totalMileage: 40, isDownWeek: false, longRunDistance: 10 },
      { weekNumber: 2, totalMileage: 44, isDownWeek: false, longRunDistance: 11 },
      { weekNumber: 3, totalMileage: 35, isDownWeek: true, longRunDistance: 9 },
      { weekNumber: 4, phase: 'peak_taper' as const, totalMileage: 25, isDownWeek: false, longRunDistance: 8 },
    ];
    const plan = makeMinimalPlan(weeks);

    const gates = runSafetyGates(plan, {
      sourceMaxTimestamp: '2026-07-31', asOf: '2026-07-31',
      trainingFeatures: { lookbackDays: 112, runs: 20, miles: 200, milesLast7Days: 15, milesLast28Days: 45, milesLast56Days: 90, milesLast84Days: 130, milesLast112Days: 170, activeWeeks: 10, missingWeeks: 2, averageWeeklyMiles: 40, peakWeeklyMiles: 45, coefficientOfVariation: null, runFrequencyPerWeek: 4, longestTrainingGapDays: 3, longestRunMiles: 12, longestRunMilesLast28Days: 11, longestRunMilesLast56Days: 12, longestRunMilesLast112Days: 13, runsAtLeast12Miles: 2, runsAtLeast14Miles: 0, runsAtLeast16Miles: 0, runsAtLeast18Miles: 0, durationHoursLast7Days: 5, durationHoursLast28Days: 18, durationHoursLast56Days: 30, durationHoursLast84Days: 50, durationHoursLast112Days: 70, longestRunDurationHours: 2.5, longestRunSharePercent: 25, weeklyMileageCoefficientOfVariation: null, taperRatio7ToPrior28: null, taperRatio14ToPrior42: null, elevationGainMeters: 500, averageHeartRate: 155, measuredPowerRuns: 5, calculatedPowerRuns: 10 },
      fitnessTrend: 'stable', injuryFlags: [], feelTrend: 7, consistencyRate: 0.7, peakWeeklyMiles: 45,
    } as any, {});

    const refusals = gates.filter(g => g.result === 'refuse');
    expect(refusals.length).toBe(0);
  });

  it('refuses when injury flags are active', () => {
    const gates = runSafetyGates(makeMinimalPlan([]), {
      sourceMaxTimestamp: '2026-07-31', asOf: '2026-07-31',
      trainingFeatures: {} as any, fitnessTrend: 'stable', injuryFlags: ['injury'], feelTrend: null, consistencyRate: 0.8, peakWeeklyMiles: 40, runs: 20,
    } as any, {});

    expect(gates.find(g => g.checkId === 'injury_flags' && g.result === 'refuse')).toBeDefined();
  });

  it('refuses when no taper phase', () => {
    const weeks = [
      { totalMileage: 40, isDownWeek: false },
      { totalMileage: 44, isDownWeek: false },
    ];
    const plan = makeMinimalPlan(weeks);
    const gates = runSafetyGates(plan, { sourceMaxTimestamp: '', asOf: '', trainingFeatures: { runs: 20 }, injuryFlags: [], consistencyRate: 0.8, peakWeeklyMiles: 40 } as any, {});
    expect(gates.find(g => g.checkId === 'taper_presence')!.result).toBe('refuse');
  });

  it('warns on excessive weekly progression', () => {
    const weeks = [
      { totalMileage: 30, isDownWeek: false },
      { totalMileage: 50, isDownWeek: false },
      { totalMileage: 20, isDownWeek: true, longRunDistance: 6 },
    ];
    const plan = makeMinimalPlan(weeks);
    const gates = runSafetyGates(plan, { sourceMaxTimestamp: '', asOf: '', trainingFeatures: { runs: 20 }, injuryFlags: [], consistencyRate: 0.8, peakWeeklyMiles: 40 } as any, {});
    expect(gates.find(g => g.checkId === 'weekly_progression')!.result).toBe('warn');
  });
});

// ─── Recommendations ────────────────────────────────────────

describe('buildRecommendations', () => {
  it('suggests mileage increase when current avg is low for goal', () => {
    const snapshot = {
      trainingFeatures: { averageWeeklyMiles: 25, peakWeeklyMiles: 40, milesLast28Days: 22, longestRunMiles: 10, runsAtLeast12Miles: 0, runsAtLeast14Miles: 0, missingWeeks: 3 },
      consistencyRate: 0.6, feelTrend: 7, fitnessTrend: 'stable', injuryFlags: [], peakWeeklyMiles: 40,
    } as any;

    const plan = makeMinimalPlan([{ totalMileage: 40, isDownWeek: true }]);

    const recs = buildRecommendations(snapshot, plan, 210);
    expect(recs.some(r => r.type === 'increase_weekly_mileage')).toBe(true);
  });

  it('suggests long run progression when deficit exists', () => {
    const snapshot = {
      trainingFeatures: { averageWeeklyMiles: 65, peakWeeklyMiles: 70, milesLast28Days: 60, longestRunMiles: 12, runsAtLeast12Miles: 2 },
      consistencyRate: 0.8, feelTrend: 7, fitnessTrend: 'stable', injuryFlags: [], peakWeeklyMiles: 70,
    } as any;

    const plan = makeMinimalPlan([{ totalMileage: 55, isDownWeek: true }]);
    const recs = buildRecommendations(snapshot, plan, 210);
    expect(recs.some(r => r.type === 'progress_long_run')).toBe(true);
  });

  it('no recommendation when metrics are adequate', () => {
    const snapshot = {
      trainingFeatures: { averageWeeklyMiles: 70, peakWeeklyMiles: 80, milesLast28Days: 65, longestRunMiles: 20, runsAtLeast12Miles: 3 },
      consistencyRate: 0.9, feelTrend: 8, fitnessTrend: 'improving', injuryFlags: [], peakWeeklyMiles: 80,
    } as any;

    const plan = makeMinimalPlan([
      { totalMileage: 55, isDownWeek: true },
    ]);
    plan.weeks[0].intensityDistribution = { easy: 35, threshold: 6, marathon: 4, vo2: 2 };

    const recs = buildRecommendations(snapshot, plan, 210);
    // Should have no mileage or long-run recommendations
    expect(recs.some(r => r.type === 'increase_weekly_mileage')).toBe(false);
    expect(recs.some(r => r.type === 'progress_long_run')).toBe(false);
  });
});

describe('formatReport', () => {
  it('produces non-empty string with limiters and recommendations', () => {
    const text = formatReport(
      [{ type: 'test', priority: 'high', expectedPurpose: 'do something', evidence: [], risk: 'low', reversible: true }],
      [{ id: 'vol', label: 'Volume', severity: 'high', description: 'too low', evidence: [] }],
    );
    expect(text).toContain('Limiting Factors');
    expect(text).toContain('Recommendations');
  });

  it('produces message when no recommendations needed', () => {
    const text = formatReport([], []);
    expect(text).toContain('on track');
  });
});
