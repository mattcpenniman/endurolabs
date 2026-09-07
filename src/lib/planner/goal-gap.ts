// ============================================================
// EnduroLab — Goal Gap Analysis
// ============================================================
// Assesses goal feasibility against current forecast, identifies
// the dominant limiting factor, and classifies the gap.
// ============================================================

import {
  buildRaceForecastWithHistoricalRange,
  buildTrainingAdjustedRaceForecast,
} from '@/lib/analytics/race-performance-analysis';
import type { RaceAnalysisActivity, RaceFitnessObservation } from '@/lib/analytics/race-performance-analysis';
import type {
  GoalGapResult,
  Limiter,
  PlannerPlanData,
  ParsedGoal,
} from './models';

const GAP_PCT_SUPPORTED = -0.05;
const GAP_PCT_PLAUSIBLE = 0.10;
const GAP_PCT_UNSUPPORTED = 0.20;

function classifyGap(gapPct: number): 'supported' | 'plausible' | 'unsupported' | 'unsafe' {
  if (gapPct <= GAP_PCT_SUPPORTED) return 'supported';
  if (gapPct <= GAP_PCT_PLAUSIBLE) return 'plausible';
  if (gapPct <= GAP_PCT_UNSUPPORTED) return 'unsupported';
  return 'unsafe';
}

function dataConfidence(evidenceCount: number): 'low' | 'medium' | 'high' {
  if (evidenceCount < 3) return 'low';
  if (evidenceCount < 8) return 'medium';
  return 'high';
}

/**
 * Rank limiting factors by severity and return ordered array.
 */
export function identifyLimiters(
  snapshot: {
    consistencyRate: number;
    peakWeeklyMiles: number;
    trainingFeatures: {
      milesLast28Days: number;
      longestRunMiles: number;
      runsAtLeast12Miles: number;
      runsAtLeast14Miles: number;
      missingWeeks: number;
      longestTrainingGapDays: number;
      activeWeeks: number;
      peakWeeklyMiles: number;
    };
    injuryFlags: string[];
    feelTrend: number | null;
  },
  goalMinutes: number,
  targetDistanceMeters: number,
): Limiter[] {
  const limiters: Limiter[] = [];
  const t28 = snapshot.trainingFeatures.milesLast28Days;

  const marathonGoalTime = goalMinutes;
  const recommendedPeak = marathonGoalTime < 180 ? 90 : marathonGoalTime < 210 ? 75 : marathonGoalTime < 240 ? 60 : marathonGoalTime < 270 ? 50 : 40;

  if (t28 < recommendedPeak * 0.6) {
    limiters.push({
      id: 'insufficient_aerobic_volume',
      label: 'Insufficient aerobic volume',
      severity: t28 < recommendedPeak * 0.4 ? 'high' : 'medium',
      description: `Current 28-day average (${t28.toFixed(1)} mi) is below ${recommendedPeak * 0.6} mi needed for the goal.`,
      evidence: [`28-day mileage: ${t28.toFixed(1)} mi`, `Recommended peak: ${recommendedPeak} mi`],
    });
  }

  if (snapshot.consistencyRate < 0.5) {
    limiters.push({
      id: 'poor_consistency_or_gaps',
      label: 'Poor weekly consistency or training gaps',
      severity: snapshot.consistencyRate < 0.3 ? 'high' : 'medium',
      description: `Consistency rate of ${(snapshot.consistencyRate * 100).toFixed(0)}% suggests irregular training patterns.`,
      evidence: [`Consistency: ${(snapshot.consistencyRate * 100).toFixed(0)}%`, `Missing weeks: ${snapshot.trainingFeatures.missingWeeks}`],
    });
  }

  if (snapshot.trainingFeatures.longestRunMiles < 18 && targetDistanceMeters >= 42000) {
    limiters.push({
      id: 'inadequate_long_run_exposure',
      label: 'Inadequate long-run exposure',
      severity: snapshot.trainingFeatures.longestRunMiles < 14 ? 'high' : 'medium',
      description: `Longest recent run is ${snapshot.trainingFeatures.longestRunMiles.toFixed(1)} mi. Marathon goal suggests 18+ mi base.`,
      evidence: [`Longest run: ${snapshot.trainingFeatures.longestRunMiles.toFixed(1)} mi`],
    });
  }

  if (snapshot.injuryFlags.length > 0) {
    limiters.push({
      id: 'poor_consistency_or_gaps',
      label: 'Recent injury or illness flags',
      severity: 'high',
      description: 'Training logs contain references to injury or illness.',
      evidence: snapshot.injuryFlags,
    });
  }

  if (snapshot.feelTrend != null && snapshot.feelTrend < 4) {
    limiters.push({
      id: 'excessive_recent_load',
      label: 'Excessive recent load or fatigue',
      severity: 'medium',
      description: `Average feel rating is ${snapshot.feelTrend}/10, suggesting accumulated fatigue.`,
      evidence: [`Feel rating: ${snapshot.feelTrend}`],
    });
  }

  limiters.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });

  return limiters;
}

/**
 * Compute goal gap: compare predicted vs goal time, classify feasibility,
 * and identify the dominant limiter.
 */
export function computeGoalGap(
  data: PlannerPlanData,
  parsedGoal: ParsedGoal,
): GoalGapResult {
  const races = data.activities.filter(a => a.eventType === 'race' && !a.excludedFromAnalytics);

  const forecast = buildRaceForecastWithHistoricalRange(races, data.asOf, parsedGoal.distanceMeters);

  if (!forecast) {
    return {
      classification: 'unsupported',
      predictedSeconds: Math.round(parsedGoal.goalMinutes * 60),
      goalSeconds: Math.round(parsedGoal.goalMinutes * 60),
      gapSeconds: 0,
      forecastHorizonDays: 0,
      dataConfidence: 'low',
      evidenceCount: races.length,
      dominantLimiter: 'insufficient_race_evidence',
    };
  }

  const goalSeconds = parsedGoal.goalMinutes * 60;
  const predictedSeconds = forecast.predictedSeconds;
  const gapSeconds = Math.round(predictedSeconds - goalSeconds);
  const gapPct = goalSeconds > 0 ? (predictedSeconds - goalSeconds) / goalSeconds : 0;

  let adjustedForecast;
  const fitnessObs: RaceFitnessObservation[] = data.fitnessObservations || [];
  if (fitnessObs.length >= 2) {
    adjustedForecast = buildTrainingAdjustedRaceForecast(
      data.activities,
      races,
      data.asOf,
      parsedGoal.distanceMeters,
      112,
      0,
      fitnessObs,
      true,
    );
  }

  const finalPredicted = adjustedForecast ? adjustedForecast.predictedSeconds : predictedSeconds;
  const finalGapSeconds = Math.round(finalPredicted - goalSeconds);
  const finalGapPct = goalSeconds > 0 ? (finalPredicted - goalSeconds) / goalSeconds : gapPct;

  const classification = classifyGap(finalGapPct);

  return {
    classification,
    predictedSeconds: Math.round(finalPredicted),
    goalSeconds: Math.round(goalSeconds),
    gapSeconds: finalGapSeconds,
    rangeLow: forecast.historicalErrorRange?.lowerSeconds,
    rangeHigh: forecast.historicalErrorRange?.upperSeconds,
    forecastHorizonDays: 0,
    dataConfidence: dataConfidence(forecast.evidence.length),
    evidenceCount: forecast.evidence.length,
    dominantLimiter: (() => {
      if (classification === 'unsafe') return 'goal_not_supported_by_evidence';
      if (data.activities.filter(a => a.localDate < data.asOf).length < 5) return 'insufficient_aerobic_volume';
      return '';
    })(),
  };
}
