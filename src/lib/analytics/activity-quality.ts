// ============================================================
// EnduroLab - Activity Detail Quality Scoring
// ============================================================

import type { GarminActivitySample } from "@/lib/garmin/activity-detail";

export const ACTIVITY_QUALITY_VERSION = "detail-v1";
export const ANALYTICS_QUALITY_THRESHOLD = 60;

type QualitySample = Pick<
  GarminActivitySample,
  "elapsedSeconds" | "heartRate" | "power" | "speedMetersPerSecond" | "latitude" | "longitude"
>;

function coverage(samples: QualitySample[], predicate: (sample: QualitySample) => boolean): number {
  if (samples.length === 0) return 0;
  return samples.filter(predicate).length / samples.length;
}

function steadyStateShare(samples: QualitySample[]): number {
  const buckets = new Map<number, number[]>();
  for (const sample of samples) {
    if (
      sample.speedMetersPerSecond === null || sample.speedMetersPerSecond < 1.8
      || sample.heartRate === null || sample.heartRate < 90 || sample.heartRate > 200
      || sample.power === null || sample.power < 80 || sample.power > 700
    ) continue;
    const bucket = Math.floor(sample.elapsedSeconds / 30);
    const powers = buckets.get(bucket) ?? [];
    powers.push(sample.power);
    buckets.set(bucket, powers);
  }

  const populated = [...buckets.values()].filter((powers) => powers.length >= 10);
  if (populated.length === 0) return 0;
  const steady = populated.filter((powers) => {
    const mean = powers.reduce((sum, power) => sum + power, 0) / powers.length;
    const variance = powers.reduce((sum, power) => sum + (power - mean) ** 2, 0) / powers.length;
    return mean > 0 && Math.sqrt(variance) / mean <= 0.15;
  });
  return steady.length / populated.length;
}

/**
 * detail-v1 weights: HR 25, power 25, GPS 10, usable duration 15,
 * and steady-state share 25. Empty detail always scores zero.
 */
export function computeActivityQualityScore(samples: QualitySample[], durationSeconds: number): number {
  if (samples.length === 0) return 0;
  const lastElapsed = samples.reduce((maximum, sample) => Math.max(maximum, sample.elapsedSeconds), 0);
  const traceCoverage = durationSeconds > 0 ? Math.min(lastElapsed / durationSeconds, 1) : 0;
  const durationSuitability = Math.min(Math.max(durationSeconds, 0) / 1200, 1);
  const score =
    coverage(samples, (sample) => sample.heartRate !== null) * 25
    + coverage(samples, (sample) => sample.power !== null) * 25
    + coverage(samples, (sample) => sample.latitude !== null && sample.longitude !== null) * 10
    + traceCoverage * durationSuitability * 15
    + steadyStateShare(samples) * 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}
