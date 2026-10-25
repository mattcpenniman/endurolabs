/** Full-trace running dynamics: independent coverage, shared split windows and bounded chart bins. */
import type { ActivityChartSample } from "./models";
import { DYNAMICS_FIELDS, dynamicsValue } from "@/lib/garmin/running-dynamics.mjs";

export type DynamicsKey = keyof typeof DYNAMICS_FIELDS;
export const DYNAMICS_KEYS = Object.keys(DYNAMICS_FIELDS) as DynamicsKey[];
export interface DynamicsMetric {
  average: number | null;
  validSeconds: number;
  /** Fraction of eligible moving time; null when no interval is eligible. */
  coverage: number | null;
}
export interface DynamicsWindow {
  durationSeconds: number;
  eligibleSeconds: number;
  metrics: Record<DynamicsKey, DynamicsMetric>;
}
export interface DynamicsChartBin extends DynamicsWindow {
  startSeconds: number;
  endSeconds: number;
  paceMinutesPerMile: number | null;
}
export interface DynamicsReport extends DynamicsWindow {
  bins: DynamicsChartBin[];
}

export function validDynamics(key: DynamicsKey, value: unknown): number | null {
  return dynamicsValue(value, DYNAMICS_FIELDS[key][3]);
}

/** Require both endpoints: no extrapolation through missing metrics, stops or gaps >30s. */
export function dynamicsIntervalEligible(left: ActivityChartSample, right: ActivityChartSample): boolean {
  const seconds = right.elapsedSeconds - left.elapsedSeconds;
  return seconds > 0 && seconds <= 30 && [left.speedMetersPerSecond, right.speedMetersPerSecond]
    .every((speed) => typeof speed === "number" && Number.isFinite(speed) && speed > 0 && speed <= 12);
}

function emptyWindow(start: number, end: number): DynamicsWindow {
  return {
    durationSeconds: Math.max(0, end - start), eligibleSeconds: 0,
    metrics: Object.fromEntries(DYNAMICS_KEYS.map((key) => [key, {
      average: null, validSeconds: 0, coverage: null,
    }])) as Record<DynamicsKey, DynamicsMetric>,
  };
}

/** Clip and linearly integrate each endpoint pair, including fractional split boundaries. */
export function addDynamicsInterval(window: DynamicsWindow, left: ActivityChartSample, right: ActivityChartSample,
  start: number, end: number): void {
  const from = Math.max(start, left.elapsedSeconds);
  const to = Math.min(end, right.elapsedSeconds);
  if (to <= from || !dynamicsIntervalEligible(left, right)) return;
  const seconds = to - from;
  const intervalSeconds = right.elapsedSeconds - left.elapsedSeconds;
  window.eligibleSeconds += seconds;
  for (const key of DYNAMICS_KEYS) {
    const a = validDynamics(key, left[key]);
    const b = validDynamics(key, right[key]);
    const metric = window.metrics[key];
    if (a !== null && b !== null) {
      const midpointFraction = ((from + to) / 2 - left.elapsedSeconds) / intervalSeconds;
      const value = a + (b - a) * midpointFraction;
      metric.average = ((metric.average ?? 0) * metric.validSeconds + value * seconds) / (metric.validSeconds + seconds);
      metric.validSeconds += seconds;
    }
  }
  for (const key of DYNAMICS_KEYS) {
    window.metrics[key].coverage = window.metrics[key].validSeconds / window.eligibleSeconds;
  }
}

/** Full-resolution means are never computed from chart/display samples. No summaries are inputs. */
export function buildDynamicsReport(samples: ActivityChartSample[], durationSeconds: number): DynamicsReport {
  const sorted = [...samples].filter((sample) => Number.isFinite(sample.elapsedSeconds) && sample.elapsedSeconds >= 0)
    .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
    .filter((sample, index, all) => index === 0 || sample.elapsedSeconds > all[index - 1].elapsedSeconds);
  const end = Math.max(Number.isFinite(durationSeconds) ? durationSeconds : 0, sorted.at(-1)?.elapsedSeconds ?? 0);
  const report: DynamicsReport = { ...emptyWindow(0, end), bins: [] };
  if (end <= 0 || sorted.length < 2) return report;
  const width = Math.max(1, Math.ceil(end / 360));
  for (let start = 0; start < end; start += width) {
    report.bins.push({ ...emptyWindow(start, Math.min(end, start + width)), startSeconds: start,
      endSeconds: Math.min(end, start + width), paceMinutesPerMile: null });
  }
  const distances = report.bins.map(() => 0);
  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1];
    const right = sorted[index];
    addDynamicsInterval(report, left, right, 0, end);
    if (!dynamicsIntervalEligible(left, right)) continue;
    const first = Math.floor(left.elapsedSeconds / width);
    const last = Math.min(report.bins.length - 1, Math.floor(right.elapsedSeconds / width));
    for (let binIndex = first; binIndex <= last; binIndex += 1) {
      const bin = report.bins[binIndex];
      addDynamicsInterval(bin, left, right, bin.startSeconds, bin.endSeconds);
      const from = Math.max(bin.startSeconds, left.elapsedSeconds);
      const to = Math.min(bin.endSeconds, right.elapsedSeconds);
      if (to <= from) continue;
      const fraction = ((from + to) / 2 - left.elapsedSeconds) / (right.elapsedSeconds - left.elapsedSeconds);
      distances[binIndex] += ((left.speedMetersPerSecond ?? 0)
        + ((right.speedMetersPerSecond ?? 0) - (left.speedMetersPerSecond ?? 0)) * fraction) * (to - from);
    }
  }
  report.bins.forEach((bin, index) => {
    bin.paceMinutesPerMile = distances[index] > 0 ? bin.eligibleSeconds / 60 / (distances[index] / 1609.344) : null;
  });
  return report;
}

export function buildDynamicsWindow(samples: ActivityChartSample[], start: number, end: number): DynamicsWindow {
  const window = emptyWindow(start, end);
  for (let index = 1; index < samples.length; index += 1) {
    addDynamicsInterval(window, samples[index - 1], samples[index], start, end);
  }
  return window;
}
