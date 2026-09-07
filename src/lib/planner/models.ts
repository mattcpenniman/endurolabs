// ============================================================
// EnduroLab — Goal-Directed Planner Models
// ============================================================
// Input constraints, recommendation types, and proposal shapes
// for the read-only planner CLI (Phase 1).
// ============================================================

import type { MarathonPlan, RunnerProfile, WeeklyLog } from '@/lib/training/models';
import type { RaceAnalysisActivity, RaceFitnessObservation, RaceTrainingFeatures } from '@/lib/analytics/race-performance-analysis';
import type { RacePredictorResult, RaceReadinessResult } from '@/lib/analytics/race-predictor';

// ─── CLI Input Constraints ──────────────────────────────────

export interface PlannerConstraints {
  maxWeeklyMileage?: number;
  maxLongRun?: number;
  days?: string[];
  longRunDay?: string;
  noDoubles?: boolean;
  noNewIntensity?: boolean;
  riskTolerance?: 'conservative' | 'balanced' | 'aggressive';
}

// ─── Goal Parsing ───────────────────────────────────────────

export interface ParsedGoal {
  goalMinutes: number;
  distanceMeters: number;
  distanceLabel: string;
}

export const DISTANCE_MAP: Record<string, { meters: number; label: string }> = {
  '5k': { meters: 5000, label: '5K' },
  '10k': { meters: 10000, label: '10K' },
  '10-mile': { meters: 16093.44, label: '10 Mile' },
  'half_marathon': { meters: 21097.5, label: 'Half Marathon' },
  'marathon': { meters: 42195, label: 'Marathon' },
};

export function parseGoalTime(timeStr: string): number | null {
  const match = timeStr.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

export function parseDistance(dist: string): { meters: number; label: string } | null {
  const key = dist.toLowerCase().replace(/\s+/g, '_');
  if (DISTANCE_MAP[key]) return DISTANCE_MAP[key];
  const miles = parseFloat(dist);
  if (miles > 0 && miles <= 100) {
    return { meters: miles * 1609.344, label: `${miles} Mile${miles !== 1 ? 's' : ''}` };
  }
  return null;
}

// ─── Athlete Snapshot ───────────────────────────────────────

export interface PlannerAthleteSnapshot {
  sourceMaxTimestamp: string;
  asOf: string;
  trainingFeatures: RaceTrainingFeatures;
  readinessResult: RaceReadinessResult | null;
  fitnessTrend: 'improving' | 'stable' | 'declining' | 'unknown';
  injuryFlags: string[];
  feelTrend: number | null;
  consistencyRate: number;
  peakWeeklyMiles: number;
  weightedAvgPower?: number | null;
}

// ─── Goal Gap ───────────────────────────────────────────────

export type GoalClassification = 'supported' | 'plausible' | 'unsupported' | 'unsafe';

export interface GoalGapResult {
  classification: GoalClassification;
  predictedSeconds: number;
  goalSeconds: number;
  gapSeconds: number;
  rangeLow?: number;
  rangeHigh?: number;
  forecastHorizonDays: number;
  dataConfidence: 'low' | 'medium' | 'high';
  evidenceCount: number;
  dominantLimiter: string;
}

// ─── Limiting Factors ──────────────────────────────────────

export interface Limiter {
  id: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence: string[];
}

export const LIMITER_IDS = [
  'insufficient_aerobic_volume',
  'poor_consistency_or_gaps',
  'inadequate_long_run_exposure',
  'weak_long_run_pace_retention',
  'insufficient_marathon_specific_work',
  'threshold_vo2_weakness',
  'excessive_recent_load',
  'missing_recovery',
  'goal_not_supported_by_evidence',
  'course_weather_mismatch',
  'insufficient_time_remaining',
] as const;

// ─── Recommendations ────────────────────────────────────────

export interface Recommendation {
  type: string;
  priority: 'low' | 'medium' | 'high';
  weeks?: number[];
  before?: number;
  after?: number;
  expectedPurpose: string;
  evidence: string[];
  risk: 'low' | 'medium' | 'high';
  reversible: boolean;
}

// ─── Safety Gates ───────────────────────────────────────────

export type SafetyResult = 'pass' | 'warn' | 'refuse';

export interface SafetyGateResult {
  checkId: string;
  result: SafetyResult;
  message: string;
}

// ─── Full Analysis Output ───────────────────────────────────

export interface PlannerAnalysisOutput {
  version: string;
  planId: string;
  asOf: string;
  constraints: PlannerConstraints;
  parsedGoal?: ParsedGoal;
  snapshot: PlannerAthleteSnapshot;
  goalGap: GoalGapResult;
  forecastBefore: RacePredictorResult | null;
  limiters: Limiter[];
  recommendations: Recommendation[];
  safetyGates: SafetyGateResult[];
}

// ─── CLI Context (assembled by the script) ──────────────────

export interface PlannerContext {
  planId?: string;
  email?: string;
  raceDate?: string;
  distance?: string;
  goal?: string;
  asOf?: string;
  create?: boolean;
  adjust?: boolean;
  apply?: boolean;
  json?: boolean;
  output?: string;
  constraints: PlannerConstraints;
}

// ─── Normalized Plan Data (passed into pure functions) ──────

export interface PlannerPlanData {
  plan: MarathonPlan;
  activities: RaceAnalysisActivity[];
  fitnessObservations: RaceFitnessObservation[];
  logs: WeeklyLog[];
  asOf: string;
  sourceMaxTimestamp: string;
}
