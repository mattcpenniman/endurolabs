// ============================================================
// EnduroLab - Persisted Activity Analytics Summaries
// ============================================================
// Derives reusable 30-second windows and activity-local metrics
// from authoritative samples. Rows are versioned so calculation
// changes can be rolled out without interpreting stale summaries.
// ============================================================

import { ActivityDecouplingResult, ActivitySampleInput } from "@/lib/analytics/models";
import { LongRunDurabilityResult, calculateLongRunDurability } from "@/lib/analytics/long-run-durability";
import { analyzeAerobicDecouplingByActivity, prepareFitnessSamples } from "@/lib/analytics/running-fitness";

export const ACTIVITY_ANALYTICS_VERSION = "activity-metrics-v1";
const WINDOW_SECONDS = 30;

export interface ActivitySummarySample extends ActivitySampleInput {
  elevationMeters: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ActivityWindowSummary {
  windowStartSeconds: number;
  sampleCount: number;
  heartRateAverage: number | null;
  powerAverage: number | null;
  speedAverage: number | null;
  elevationAverage: number | null;
  cadenceMedian: number | null;
  latitudeAverage: number | null;
  longitudeAverage: number | null;
  fitnessHeartRate: number | null;
  fitnessPower: number | null;
}

export interface StoredActivityAnalyticsMetrics {
  decoupling: ActivityDecouplingResult | null;
  durability: LongRunDurabilityResult;
}

export interface ActivityAnalyticsSummary {
  metrics: StoredActivityAnalyticsMetrics;
  windows: ActivityWindowSummary[];
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function values(samples: ActivitySummarySample[], pick: (sample: ActivitySummarySample) => number | null | undefined): number[] {
  return samples.map(pick).filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
}

function normalizedCadence(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value >= 50 && value < 120) return value * 2;
  return value >= 120 && value <= 240 ? value : null;
}

/** Build stable activity-local summaries without database access. */
export function summarizeActivitySamples(samples: ActivitySummarySample[]): ActivityAnalyticsSummary {
  const sorted = [...samples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const grouped = new Map<number, ActivitySummarySample[]>();
  for (const sample of sorted) {
    const start = Math.floor(sample.elapsedSeconds / WINDOW_SECONDS) * WINDOW_SECONDS;
    const entries = grouped.get(start) ?? [];
    entries.push(sample);
    grouped.set(start, entries);
  }
  const fitnessByStart = new Map(prepareFitnessSamples(sorted).map((point) => [
    Math.floor(point.elapsedSeconds / WINDOW_SECONDS) * WINDOW_SECONDS,
    point,
  ]));
  const windows = [...grouped].map(([windowStartSeconds, entries]): ActivityWindowSummary => {
    const fitness = fitnessByStart.get(windowStartSeconds);
    return {
      windowStartSeconds,
      sampleCount: entries.length,
      heartRateAverage: mean(values(entries, (sample) => sample.heartRate)),
      powerAverage: mean(values(entries, (sample) => sample.power)),
      speedAverage: mean(values(entries, (sample) => sample.speedMetersPerSecond)),
      elevationAverage: mean(values(entries, (sample) => sample.elevationMeters)),
      cadenceMedian: median(entries.flatMap((sample) => {
        const cadence = normalizedCadence(sample.cadence);
        return cadence === null ? [] : [cadence];
      })),
      latitudeAverage: mean(values(entries, (sample) => sample.latitude)),
      longitudeAverage: mean(values(entries, (sample) => sample.longitude)),
      fitnessHeartRate: fitness?.heartRate ?? null,
      fitnessPower: fitness?.power ?? null,
    };
  });
  return {
    metrics: {
      decoupling: analyzeAerobicDecouplingByActivity(sorted)[0] ?? null,
      durability: calculateLongRunDurability(sorted, true),
    },
    windows,
  };
}
