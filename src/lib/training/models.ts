// ============================================================
// EnduroLab — Data Models
// ============================================================
// Core types for runner profiles, pace/power zones, workouts,
// and the complete plan structure.
// ============================================================

// ─── Time Utilities ─────────────────────────────────────────

export interface TimeValue {
  hours: number;
  minutes: number;
  seconds: number;
}

export function minutesToTime(minutes: number): TimeValue {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const s = Math.round((minutes % 1) * 60);
  return { hours: h, minutes: m, seconds: s };
}

export function timeToMinutes(t: TimeValue): number {
  return t.hours * 60 + t.minutes + t.seconds / 60;
}

export function formatTime(t: TimeValue): string {
  if (t.hours > 0) {
    return `${t.hours}:${String(t.minutes).padStart(2, "0")}:${String(t.seconds).padStart(2, "0")}`;
  }
  return `${t.minutes}:${String(t.seconds).padStart(2, "0")}`;
}

export function formatPace(paceMinPerMile: number): string {
  const m = Math.floor(paceMinPerMile);
  const s = Math.round((paceMinPerMile - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Runner Profile ────────────────────────────────────────

export interface RunnerProfile {
  currentWeeklyMileage: number;
  peakHistoricalWeeklyMileage: number;
  currentMarathonPR: number | null;       // minutes
  currentHalfMarathonPR: number | null;   // minutes
  goalMarathonTime: number;               // minutes
  raceDate: string;                       // ISO date string
  trainingDaysPerWeek: number;
  preferredRestDay: string;               // "Monday", "Tuesday", etc.
  recentInjuryHistory: string;            // free text
  averageEasyPace: number | null;         // min/mile
  averageMarathonPace: number | null;     // min/mile
  averageThresholdPace: number | null;    // min/mile
  hasAppleWatchPower: boolean;
  appleWatchPowerData?: {
    easyPower: number | null;
    marathonPower: number | null;
    thresholdPower: number | null;
  };
  longestRecentLongRun: number;           // miles
  comfortLevelWithWorkouts: "beginner" | "intermediate" | "advanced";
  availableLongRunDays: string[];         // e.g. ["Sunday", "Saturday"]
  strengthTrainingAvailability: "none" | "light" | "regular";
}

// ─── Pace Zones ────────────────────────────────────────────

export interface PaceZones {
  easy: { min: number; max: number };           // min/mile
  marathon: number;                              // min/mile
  threshold: number;                             // min/mile
  vo2: number;                                   // min/mile
  recovery: number;                              // min/mile
  easyEffort: string;                            // RPE descriptor
  marathonEffort: string;
  thresholdEffort: string;
  vo2Effort: string;
}

export interface PowerZones {
  easy: { min: number; max: number };            // watts
  marathon: number;                              // watts
  threshold: number;                             // watts
  vo2: number;                                   // watts
}

// ─── Workout Types ─────────────────────────────────────────

export type WorkoutType =
  | "easy"
  | "recovery"
  | "threshold"
  | "marathon_pace"
  | "vo2"
  | "long"
  | "progression"
  | "strength"
  | "rest";

export interface WorkoutSegment {
  description: string;
  distance?: number;       // miles
  duration?: number;       // minutes
  pace?: number;           // min/mile target
  power?: number;          // watts target
  effort?: string;         // RPE descriptor
  restBetween?: number;    // seconds
  repetitions?: number;
  type: WorkoutType;
}

export interface Workout {
  id: string;
  type: WorkoutType;
  title: string;
  description: string;
  segments: WorkoutSegment[];
  totalDistance: number;     // miles
  estimatedDuration: number; // minutes
  weeklyMileageContribution: number;
  intensityCategory: "easy" | "moderate" | "hard";
}

// ─── Daily Plan ────────────────────────────────────────────

export interface DailyPlan {
  date: string;              // ISO date
  dayOfWeek: string;
  workout: Workout | null;
  isRestDay: boolean;
  plannedMileage: number;
}

// ─── Weekly Plan ───────────────────────────────────────────

export interface WeeklyPlan {
  weekNumber: number;
  startDate: string;
  endDate: string;
  phase: TrainingPhase;
  days: DailyPlan[];
  totalMileage: number;
  isDownWeek: boolean;
  longRunDistance: number;
  intensityDistribution: {
    easy: number;
    threshold: number;
    marathon: number;
    vo2: number;
  };
}

// ─── Training Phase ────────────────────────────────────────

export type TrainingPhase = "base" | "marathon_build" | "peak_taper";

export interface PhaseInfo {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  weekRange: [number, number];
}

// ─── Complete Plan ─────────────────────────────────────────

export interface MarathonPlan {
  id: string;
  runnerProfile: RunnerProfile;
  paceZones: PaceZones;
  powerZones?: PowerZones;
  phases: PhaseInfo[];
  weeks: WeeklyPlan[];
  totalWeeks: number;
  peakWeeklyMileage: number;
  raceDay: string;
  generatedAt: string;
  goalAssessment: GoalAssessment;
  riskWarnings: string[];
  adjustmentRules: AdjustmentRule[];
}

// ─── Goal Assessment ───────────────────────────────────────

export interface GoalAssessment {
  feasibility: "realistic" | "ambitious" | "very_ambitious" | "unlikely";
  reasoning: string;
  recommendedPeakMileage: number;
  keyFactors: string[];
  timeline: string;
}

// ─── Adjustment Rules ──────────────────────────────────────

export interface AdjustmentRule {
  condition: string;
  action: string;
  severity: "low" | "medium" | "high";
}

// ─── Plan Metadata ─────────────────────────────────────────

export interface PlanOverview {
  planId: string;
  goalTime: string;
  raceDate: string;
  totalWeeks: number;
  peakMileage: number;
  currentMileage: number;
  phases: PhaseInfo[];
  feasibility: string;
  weeklyMileageTrend: number[];
  longRunProgression: number[];
}
