// ============================================================
// EnduroLab — Recommendations Builder
// ============================================================
// Maps limiters and goal-gap state to structured, prioritized
// recommendations with evidence and human-readable explanations.
// ============================================================

import type { MarathonPlan } from '@/lib/training/models';
import type { Limiter, Recommendation, PlannerAthleteSnapshot } from './models';

function recommendedPeakForGoal(goalMinutes: number): number {
  if (goalMinutes < 180) return 90;
  if (goalMinutes < 210) return 75;
  if (goalMinutes < 240) return 60;
  if (goalMinutes < 270) return 50;
  return 40;
}

function longRunTargetForGoal(goalMinutes: number): number {
  if (goalMinutes < 180) return 22;
  if (goalMinutes < 210) return 20;
  if (goalMinutes < 240) return 18;
  if (goalMinutes < 270) return 16;
  return 14;
}

function buildMileageRecommendation(
  snapshot: PlannerAthleteSnapshot,
  goalMinutes: number,
): Recommendation | null {
  const recommendedPeak = recommendedPeakForGoal(goalMinutes);
  const currentAvg = snapshot.trainingFeatures.averageWeeklyMiles;

  if (currentAvg >= recommendedPeak * 0.7) return null;

  const jump = currentAvg >= recommendedPeak * 0.5 ? 'medium' : 'high';
  const target = Math.min(recommendedPeak, snapshot.peakWeeklyMiles);

  return {
    type: 'increase_weekly_mileage',
    priority: jump === 'high' ? 'high' : 'medium',
    before: Math.round(currentAvg),
    after: Math.round(target),
    expectedPurpose: 'Increase aerobic base for marathon durability',
    evidence: [
      `Current average: ${currentAvg.toFixed(1)} mi/week`,
      `Recommended peak: ${recommendedPeak} mi/week`,
      `Historical peak: ${snapshot.peakWeeklyMiles.toFixed(1)} mi`,
    ],
    risk: jump === 'high' ? 'medium' : 'low',
    reversible: true,
  };
}

function buildLongRunRecommendation(
  snapshot: PlannerAthleteSnapshot,
  goalMinutes: number,
): Recommendation | null {
  const lrTarget = longRunTargetForGoal(goalMinutes);
  const current = snapshot.trainingFeatures.longestRunMiles;
  const gap = lrTarget - current;

  if (gap <= 0) return null;

  return {
    type: 'progress_long_run',
    priority: gap > 4 ? 'high' : 'medium',
    before: Math.round(current),
    after: Math.round(lrTarget),
    expectedPurpose: 'Build long-run durability for race distance',
    evidence: [
      `Longest recent run: ${current.toFixed(1)} mi`,
      `Recommended long run: ${lrTarget} mi`,
      `Runs ≥12 mi: ${snapshot.trainingFeatures.runsAtLeast12Miles}`,
    ],
    risk: gap > 6 ? 'high' : 'low',
    reversible: true,
  };
}

function buildConsistencyRecommendation(snapshot: PlannerAthleteSnapshot): Recommendation | null {
  if (snapshot.consistencyRate >= 0.5) return null;
  const gaps = snapshot.trainingFeatures.longestTrainingGapDays;

  return {
    type: 'improve_consistency',
    priority: 'high',
    expectedPurpose: 'Reduce training gaps and improve weekly adherence',
    evidence: [
      `Consistency rate: ${(snapshot.consistencyRate * 100).toFixed(0)}%`,
      `Longest training gap: ${gaps} days`,
      `Missing weeks: ${snapshot.trainingFeatures.missingWeeks}`,
    ],
    risk: 'low',
    reversible: true,
  };
}

function buildIntensityRecommendation(plan: MarathonPlan): Recommendation | null {
  const hardWeeks = plan.weeks.filter(w => {
    const totalMileage = w.totalMileage;
    if (totalMileage <= 0) return false;
    const specificShare = (w.intensityDistribution.threshold + w.intensityDistribution.vo2 + w.intensityDistribution.marathon) / totalMileage;
    return specificShare > 0.25;
  });

  if (hardWeeks.length < plan.weeks.length * 0.3) {
    return {
      type: 'increase_specific_intensity',
      priority: 'medium',
      expectedPurpose: 'Add marathon-specific threshold and VO2 work to improve race-day pacing',
      evidence: [
        `Only ${hardWeeks.length} of ${plan.weeks.length} weeks contain significant specific work`,
        `Target: ≥30% of weeks with structured intensity`,
      ],
      risk: 'low',
      reversible: true,
    };
  }
  return null;
}

function buildRecoveryRecommendation(plan: MarathonPlan): Recommendation | null {
  const downWeeks = plan.weeks.filter(w => w.isDownWeek);
  const ratio = downWeeks.length / Math.max(plan.weeks.length, 1);

  if (ratio >= 0.25) return null;

  return {
    type: 'add_recovery_weeks',
    priority: 'medium',
    expectedPurpose: 'Insert down weeks to prevent overtraining and ensure peak freshness',
    evidence: [
      `Down-week ratio: ${(ratio * 100).toFixed(0)}% (recommend ≥25%)`,
      `Current down weeks: ${downWeeks.length} of ${plan.weeks.length}`,
    ],
    risk: 'low',
    reversible: true,
  };
}

function buildFitnessRecommendation(snapshot: PlannerAthleteSnapshot): Recommendation | null {
  if (snapshot.fitnessTrend === 'improving' || snapshot.fitnessTrend === 'unknown') return null;

  return {
    type: 'address_fitness_decline',
    priority: snapshot.fitnessTrend === 'declining' ? 'high' : 'medium',
    expectedPurpose:
      `Fitness trend is ${snapshot.fitnessTrend}. Consider load management or targeted quality sessions.`,
    evidence: [`Fitness trend: ${snapshot.fitnessTrend}`],
    risk: 'low',
    reversible: true,
  };
}

function recommendationToExplanation(rec: Recommendation): string {
  const parts: string[] = [];
  parts.push(`[${rec.priority.toUpperCase()}] ${rec.expectedPurpose}`);
  if (rec.before != null && rec.after != null) {
    parts.push(`Target change: ${rec.before} → ${rec.after}`);
  }
  parts.push(`Risk: ${rec.risk}${rec.reversible ? ' (reversible)' : ' (irreversible)'}`);
  return parts.join('. ') + '.';
}

function limiterToExplanation(limiter: Limiter): string {
  return `[${limiter.severity.toUpperCase()}] ${limiter.label}: ${limiter.description}`;
}

/**
 * Generate prioritized, structured recommendations from snapshot
 * and plan data. Each recommendation carries evidence and can be
 * serialized to JSON for --json output.
 */
export function buildRecommendations(
  snapshot: PlannerAthleteSnapshot,
  plan: MarathonPlan,
  goalMinutes: number,
): Recommendation[] {
  const recs: Recommendation[] = [];

  if (buildMileageRecommendation(snapshot, goalMinutes)) {
    recs.push(buildMileageRecommendation(snapshot, goalMinutes)!);
  }
  if (buildLongRunRecommendation(snapshot, goalMinutes)) {
    recs.push(buildLongRunRecommendation(snapshot, goalMinutes)!);
  }
  if (buildConsistencyRecommendation(snapshot)) {
    recs.push(buildConsistencyRecommendation(snapshot)!);
  }
  if (buildIntensityRecommendation(plan)) {
    recs.push(buildIntensityRecommendation(plan)!);
  }
  if (buildRecoveryRecommendation(plan)) {
    recs.push(buildRecoveryRecommendation(plan)!);
  }
  if (buildFitnessRecommendation(snapshot)) {
    recs.push(buildFitnessRecommendation(snapshot)!);
  }

  return recs;
}

/**
 * Generate human-readable explanation text for terminal output.
 */
export function formatReport(
  recs: Recommendation[],
  limiters: Limiter[],
): string {
  const lines: string[] = [];

  if (limiters.length > 0) {
    lines.push('Limiting Factors:');
    for (const l of limiters) {
      lines.push(`  • ${limiterToExplanation(l)}`);
    }
    lines.push('');
  }

  if (recs.length > 0) {
    lines.push('Recommendations:');
    for (const r of recs) {
      lines.push(`  • ${recommendationToExplanation(r)}`);
    }
  } else {
    lines.push('No additional recommendations. Plan appears on track.');
  }

  return lines.join('\n');
}
