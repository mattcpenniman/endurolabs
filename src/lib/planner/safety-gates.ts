// ============================================================
// EnduroLab — Safety Gates
// ============================================================
// Hard refusal and warning rules evaluated against plan data
// and athlete constraints. Returns structured pass/warn/refuse results.
// ============================================================

import type { MarathonPlan, WeeklyPlan } from '@/lib/training/models';
import type { PlannerAthleteSnapshot, PlannerConstraints, SafetyGateResult } from './models';

const MAX_WEEKLY_PROGRESSION = 0.20;
const LONG_RUN_MAX_SHARE = 0.40;
const MIN_TAPER_WEEKS = 1;
const MIN_RECOVERY_RATIO = 0.25;

function checkWeeklyProgression(weeks: readonly WeeklyPlan[]): SafetyGateResult {
  for (let i = 1; i < weeks.length; i++) {
    const prev = weeks[i - 1].totalMileage;
    const curr = weeks[i].totalMileage;
    if (prev > 0 && (curr - prev) / prev > MAX_WEEKLY_PROGRESSION && !weeks[i].isDownWeek) {
      return {
        checkId: 'weekly_progression',
        result: 'warn',
        message: `Week ${i + 1} increases mileage by ${((curr - prev) / prev * 100).toFixed(0)}% (threshold: ${MAX_WEEKLY_PROGRESSION * 100}%)`,
      };
    }
  }
  return { checkId: 'weekly_progression', result: 'pass', message: 'Weekly progression within safe bounds' };
}

function checkLongRunShare(weeks: readonly WeeklyPlan[]): SafetyGateResult {
  for (const week of weeks) {
    if (week.totalMileage > 0 && week.longRunDistance / week.totalMileage > LONG_RUN_MAX_SHARE) {
      return {
        checkId: 'long_run_share',
        result: 'warn',
        message: `Week ${week.weekNumber}: long run is ${(week.longRunDistance / week.totalMileage * 100).toFixed(0)}% of weekly mileage (max: ${(LONG_RUN_MAX_SHARE * 100).toFixed(0)}%)`,
      };
    }
  }
  return { checkId: 'long_run_share', result: 'pass', message: 'Long run share within bounds' };
}

function checkRecoveryPlacement(weeks: readonly WeeklyPlan[]): SafetyGateResult {
  const downWeeks = weeks.filter(w => w.isDownWeek);
  const ratio = weeks.length > 0 ? downWeeks.length / weeks.length : 0;

  if (ratio < MIN_RECOVERY_RATIO) {
    return {
      checkId: 'recovery_placement',
      result: 'warn',
      message: `Only ${downWeeks.length} of ${weeks.length} weeks are down weeks (${(ratio * 100).toFixed(0)}%, recommend ${(MIN_RECOVERY_RATIO * 100).toFixed(0)}%+)`,
    };
  }
  return { checkId: 'recovery_placement', result: 'pass', message: 'Down week frequency adequate' };
}

function checkTaper(plan: MarathonPlan): SafetyGateResult {
  const taperWeeks = plan.weeks.filter(w => w.phase === 'peak_taper');

  if (taperWeeks.length < MIN_TAPER_WEEKS) {
    return {
      checkId: 'taper_presence',
      result: 'refuse',
      message: `No taper phase detected. Minimum ${MIN_TAPER_WEEKS} week required.`,
    };
  }

  if (plan.weeks.length < 2) return { checkId: 'taper_presence', result: 'pass', message: 'Insufficient weeks to evaluate taper' };

  const preTaper = plan.weeks.filter(w => w.phase !== 'peak_taper');
  if (preTaper.length === 0) return { checkId: 'taper_presence', result: 'pass', message: 'Plan is entirely taper phase' };

  const avgPreMileage = preTaper.reduce((s, w) => s + w.totalMileage, 0) / preTaper.length;
  const avgTaperMileage = taperWeeks.reduce((s, w) => s + w.totalMileage, 0) / taperWeeks.length;

  if (avgPreMileage > 0 && avgTaperMileage >= avgPreMileage * 0.8) {
    return {
      checkId: 'taper_presence',
      result: 'warn',
      message: `Taper reduction is only ${((1 - avgTaperMileage / avgPreMileage) * 100).toFixed(0)}% (recommend ≥20% volume reduction)`,
    };
  }

  return { checkId: 'taper_presence', result: 'pass', message: 'Taper phase present with appropriate volume reduction' };
}

function checkIntensityAdjacency(plan: MarathonPlan): SafetyGateResult {
  for (const week of plan.weeks) {
    let consecutiveHard = 0;
    for (const day of week.days) {
      const wkt = day.workout;
      if (!wkt) {
        consecutiveHard = 0;
        continue;
      }
      if (wkt.intensityCategory === 'hard') {
        consecutiveHard++;
      } else {
        consecutiveHard = 0;
      }
      if (consecutiveHard >= 3) {
        return {
          checkId: 'intensity_adjacency',
          result: 'warn',
          message: `Week ${week.weekNumber}: ${consecutiveHard} consecutive hard sessions`,
        };
      }
    }
  }
  return { checkId: 'intensity_adjacency', result: 'pass', message: 'No excessive adjacent intensity sessions' };
}

function checkMileageCeiling(snapshot: PlannerAthleteSnapshot, constraints: PlannerConstraints): SafetyGateResult {
  const maxWeekly = constraints.maxWeeklyMileage ?? snapshot.peakWeeklyMiles * 1.25;
  if (snapshot.trainingFeatures.peakWeeklyMiles > maxWeekly) {
    return {
      checkId: 'mileage_ceiling',
      result: 'warn',
      message: `Peak mileage (${snapshot.trainingFeatures.peakWeeklyMiles.toFixed(1)}) near limit (${maxWeekly.toFixed(1)})`,
    };
  }
  return { checkId: 'mileage_ceiling', result: 'pass', message: 'Mileage within ceiling' };
}

function checkInjuryFlags(snapshot: PlannerAthleteSnapshot): SafetyGateResult {
  if (snapshot.injuryFlags.length > 0) {
    return {
      checkId: 'injury_flags',
      result: 'refuse',
      message: `Active injury/illness flags detected: ${snapshot.injuryFlags.join('; ')}`,
    };
  }
  return { checkId: 'injury_flags', result: 'pass', message: 'No active injury or illness flags' };
}

function checkDataStaleness(snapshot: PlannerAthleteSnapshot): SafetyGateResult {
  if (snapshot.trainingFeatures.runs < 5) {
    return {
      checkId: 'data_staleness',
      result: 'refuse',
      message: `Insufficient activity data: ${snapshot.trainingFeatures.runs} runs in window. Require at least 5.`,
    };
  }
  if (snapshot.consistencyRate < 0.2) {
    return {
      checkId: 'data_staleness',
      result: 'warn',
      message: `Very low consistency (${(snapshot.consistencyRate * 100).toFixed(0)}%). Training data may be unreliable.`,
    };
  }
  return { checkId: 'data_staleness', result: 'pass', message: 'Activity data sufficient and consistent' };
}

/**
 * Run all safety gates against the plan and athlete data.
 */
export function runSafetyGates(
  plan: MarathonPlan,
  snapshot: PlannerAthleteSnapshot,
  constraints: PlannerConstraints,
): SafetyGateResult[] {
  return [
    checkDataStaleness(snapshot),
    checkInjuryFlags(snapshot),
    checkMileageCeiling(snapshot, constraints),
    checkWeeklyProgression(plan.weeks),
    checkLongRunShare(plan.weeks),
    checkRecoveryPlacement(plan.weeks),
    checkTaper(plan),
    checkIntensityAdjacency(plan),
  ];
}
