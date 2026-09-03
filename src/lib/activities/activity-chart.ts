// ============================================================
// EnduroLab - Activity Detail Chart Helpers
// ============================================================

import type { ActivityChartPoint, ActivityChartSample } from "@/lib/activities/models";

const METERS_PER_MILE = 1609.344;

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
