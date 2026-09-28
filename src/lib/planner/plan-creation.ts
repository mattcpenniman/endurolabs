// ============================================================
// EnduroLab — Plan Creation
// ============================================================
// Pure helpers for the planner CLI's --create mode: merge a base
// runner profile with creation options, validate the calendar, and
// summarize a generated plan. No database or UI dependencies.
// ============================================================

import dayjs from 'dayjs';
import type { MarathonPlan, RunnerProfile } from '@/lib/training/models';
import type { SafetyGateResult } from './models';

export const MIN_PLAN_WEEKS = 14;
export const MAX_PLAN_WEEKS = 28;

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreatePlanOptions {
  raceDate: string;
  goalMinutes: number;
  raceName?: string;
  weeks?: number;
  maxWeeklyMileage?: number;
  maxLongRun?: number;
  trainingDays?: number;
  longRunDay?: string;
  noDoubles?: boolean;
  resetWeeklyOverrides?: boolean;
}

export interface PlanWeekSummary {
  week: number;
  miles: number;
  phase: string;
  downWeek: boolean;
  longRunMiles: number;
}

export interface PlanSummary {
  raceName: string | null;
  raceDate: string;
  totalWeeks: number;
  startDate: string;
  endDate: string;
  peakWeeklyMileage: number;
  totalMileage: number;
  downWeeks: number;
  phases: Array<{ name: string; startWeek: number; endWeek: number }>;
  weeks: PlanWeekSummary[];
  feasibility: string;
  recommendedPeakMileage: number;
  riskWarnings: string[];
}

/**
 * Validate creation options against the calendar and sensible bounds.
 * Returns human-readable errors; an empty array means the options are usable.
 */
export function validateCreateOptions(options: CreatePlanOptions, today: string): string[] {
  const errors: string[] = [];

  if (!DATE_RE.test(options.raceDate ?? '') || !dayjs(options.raceDate).isValid()) {
    errors.push(`--race-date must be YYYY-MM-DD (received "${options.raceDate}")`);
  } else if (!dayjs(options.raceDate).isAfter(dayjs(today), 'day')) {
    errors.push(`--race-date ${options.raceDate} must be in the future (today is ${today})`);
  }

  if (!Number.isFinite(options.goalMinutes)) {
    errors.push('--goal is required and must be H:MM:SS');
  } else if (options.goalMinutes < 120 || options.goalMinutes > 480) {
    errors.push(`--goal ${options.goalMinutes.toFixed(1)} min is outside the 2:00–8:00 marathon range`);
  }

  if (options.weeks != null) {
    if (!Number.isInteger(options.weeks) || options.weeks < MIN_PLAN_WEEKS || options.weeks > MAX_PLAN_WEEKS) {
      errors.push(`--weeks must be an integer between ${MIN_PLAN_WEEKS} and ${MAX_PLAN_WEEKS}`);
    }
  }

  if (options.maxWeeklyMileage != null && (!Number.isFinite(options.maxWeeklyMileage) || options.maxWeeklyMileage < 10 || options.maxWeeklyMileage > 120)) {
    errors.push('--max-weekly-mileage must be between 10 and 120');
  }

  if (options.maxLongRun != null && (!Number.isFinite(options.maxLongRun) || options.maxLongRun < 4 || options.maxLongRun > 30)) {
    errors.push('--max-long-run must be between 4 and 30');
  }

  if (options.trainingDays != null && (!Number.isInteger(options.trainingDays) || options.trainingDays < 3 || options.trainingDays > 7)) {
    errors.push('--days must name between 3 and 7 weekdays');
  }

  if (options.longRunDay != null && !WEEKDAYS.includes(options.longRunDay as (typeof WEEKDAYS)[number])) {
    errors.push(`--long-run-day must be a weekday name (received "${options.longRunDay}")`);
  }

  return errors;
}

/**
 * Merge a stored runner profile with creation options into the profile
 * that feeds generatePlan(). Explicit options win; the base profile keeps
 * volume, schedule, and race-history fields unless overridden.
 */
export function buildCreateProfile(base: RunnerProfile, options: CreatePlanOptions): RunnerProfile {
  const profile: RunnerProfile = {
    ...base,
    raceDate: options.raceDate,
    goalMarathonTime: options.goalMinutes,
    weeksOverride: options.weeks ?? null,
  };

  if (options.raceName) profile.raceName = options.raceName;

  if (options.resetWeeklyOverrides) {
    delete profile.weeklyMileageOverrides;
    delete profile.weeklyIntensityOverrides;
  }

  if (options.maxWeeklyMileage != null) {
    profile.peakMileageOverride = Math.max(10, Math.min(120, options.maxWeeklyMileage));
  }

  if (options.maxLongRun != null) {
    profile.maxLongRunOverride = Math.max(4, Math.min(30, options.maxLongRun));
  }

  if (options.trainingDays != null) {
    profile.trainingDaysPerWeek = Math.max(3, Math.min(7, options.trainingDays));
  }

  if (options.longRunDay) {
    profile.availableLongRunDays = [options.longRunDay];
  }

  if (options.noDoubles) {
    profile.runsPerWeekOverride = profile.trainingDaysPerWeek;
    profile.preferredDoubleUpDays = [];
  }

  return profile;
}

/**
 * Calendar gates that must hold before a newly generated plan may be
 * persisted: the plan starts today or later, ends on the requested race
 * date, and has a race week.
 */
export function validatePlanCalendar(
  plan: MarathonPlan,
  today: string,
  raceDate: string,
): SafetyGateResult[] {
  const gates: SafetyGateResult[] = [];
  const firstWeek = plan.weeks[0];
  const lastWeek = plan.weeks[plan.weeks.length - 1];

  if (plan.raceDay !== raceDate) {
    gates.push({
      checkId: 'race_date_match',
      result: 'refuse',
      message: `Generated race day ${plan.raceDay} does not match requested race date ${raceDate}`,
    });
  } else {
    gates.push({ checkId: 'race_date_match', result: 'pass', message: `Race day matches ${raceDate}` });
  }

  if (!firstWeek) {
    gates.push({ checkId: 'plan_start', result: 'refuse', message: 'Generated plan has no weeks' });
  } else if (dayjs(firstWeek.startDate).isBefore(dayjs(today), 'day')) {
    gates.push({
      checkId: 'plan_start',
      result: 'refuse',
      message: `Plan starts ${firstWeek.startDate.slice(0, 10)}, before today (${today}). Reduce --weeks, choose a later race date, or backfill a historical plan with plan:create-from-garmin.`,
    });
  } else {
    gates.push({
      checkId: 'plan_start',
      result: 'pass',
      message: `Plan starts ${firstWeek.startDate.slice(0, 10)} (today is ${today})`,
    });
  }

  if (lastWeek && dayjs(lastWeek.endDate).isBefore(dayjs(raceDate), 'day')) {
    gates.push({
      checkId: 'race_week_coverage',
      result: 'refuse',
      message: `Plan ends ${lastWeek.endDate.slice(0, 10)}, before the race date ${raceDate}`,
    });
  } else {
    gates.push({ checkId: 'race_week_coverage', result: 'pass', message: 'Race day falls inside the final week' });
  }

  if (plan.totalWeeks < MIN_PLAN_WEEKS || plan.totalWeeks > MAX_PLAN_WEEKS) {
    gates.push({
      checkId: 'weeks_bounds',
      result: 'refuse',
      message: `Plan has ${plan.totalWeeks} weeks; must be ${MIN_PLAN_WEEKS}–${MAX_PLAN_WEEKS}`,
    });
  } else {
    gates.push({ checkId: 'weeks_bounds', result: 'pass', message: `Plan has ${plan.totalWeeks} weeks` });
  }

  return gates;
}

/**
 * Compact, stable summary of a generated plan for CLI preview and JSON output.
 */
export function summarizePlan(plan: MarathonPlan): PlanSummary {
  const totalMileage = plan.weeks.reduce((sum, week) => sum + week.totalMileage, 0);

  return {
    raceName: plan.runnerProfile.raceName ?? null,
    raceDate: plan.raceDay,
    totalWeeks: plan.totalWeeks,
    startDate: plan.weeks[0]?.startDate ?? '',
    endDate: plan.weeks[plan.weeks.length - 1]?.endDate ?? '',
    peakWeeklyMileage: plan.peakWeeklyMileage,
    totalMileage: Math.round(totalMileage),
    downWeeks: plan.weeks.filter((week) => week.isDownWeek).length,
    phases: plan.phases.map((phase) => ({
      name: phase.name,
      startWeek: phase.weekRange[0],
      endWeek: phase.weekRange[1],
    })),
    weeks: plan.weeks.map((week) => ({
      week: week.weekNumber,
      miles: week.totalMileage,
      phase: week.phase,
      downWeek: week.isDownWeek,
      longRunMiles: week.longRunDistance,
    })),
    feasibility: plan.goalAssessment?.feasibility ?? 'unknown',
    recommendedPeakMileage: plan.goalAssessment?.recommendedPeakMileage ?? plan.peakWeeklyMileage,
    riskWarnings: plan.riskWarnings ?? [],
  };
}