// ============================================================
// EnduroLab — Time at Effort
// ============================================================
// Buckets recorded running time into training-effort zones from
// stored activity samples. Heart-rate time uses the plan's
// heartRateZones. Power time is produced only from measured
// sensor power and is never derived from modeled values.
// ============================================================

import type { ActivityChartSample } from "@/lib/activities/models";
import type { HeartRateZone, PaceZones, PowerZones } from "@/lib/training/models";

export type EffortZone = "recovery" | "easy" | "marathon" | "threshold" | "vo2";

export const EFFORT_ZONES: readonly EffortZone[] = [
  "recovery",
  "easy",
  "marathon",
  "threshold",
  "vo2",
];

const MAX_INTERVAL_SECONDS = 30;
const MIN_MOVING_SPEED_METERS_PER_SECOND = 0.5;

export interface EffortBucket {
  zone: EffortZone;
  seconds: number;
}

export interface TimeAtEffortBreakdown {
  /** Seconds assigned to an effort zone. */
  totalSeconds: number;
  /** Seconds in valid intervals where the metric was missing. */
  unclassifiedSeconds: number;
  buckets: EffortBucket[];
}

export interface TimeAtEffortSummary {
  durationSeconds: number;
  heartRate: TimeAtEffortBreakdown | null;
  power: TimeAtEffortBreakdown | null;
}

export interface TimeAtEffortInput {
  samples: ActivityChartSample[];
  heartRateZones?: PaceZones["heartRateZones"] | null;
  powerZones?: PowerZones | null;
  /** Power is only bucketed when the samples carry measured sensor power. */
  hasMeasuredPower?: boolean;
  durationSeconds?: number;
}

interface SampleInterval {
  seconds: number;
  left: ActivityChartSample;
  right: ActivityChartSample;
}

interface ZoneBoundary {
  zone: EffortZone;
  max: number;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intervalValue(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return (left + right) / 2;
}

function buildIntervals(samples: ActivityChartSample[]): SampleInterval[] {
  const sorted = [...samples]
    .filter((sample) => Number.isFinite(sample.elapsedSeconds) && sample.elapsedSeconds >= 0)
    .sort((left, right) => left.elapsedSeconds - right.elapsedSeconds)
    .filter((sample, index, all) => index === 0 || sample.elapsedSeconds > all[index - 1].elapsedSeconds);

  const intervals: SampleInterval[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1];
    const right = sorted[index];
    const seconds = right.elapsedSeconds - left.elapsedSeconds;
    if (seconds <= 0 || seconds > MAX_INTERVAL_SECONDS) continue;

    const leftSpeed = finite(left.speedMetersPerSecond);
    const rightSpeed = finite(right.speedMetersPerSecond);
    if (
      leftSpeed !== null && rightSpeed !== null
      && (leftSpeed + rightSpeed) / 2 < MIN_MOVING_SPEED_METERS_PER_SECOND
    ) {
      continue;
    }

    intervals.push({ seconds, left, right });
  }
  return intervals;
}

function heartRateBoundaries(
  zones: PaceZones["heartRateZones"] | null | undefined,
): ZoneBoundary[] {
  if (!zones) return [];
  const ordered: Array<[EffortZone, HeartRateZone | undefined]> = [
    ["recovery", zones.recovery],
    ["easy", zones.easy],
    ["marathon", zones.marathon],
    ["threshold", zones.threshold],
    ["vo2", zones.vo2],
  ];
  return ordered.flatMap(([zone, heartRateZone]) => {
    const max = heartRateZone?.targetBpm?.max;
    return typeof max === "number" && Number.isFinite(max) ? [{ zone, max }] : [];
  });
}

function powerBoundaries(zones: PowerZones | null | undefined): ZoneBoundary[] {
  if (!zones) return [];
  const boundaries: ZoneBoundary[] = [
    { zone: "recovery", max: zones.easy.min },
    { zone: "easy", max: zones.easy.max },
    { zone: "marathon", max: (zones.marathon + zones.threshold) / 2 },
    { zone: "threshold", max: (zones.threshold + zones.vo2) / 2 },
  ];
  const finiteBoundaries = boundaries.filter((boundary) => Number.isFinite(boundary.max));
  return finiteBoundaries.length > 0 ? finiteBoundaries : [];
}

function classify(value: number, boundaries: ZoneBoundary[]): EffortZone {
  for (const boundary of boundaries) {
    if (value <= boundary.max) return boundary.zone;
  }
  return "vo2";
}

function summarizeIntervals(
  intervals: SampleInterval[],
  boundaries: ZoneBoundary[],
  pick: (sample: ActivityChartSample) => number | null,
): TimeAtEffortBreakdown {
  const secondsByZone = new Map<EffortZone, number>(EFFORT_ZONES.map((zone) => [zone, 0]));
  let unclassifiedSeconds = 0;

  for (const interval of intervals) {
    const value = intervalValue(pick(interval.left), pick(interval.right));
    if (value === null) {
      unclassifiedSeconds += interval.seconds;
      continue;
    }
    const zone = classify(value, boundaries);
    secondsByZone.set(zone, (secondsByZone.get(zone) ?? 0) + interval.seconds);
  }

  const buckets: EffortBucket[] = EFFORT_ZONES.map((zone) => ({
    zone,
    seconds: Math.round(secondsByZone.get(zone) ?? 0),
  }));

  return {
    totalSeconds: buckets.reduce((sum, bucket) => sum + bucket.seconds, 0),
    unclassifiedSeconds: Math.round(unclassifiedSeconds),
    buckets,
  };
}

/**
 * Split an activity's recorded time into recovery/easy/marathon/
 * threshold/VO2 buckets. Intervals longer than 30 seconds and
 * stationary intervals are treated as pauses and excluded. HR and
 * power are classified independently from the plan's zones; power
 * requires measured sensor power on every contributing interval.
 */
export function summarizeTimeAtEffort(input: TimeAtEffortInput): TimeAtEffortSummary {
  const intervals = buildIntervals(input.samples);
  const lastElapsed = input.samples.reduce(
    (maximum, sample) => (Number.isFinite(sample.elapsedSeconds) ? Math.max(maximum, sample.elapsedSeconds) : maximum),
    0,
  );
  const durationSeconds = finite(input.durationSeconds) ?? lastElapsed;

  const hrBoundaries = heartRateBoundaries(input.heartRateZones);
  const powerBoundariesForActivity = input.hasMeasuredPower ? powerBoundaries(input.powerZones) : [];

  return {
    durationSeconds: Math.round(durationSeconds),
    heartRate: hrBoundaries.length > 0
      ? summarizeIntervals(intervals, hrBoundaries, (sample) => finite(sample.heartRate))
      : null,
    power: powerBoundariesForActivity.length > 0
      ? summarizeIntervals(intervals, powerBoundariesForActivity, (sample) => finite(sample.power))
      : null,
  };
}