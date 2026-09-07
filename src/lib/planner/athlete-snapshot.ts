// ============================================================
// EnduroLab — Athlete Snapshot Builder
// ============================================================
// Pure function that normalizes athlete state from activities,
// fitness observations, and logs as of a given cutoff date.
// Reuses RaceTrainingFeatures and race predictor readiness logic.
// ============================================================

import { buildRaceTrainingFeatures } from '@/lib/analytics/race-performance-analysis';
import type {
  PlannerAthleteSnapshot,
  PlannerPlanData,
} from './models';
import type { RaceAnalysisActivity, RaceFitnessObservation } from '@/lib/analytics/race-performance-analysis';

const DAY_MS = 86_400_000;

function classifyFitnessTrend(observations: readonly { date: string; watts: number }[], cutoff: string): 'improving' | 'stable' | 'declining' | 'unknown' {
  if (observations.length < 3) return 'unknown';

  const sorted = [...observations].filter(o => o.date <= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 3) return 'unknown';

  const mid = Math.floor(sorted.length / 2);
  const early = sorted.slice(0, mid);
  const late = sorted.slice(mid);

  const avgEarly = early.reduce((sum, o) => sum + o.watts, 0) / early.length;
  const avgLate = late.reduce((sum, o) => sum + o.watts, 0) / late.length;

  const delta = ((avgLate - avgEarly) / Math.max(avgEarly, 1)) * 100;
  if (delta > 2) return 'improving';
  if (delta < -2) return 'declining';
  return 'stable';
}

function extractInjuryFlags(logs: readonly { notes?: string }[]): string[] {
  const flags: string[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    if (!log.notes) continue;
    const entry = log.notes.toLowerCase();
    if (/injur/.test(entry) && !seen.has('injury')) {
      seen.add('injury');
      flags.push('Recent injury mentioned in training logs');
    }
    if (/ill/.test(entry) && !seen.has('illness')) {
      seen.add('illness');
      flags.push('Recent illness mentioned in training logs');
    }
  }
  return flags;
}

function computeFeelTrend(logs: readonly { feelRating?: number | null; loggedAt?: string }[]): number | null {
  const entries = logs.filter(l => typeof l.feelRating === 'number' && l.loggedAt).length;
  if (entries < 2) return null;

  let sum = 0;
  let count = 0;
  for (const log of logs) {
    if (typeof log.feelRating === 'number') {
      sum += log.feelRating;
      count++;
    }
  }
  return count ? Math.round((sum / count) * 10) / 10 : null;
}

function computeConsistency(activities: readonly RaceAnalysisActivity[], cutoffDate: string): number {
  if (activities.length === 0) return 0;

  const recent = activities.filter(a => a.localDate <= cutoffDate);
  if (recent.length === 0) return 0;

  const uniqueDays = new Set(recent.map(a => a.localDate));
  const earliest = Math.min(...Array.from(uniqueDays).map(d => new Date(d).getTime()));
  const latest = Math.max(...Array.from(uniqueDays).map(d => new Date(d).getTime()));
  const spanDays = Math.max((latest - earliest) / DAY_MS, 1);

  if (spanDays < 28) return uniqueDays.size / Math.min(spanDays, recent.length || 1);

  const weeks = Math.ceil(spanDays / 7);
  return Math.min(uniqueDays.size / (weeks * 4), 1);
}

/**
* Build a normalized athlete snapshot from raw data. Only considers
* data strictly before the `asOf` cutoff to prevent leakage.
*/
export function buildAthleteSnapshot(data: PlannerPlanData): PlannerAthleteSnapshot {
  const { activities, fitnessObservations, logs, asOf } = data;

  const filteredActivities = activities.filter(a => a.localDate < asOf);
  const trainingFeatures = buildRaceTrainingFeatures(filteredActivities, asOf, 112);

  const fitnessTrend = classifyFitnessTrend(fitnessObservations, asOf);
  const injuryFlags = extractInjuryFlags(logs);
  const feelTrend = computeFeelTrend(logs);
  const consistencyRate = Math.round(computeConsistency(filteredActivities, asOf) * 1000) / 1000;

  let weightedAvgPower: number | null = null;
  const poweredRuns = filteredActivities.filter(a => a.averagePower != null && a.averagePower > 0);
  if (poweredRuns.length > 0) {
    const totalDist = poweredRuns.reduce((s, a) => s + (a.distanceMeters || 0), 0);
    if (totalDist > 0) {
      weightedAvgPower = Math.round(poweredRuns.reduce((s, a) => s + ((a.averagePower || 0) * (a.distanceMeters || 0)), 0) / totalDist);
    }
  }

  return {
    sourceMaxTimestamp: data.sourceMaxTimestamp,
    asOf,
    trainingFeatures,
    readinessResult: null,
    fitnessTrend,
    injuryFlags,
    feelTrend,
    consistencyRate,
    peakWeeklyMiles: trainingFeatures.peakWeeklyMiles,
    weightedAvgPower,
  };
}
