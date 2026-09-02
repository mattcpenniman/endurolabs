// ============================================================
// EnduroLab - Running Fitness Calculations
// ============================================================
// Heart rate is paired with power observed `hrLagSeconds` earlier,
// then aggregated into independent windows. A Huber regression limits
// the influence of remaining sensor errors and unusual efforts.
// ============================================================

import {
  ActivitySampleInput,
  DecouplingResult,
  FitnessAnalysisConfig,
  FixedHeartRateEstimate,
  PowerHeartRateModel,
  PowerSource,
  PreparedFitnessPoint,
} from "./models";

export const DEFAULT_FITNESS_CONFIG: FitnessAnalysisConfig = {
  hrLagSeconds: 30,
  smoothingSeconds: 30,
  minimumHeartRate: 90,
  maximumHeartRate: 175,
  minimumPower: 80,
  maximumPower: 700,
  minimumSpeedMetersPerSecond: 1.8,
  maximumPowerCoefficientOfVariation: 0.15,
  minimumWindows: 20,
};

interface WindowAccumulator {
  activityId: string;
  start: number;
  heartRates: number[];
  powers: number[];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function weightedFit(points: PreparedFitnessPoint[], weights: number[]): { intercept: number; slope: number } {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const meanHr = points.reduce((sum, point, index) => sum + point.heartRate * weights[index], 0) / weightSum;
  const meanPower = points.reduce((sum, point, index) => sum + point.power * weights[index], 0) / weightSum;
  const covariance = points.reduce(
    (sum, point, index) => sum + weights[index] * (point.heartRate - meanHr) * (point.power - meanPower),
    0,
  );
  const variance = points.reduce(
    (sum, point, index) => sum + weights[index] * (point.heartRate - meanHr) ** 2,
    0,
  );
  const slope = variance > 0 ? covariance / variance : 0;
  return { slope, intercept: meanPower - slope * meanHr };
}

export function prepareFitnessSamples(
  samples: ActivitySampleInput[],
  config: FitnessAnalysisConfig = DEFAULT_FITNESS_CONFIG,
): PreparedFitnessPoint[] {
  const byActivity = new Map<string, ActivitySampleInput[]>();
  for (const sample of samples) {
    const activity = byActivity.get(sample.activityId) ?? [];
    activity.push(sample);
    byActivity.set(sample.activityId, activity);
  }

  const windows = new Map<string, WindowAccumulator>();
  for (const [activityId, activitySamples] of byActivity) {
    const sorted = [...activitySamples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    let hrIndex = 0;
    for (const sample of sorted) {
      if (
        sample.power === null ||
        sample.power < config.minimumPower ||
        sample.power > config.maximumPower ||
        sample.speedMetersPerSecond === null ||
        sample.speedMetersPerSecond < config.minimumSpeedMetersPerSecond
      ) continue;

      const targetHrTime = sample.elapsedSeconds + config.hrLagSeconds;
      while (
        hrIndex + 1 < sorted.length &&
        Math.abs(sorted[hrIndex + 1].elapsedSeconds - targetHrTime) <= Math.abs(sorted[hrIndex].elapsedSeconds - targetHrTime)
      ) hrIndex += 1;
      const hrSample = sorted[hrIndex];
      if (
        Math.abs(hrSample.elapsedSeconds - targetHrTime) > Math.max(2, config.smoothingSeconds / 4) ||
        hrSample.heartRate === null ||
        hrSample.heartRate < config.minimumHeartRate ||
        hrSample.heartRate > config.maximumHeartRate
      ) continue;

      const start = Math.floor(sample.elapsedSeconds / config.smoothingSeconds) * config.smoothingSeconds;
      const key = `${activityId}:${start}`;
      const window = windows.get(key) ?? { activityId, start, heartRates: [], powers: [] };
      window.heartRates.push(hrSample.heartRate);
      window.powers.push(sample.power);
      windows.set(key, window);
    }
  }

  return [...windows.values()]
    .filter((window) => window.powers.length >= Math.max(3, Math.floor(config.smoothingSeconds / 3)))
    .filter((window) => standardDeviation(window.powers) / mean(window.powers) <= config.maximumPowerCoefficientOfVariation)
    .map((window) => ({
      activityId: window.activityId,
      elapsedSeconds: window.start + config.smoothingSeconds / 2,
      heartRate: mean(window.heartRates),
      power: mean(window.powers),
    }))
    .sort((a, b) => a.activityId.localeCompare(b.activityId) || a.elapsedSeconds - b.elapsedSeconds);
}

export function fitPowerAtHeartRate(
  points: PreparedFitnessPoint[],
  targets: number[] = [130, 140, 150],
  weightKg: number | null = null,
  source: PowerSource = "garmin",
  config: FitnessAnalysisConfig = DEFAULT_FITNESS_CONFIG,
): PowerHeartRateModel | null {
  if (points.length < config.minimumWindows) return null;
  const hrValues = points.map((point) => point.heartRate);
  const hrMin = Math.min(...hrValues);
  const hrMax = Math.max(...hrValues);
  if (hrMax - hrMin < 8) return null;

  let weights = points.map(() => 1);
  let fit = weightedFit(points, weights);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const residuals = points.map((point) => point.power - (fit.intercept + fit.slope * point.heartRate));
    const center = median(residuals);
    const scale = Math.max(1, 1.4826 * median(residuals.map((residual) => Math.abs(residual - center))));
    const cutoff = 1.345 * scale;
    weights = residuals.map((residual) => Math.min(1, cutoff / Math.max(Math.abs(residual), 0.0001)));
    const next = weightedFit(points, weights);
    if (Math.abs(next.slope - fit.slope) < 0.0001 && Math.abs(next.intercept - fit.intercept) < 0.01) {
      fit = next;
      break;
    }
    fit = next;
  }

  const predicted = points.map((point) => fit.intercept + fit.slope * point.heartRate);
  const residuals = points.map((point, index) => point.power - predicted[index]);
  const powerMean = mean(points.map((point) => point.power));
  const residualSumSquares = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const totalSumSquares = points.reduce((sum, point) => sum + (point.power - powerMean) ** 2, 0);
  const rSquared = totalSumSquares > 0 ? Math.max(0, 1 - residualSumSquares / totalSumSquares) : 0;
  const residualStandardError = Math.sqrt(residualSumSquares / Math.max(1, points.length - 2));
  const meanHr = mean(hrValues);
  const hrSumSquares = hrValues.reduce((sum, value) => sum + (value - meanHr) ** 2, 0);

  const estimates: FixedHeartRateEstimate[] = targets.map((heartRate) => {
    const watts = fit.intercept + fit.slope * heartRate;
    const standardError = residualStandardError * Math.sqrt(1 / points.length + (heartRate - meanHr) ** 2 / hrSumSquares);
    return {
      heartRate,
      watts,
      lower95: watts - 1.96 * standardError,
      upper95: watts + 1.96 * standardError,
      wattsPerKg: weightKg && weightKg > 0 ? watts / weightKg : null,
      extrapolated: heartRate < hrMin || heartRate > hrMax,
    };
  });

  const activityCount = new Set(points.map((point) => point.activityId)).size;
  const usableMinutes = points.length * config.smoothingSeconds / 60;
  const primary = estimates.find((estimate) => estimate.heartRate === 140) ?? estimates[0];
  const confidence = primary.extrapolated || activityCount < 2 || usableMinutes < 20
    ? "low"
    : activityCount >= 5 && usableMinutes >= 90 && rSquared >= 0.5 && hrMax - hrMin >= 25
      ? "high"
      : "medium";

  return {
    source,
    intercept: fit.intercept,
    slope: fit.slope,
    rSquared,
    residualStandardError,
    sampleCount: points.length,
    activityCount,
    usableMinutes,
    observedHeartRateRange: [hrMin, hrMax],
    confidence,
    estimates,
  };
}

export function analyzePowerAtHeartRate(
  samples: ActivitySampleInput[],
  targets: number[] = [130, 140, 150],
  weightKg: number | null = null,
  source: PowerSource = "garmin",
  config: FitnessAnalysisConfig = DEFAULT_FITNESS_CONFIG,
): PowerHeartRateModel | null {
  return fitPowerAtHeartRate(prepareFitnessSamples(samples, config), targets, weightKg, source, config);
}

export function calculateAerobicDecoupling(points: PreparedFitnessPoint[]): DecouplingResult {
  if (points.length < 60) {
    return { percentage: 0, firstHalfEfficiency: 0, secondHalfEfficiency: 0, suitable: false, reason: "At least 30 usable minutes are required." };
  }
  const midpoint = Math.floor(points.length / 2);
  const first = points.slice(0, midpoint);
  const second = points.slice(midpoint);
  const firstHalfEfficiency = mean(first.map((point) => point.power)) / mean(first.map((point) => point.heartRate));
  const secondHalfEfficiency = mean(second.map((point) => point.power)) / mean(second.map((point) => point.heartRate));
  const percentage = (firstHalfEfficiency - secondHalfEfficiency) / firstHalfEfficiency * 100;
  return { percentage, firstHalfEfficiency, secondHalfEfficiency, suitable: true, reason: null };
}
