// ============================================================
// EnduroLab - Long-Run Durability Analytics
// ============================================================
// Compares the first 75% and final 25% of a long activity. Each
// metric has independent validity gates so missing measured power
// does not suppress otherwise useful pace and heart-rate results.
// ============================================================

import { ActivitySampleInput } from "./models";

export type LongRunClassification = "steady" | "progression" | "structured";

export interface LongRunDurabilityResult {
  powerRetention: number | null;
  paceRetention: number | null;
  heartRateDrift: number | null;
  usableMinutes: number;
  suitable: boolean;
  reason: string | null;
}

const MINIMUM_DURATION_SECONDS = 60 * 60;
const BUCKET_SECONDS = 30;
const MINIMUM_BUCKET_COVERAGE = 0.6;

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coveredBuckets(
  samples: ActivitySampleInput[],
  sectionStart: number,
  sectionEnd: number,
  isUsable: (sample: ActivitySampleInput) => boolean,
): number {
  return new Set(samples
    .filter((sample) => sample.elapsedSeconds >= sectionStart && sample.elapsedSeconds <= sectionEnd && isUsable(sample))
    .map((sample) => Math.floor((sample.elapsedSeconds - sectionStart) / BUCKET_SECONDS)))
    .size;
}

function sectionValues(
  samples: ActivitySampleInput[],
  sectionStart: number,
  sectionEnd: number,
  value: (sample: ActivitySampleInput) => number | null,
): number[] | null {
  const sectionSeconds = sectionEnd - sectionStart;
  const expectedBuckets = Math.max(1, Math.ceil(sectionSeconds / BUCKET_SECONDS));
  const values = samples
    .filter((sample) => sample.elapsedSeconds >= sectionStart && sample.elapsedSeconds <= sectionEnd)
    .map(value)
    .filter((entry): entry is number => entry !== null && Number.isFinite(entry));
  const coverage = coveredBuckets(samples, sectionStart, sectionEnd, (sample) => value(sample) !== null);
  return values.length >= 10 && coverage / expectedBuckets >= MINIMUM_BUCKET_COVERAGE ? values : null;
}

export function calculateLongRunDurability(
  samples: ActivitySampleInput[],
  hasMeasuredPower = true,
): LongRunDurabilityResult {
  const sorted = [...samples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  if (new Set(sorted.map((sample) => sample.activityId)).size > 1) {
    return { powerRetention: null, paceRetention: null, heartRateDrift: null, usableMinutes: 0, suitable: false, reason: "Durability must be calculated for one activity at a time." };
  }
  if (sorted.length < 20) {
    return { powerRetention: null, paceRetention: null, heartRateDrift: null, usableMinutes: 0, suitable: false, reason: "Not enough samples are available." };
  }

  const start = sorted[0].elapsedSeconds;
  const end = sorted[sorted.length - 1].elapsedSeconds;
  const duration = end - start;
  if (duration < MINIMUM_DURATION_SECONDS) {
    return { powerRetention: null, paceRetention: null, heartRateDrift: null, usableMinutes: duration / 60, suitable: false, reason: "At least 60 elapsed minutes are required." };
  }

  const finalQuarterStart = start + duration * 0.75;
  const firstSpeed = sectionValues(sorted, start, finalQuarterStart, (sample) => (
    sample.speedMetersPerSecond !== null && sample.speedMetersPerSecond >= 1.8
      ? sample.speedMetersPerSecond
      : null
  ));
  const finalSpeed = sectionValues(sorted, finalQuarterStart, end, (sample) => (
    sample.speedMetersPerSecond !== null && sample.speedMetersPerSecond >= 1.8
      ? sample.speedMetersPerSecond
      : null
  ));
  const firstHeartRate = sectionValues(sorted, start, finalQuarterStart, (sample) => (
    sample.heartRate !== null && sample.heartRate >= 90 && sample.heartRate <= 200 ? sample.heartRate : null
  ));
  const finalHeartRate = sectionValues(sorted, finalQuarterStart, end, (sample) => (
    sample.heartRate !== null && sample.heartRate >= 90 && sample.heartRate <= 200 ? sample.heartRate : null
  ));
  const firstPower = hasMeasuredPower
    ? sectionValues(sorted, start, finalQuarterStart, (sample) => (
        sample.power !== null && sample.power >= 80 && sample.power <= 700 ? sample.power : null
      ))
    : null;
  const finalPower = hasMeasuredPower
    ? sectionValues(sorted, finalQuarterStart, end, (sample) => (
        sample.power !== null && sample.power >= 80 && sample.power <= 700 ? sample.power : null
      ))
    : null;

  const paceRetention = firstSpeed && finalSpeed ? mean(finalSpeed) / mean(firstSpeed) * 100 : null;
  const heartRateDrift = firstHeartRate && finalHeartRate
    ? (mean(finalHeartRate) / mean(firstHeartRate) - 1) * 100
    : null;
  const powerRetention = firstPower && finalPower ? mean(finalPower) / mean(firstPower) * 100 : null;
  const suitable = paceRetention !== null && heartRateDrift !== null;

  return {
    powerRetention,
    paceRetention,
    heartRateDrift,
    usableMinutes: duration / 60,
    suitable,
    reason: suitable ? null : "Pace and heart-rate coverage must reach 60% in both sections.",
  };
}
