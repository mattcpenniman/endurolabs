// ============================================================
// EnduroLab - Running Fitness Analytics Models
// ============================================================

export type PowerSource = "garmin" | "apple" | "apple_watch" | "stryd" | "coros" | "other";

export interface ActivitySampleInput {
  activityId: string;
  elapsedSeconds: number;
  heartRate: number | null;
  power: number | null;
  speedMetersPerSecond: number | null;
  cadence?: number | null;
}

export interface FitnessAnalysisConfig {
  hrLagSeconds: number;
  smoothingSeconds: number;
  minimumHeartRate: number;
  maximumHeartRate: number;
  minimumPower: number;
  maximumPower: number;
  minimumSpeedMetersPerSecond: number;
  maximumPowerCoefficientOfVariation: number;
  minimumWindows: number;
}

export interface PreparedFitnessPoint {
  activityId: string;
  elapsedSeconds: number;
  heartRate: number;
  power: number;
}

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export interface FixedHeartRateEstimate {
  heartRate: number;
  watts: number;
  lower95: number;
  upper95: number;
  wattsPerKg: number | null;
  extrapolated: boolean;
}

export interface PowerHeartRateModel {
  source: PowerSource;
  intercept: number;
  slope: number;
  rSquared: number;
  residualStandardError: number;
  sampleCount: number;
  activityCount: number;
  usableMinutes: number;
  observedHeartRateRange: [number, number];
  confidence: ConfidenceLevel;
  estimates: FixedHeartRateEstimate[];
}

export interface DecouplingResult {
  percentage: number;
  firstHalfEfficiency: number;
  secondHalfEfficiency: number;
  suitable: boolean;
  reason: string | null;
}
