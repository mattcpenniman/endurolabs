// ============================================================
// EnduroLab - Activity Detail Chart Helpers
// ============================================================

import type { ActivityChartPoint, ActivityChartSample } from "@/lib/activities/models";

const METERS_PER_MILE = 1609.344;
const MINIMUM_HALF_CADENCE = 50;
const FULL_CADENCE_THRESHOLD = 120;
const MAXIMUM_FULL_CADENCE = 240;

/** Converts Garmin's single-leg cadence samples to total steps per minute. */
export function normalizeActivityCadence(cadence: number | null): number | null {
  if (cadence === null || !Number.isFinite(cadence)) return null;
  if (cadence >= MINIMUM_HALF_CADENCE && cadence < FULL_CADENCE_THRESHOLD) return cadence * 2;
  if (cadence >= FULL_CADENCE_THRESHOLD && cadence <= MAXIMUM_FULL_CADENCE) return cadence;
  return null;
}

export function downsampleActivitySamples(
  samples: ActivityChartSample[],
  maxPoints = 1200
): ActivityChartSample[] {
  if (maxPoints < 2) throw new Error("maxPoints must be at least 2");
  if (samples.length <= maxPoints) return samples;

  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round(index * (samples.length - 1) / (maxPoints - 1));
    return samples[sourceIndex];
  });
}

export function buildActivityChartData(samples: ActivityChartSample[]): ActivityChartPoint[] {
  return samples.map((sample) => {
    const paceMinutesPerMile = sample.speedMetersPerSecond !== null && sample.speedMetersPerSecond > 0
      ? METERS_PER_MILE / sample.speedMetersPerSecond / 60
      : null;

    return {
      ...sample,
      paceMinutesPerMile: paceMinutesPerMile !== null
        && paceMinutesPerMile >= 2
        && paceMinutesPerMile <= 30
        ? paceMinutesPerMile
        : null,
    };
  });
}
