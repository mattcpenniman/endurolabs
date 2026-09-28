import { describe, it, expect } from 'vitest';
import {
  buildCreateProfile,
  summarizePlan,
  validateCreateOptions,
  validatePlanCalendar,
  type CreatePlanOptions,
} from '@/lib/planner/plan-creation';
import { generatePlan } from '@/lib/training/plan-generator';
import type { MarathonPlan, RunnerProfile } from '@/lib/training/models';

function baseProfile(): RunnerProfile {
  return {
    currentWeeklyMileage: 60,
    peakHistoricalWeeklyMileage: 100,
    currentMarathonPR: null,
    currentHalfMarathonPR: null,
    goalMarathonTime: 179,
    raceDate: '2026-09-27',
    raceName: 'Germany 2026',
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
    weeksOverride: 20,
    runsPerWeekOverride: 8,
    preferredDoubleUpDays: ['Monday', 'Tuesday'],
    weeklyMileageOverrides: { 17: 60 },
    weeklyIntensityOverrides: { 8: { threshold: 4 } },
  };
}

function options(overrides: Partial<CreatePlanOptions> = {}): CreatePlanOptions {
  return {
    raceDate: '2027-04-17',
    goalMinutes: 179.983,
    raceName: 'Newport Marathon 2027',
    weeks: 28,
    ...overrides,
  };
}

describe('validateCreateOptions', () => {
  it('accepts a valid 28-week marathon block', () => {
    expect(validateCreateOptions(options(), '2026-09-28')).toEqual([]);
  });

  it('rejects a race date in the past', () => {
    const errors = validateCreateOptions(options({ raceDate: '2026-09-27' }), '2026-09-28');
    expect(errors.some((error) => error.includes('future'))).toBe(true);
  });

  it('rejects malformed dates and goals', () => {
    expect(validateCreateOptions(options({ raceDate: 'April 17' }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ goalMinutes: Number.NaN }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ goalMinutes: 60 }), '2026-09-28').length).toBeGreaterThan(0);
  });

  it('bounds weeks, mileage, and training days', () => {
    expect(validateCreateOptions(options({ weeks: 12 }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ weeks: 29 }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ maxWeeklyMileage: Number.NaN }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ maxLongRun: 40 }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ trainingDays: 2 }), '2026-09-28').length).toBeGreaterThan(0);
    expect(validateCreateOptions(options({ longRunDay: 'Caturday' }), '2026-09-28').length).toBeGreaterThan(0);
  });
});

describe('buildCreateProfile', () => {
  it('overrides race fields and clears the previous weeks override', () => {
    const profile = buildCreateProfile(baseProfile(), options());

    expect(profile.raceDate).toBe('2027-04-17');
    expect(profile.raceName).toBe('Newport Marathon 2027');
    expect(profile.weeksOverride).toBe(28);
    expect(profile.goalMarathonTime).toBeCloseTo(179.983, 3);
  });

  it('keeps volume and schedule settings unless overridden', () => {
    const profile = buildCreateProfile(baseProfile(), options());

    expect(profile.peakMileageOverride).toBe(90);
    expect(profile.trainingDaysPerWeek).toBe(6);
    expect(profile.runsPerWeekOverride).toBe(8);
    expect(profile.preferredRestDay).toBe('Wednesday');
    expect(profile.availableLongRunDays).toEqual(['Saturday']);
  });

  it('applies constraints and can reset per-week overrides', () => {
    const profile = buildCreateProfile(
      baseProfile(),
      options({ maxWeeklyMileage: 75, maxLongRun: 21, trainingDays: 5, longRunDay: 'Sunday', noDoubles: true, resetWeeklyOverrides: true }),
    );

    expect(profile.peakMileageOverride).toBe(75);
    expect(profile.maxLongRunOverride).toBe(21);
    expect(profile.trainingDaysPerWeek).toBe(5);
    expect(profile.runsPerWeekOverride).toBe(5);
    expect(profile.preferredDoubleUpDays).toEqual([]);
    expect(profile.availableLongRunDays).toEqual(['Sunday']);
    expect(profile.weeklyMileageOverrides).toBeUndefined();
    expect(profile.weeklyIntensityOverrides).toBeUndefined();
  });
});

describe('validatePlanCalendar', () => {
  it('starts a 28-week block on 2026-10-05 for the Newport race', () => {
    const plan = generatePlan(buildCreateProfile(baseProfile(), options()));
    const gates = validatePlanCalendar(plan, '2026-09-28', '2027-04-17');

    expect(plan.totalWeeks).toBe(28);
    expect(plan.weeks[0].startDate.slice(0, 10)).toBe('2026-10-05');
    expect(plan.raceDay).toBe('2027-04-17');
    expect(gates.every((gate) => gate.result !== 'refuse')).toBe(true);
  });

  it('refuses when the plan would start in the past', () => {
    const plan = generatePlan(buildCreateProfile(baseProfile(), options()));
    const gates = validatePlanCalendar(plan, '2026-10-12', '2027-04-17');

    expect(gates.find((gate) => gate.checkId === 'plan_start')?.result).toBe('refuse');
  });

  it('refuses when the requested race date does not match', () => {
    const plan = generatePlan(buildCreateProfile(baseProfile(), options()));
    const gates = validatePlanCalendar(plan, '2026-09-28', '2027-04-18');

    expect(gates.find((gate) => gate.checkId === 'race_date_match')?.result).toBe('refuse');
  });
});

describe('summarizePlan', () => {
  it('reports calendar, volume, and week detail', () => {
    const plan: MarathonPlan = generatePlan(buildCreateProfile(baseProfile(), options()));
    const summary = summarizePlan(plan);

    expect(summary.totalWeeks).toBe(28);
    expect(summary.weeks).toHaveLength(28);
    expect(summary.startDate.slice(0, 10)).toBe('2026-10-05');
    expect(summary.endDate.slice(0, 10)).toBe('2027-04-18');
    expect(summary.peakWeeklyMileage).toBeGreaterThan(0);
    expect(summary.totalMileage).toBeGreaterThan(summary.peakWeeklyMileage);
    expect(summary.phases.length).toBeGreaterThan(0);
  });
});