// ============================================================
// EnduroLab - Recorded Activity Mile Splits
// ============================================================
// Reconstructs cumulative distance from speed because real Garmin
// detail commonly omits per-sample distance. The reconstructed trace
// is reconciled to the authoritative activity-summary distance.

import type { ActivityChartSample, ActivitySplit } from "@/lib/activities/models";
import { normalizeActivityCadence } from "@/lib/activities/activity-chart";

const METERS_PER_MILE = 1609.344;
const MAX_RUNNING_SPEED_METERS_PER_SECOND = 12;
const MAX_ELEVATION_STEP_METERS = 35;
const MAX_PLAUSIBLE_GRADE = 0.25;

export interface ActivitySplitInput {
  summaryDistanceMeters: number;
  durationSeconds: number;
  hasMeasuredPower: boolean;
  samples: ActivityChartSample[];
}

interface TracePoint {
  sample: ActivityChartSample;
  distanceMeters: number;
}

interface WeightedMetric {
  total: number;
  seconds: number;
}

function validSpeed(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
    && value >= 0 && value <= MAX_RUNNING_SPEED_METERS_PER_SECOND;
}

function intervalValue(left: number | null | undefined, right: number | null | undefined): number | null {
  const values = [left, right].filter((value): value is number => (
    value !== null && value !== undefined && Number.isFinite(value)
  ));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addMetric(metric: WeightedMetric, value: number | null, seconds: number): void {
  if (value === null || seconds <= 0) return;
  metric.total += value * seconds;
  metric.seconds += seconds;
}

function metricAverage(metric: WeightedMetric): number | null {
  return metric.seconds > 0 ? metric.total / metric.seconds : null;
}

function elapsedAtDistance(trace: TracePoint[], targetMeters: number): number {
  for (let index = 1; index < trace.length; index += 1) {
    const left = trace[index - 1];
    const right = trace[index];
    if (right.distanceMeters < targetMeters) continue;
    const distanceDelta = right.distanceMeters - left.distanceMeters;
    if (distanceDelta <= 0) return right.sample.elapsedSeconds;
    const fraction = (targetMeters - left.distanceMeters) / distanceDelta;
    return left.sample.elapsedSeconds
      + fraction * (right.sample.elapsedSeconds - left.sample.elapsedSeconds);
  }
  return trace.at(-1)?.sample.elapsedSeconds ?? 0;
}

/** Builds one-mile splits plus a final partial split from recorded activity detail. */
export function buildActivityMileSplits(input: ActivitySplitInput): ActivitySplit[] {
  if (!Number.isFinite(input.summaryDistanceMeters) || input.summaryDistanceMeters <= 0) return [];

  const samples = [...input.samples]
    .filter((sample) => Number.isFinite(sample.elapsedSeconds) && sample.elapsedSeconds >= 0)
    .sort((left, right) => left.elapsedSeconds - right.elapsedSeconds)
    .filter((sample, index, sorted) => index === 0 || sample.elapsedSeconds > sorted[index - 1].elapsedSeconds);
  if (samples.length < 2) return [];

  const trace: TracePoint[] = [{ sample: samples[0], distanceMeters: 0 }];
  let integratedDistance = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    const seconds = right.elapsedSeconds - left.elapsedSeconds;
    const leftSpeed = validSpeed(left.speedMetersPerSecond) ? left.speedMetersPerSecond : null;
    const rightSpeed = validSpeed(right.speedMetersPerSecond) ? right.speedMetersPerSecond : null;
    const speed = intervalValue(leftSpeed, rightSpeed) ?? 0;
    integratedDistance += speed * seconds;
    trace.push({ sample: right, distanceMeters: integratedDistance });
  }
  if (integratedDistance <= 0) return [];

  const distanceScale = input.summaryDistanceMeters / integratedDistance;
  for (const point of trace) point.distanceMeters *= distanceScale;

  const boundaries: number[] = [];
  for (let meters = METERS_PER_MILE; meters < input.summaryDistanceMeters; meters += METERS_PER_MILE) {
    boundaries.push(meters);
  }
  boundaries.push(input.summaryDistanceMeters);

  const traceEnd = trace.at(-1)?.sample.elapsedSeconds ?? 0;
  const activityEnd = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
    ? Math.max(traceEnd, input.durationSeconds)
    : traceEnd;
  let startMeters = 0;
  let startElapsed = 0;

  return boundaries.map((endMeters, index): ActivitySplit => {
    const isFinal = index === boundaries.length - 1;
    const tracedEndElapsed = elapsedAtDistance(trace, endMeters);
    const endElapsed = isFinal ? Math.max(startElapsed, activityEnd) : tracedEndElapsed;
    const distanceMiles = (endMeters - startMeters) / METERS_PER_MILE;
    const durationSeconds = Math.max(0, endElapsed - startElapsed);
    const heartRate: WeightedMetric = { total: 0, seconds: 0 };
    const power: WeightedMetric = { total: 0, seconds: 0 };
    const cadence: WeightedMetric = { total: 0, seconds: 0 };
    const temperature: WeightedMetric = { total: 0, seconds: 0 };
    let elevationGainMeters = 0;
    let elevationLossMeters = 0;

    for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
      const left = samples[sampleIndex - 1];
      const right = samples[sampleIndex];
      const intervalStart = left.elapsedSeconds;
      const intervalEnd = right.elapsedSeconds;
      const overlapStart = Math.max(startElapsed, intervalStart);
      const overlapEnd = Math.min(endElapsed, intervalEnd);
      const overlapSeconds = overlapEnd - overlapStart;
      if (overlapSeconds <= 0) continue;

      addMetric(heartRate, intervalValue(left.heartRate, right.heartRate), overlapSeconds);
      if (input.hasMeasuredPower) {
        addMetric(power, intervalValue(left.power, right.power), overlapSeconds);
      }
      addMetric(cadence, intervalValue(
        normalizeActivityCadence(left.cadence),
        normalizeActivityCadence(right.cadence),
      ), overlapSeconds);
      addMetric(temperature, intervalValue(left.temperatureCelsius, right.temperatureCelsius), overlapSeconds);

      const elevationDelta = right.elevationMeters !== null && right.elevationMeters !== undefined
        && left.elevationMeters !== null && left.elevationMeters !== undefined
        ? right.elevationMeters - left.elevationMeters
        : null;
      const intervalSeconds = intervalEnd - intervalStart;
      const averageSpeed = intervalValue(
        validSpeed(left.speedMetersPerSecond) ? left.speedMetersPerSecond : null,
        validSpeed(right.speedMetersPerSecond) ? right.speedMetersPerSecond : null,
      );
      if (
        elevationDelta !== null && Number.isFinite(elevationDelta)
        && Math.abs(elevationDelta) <= MAX_ELEVATION_STEP_METERS
        && averageSpeed !== null && averageSpeed > 0
        && Math.abs(elevationDelta / (averageSpeed * intervalSeconds)) <= MAX_PLAUSIBLE_GRADE
      ) {
        const partialDelta = elevationDelta * overlapSeconds / intervalSeconds;
        if (partialDelta > 0) elevationGainMeters += partialDelta;
        else elevationLossMeters -= partialDelta;
      }
    }

    const split: ActivitySplit = {
      number: index + 1,
      distanceMiles,
      durationSeconds,
      elapsedSeconds: endElapsed,
      paceMinutesPerMile: distanceMiles > 0 ? durationSeconds / 60 / distanceMiles : null,
      averageHeartRate: metricAverage(heartRate),
      averagePower: input.hasMeasuredPower ? metricAverage(power) : null,
      averageCadence: metricAverage(cadence),
      averageTemperatureCelsius: metricAverage(temperature),
      elevationGainMeters,
      elevationLossMeters,
    };
    startMeters = endMeters;
    startElapsed = endElapsed;
    return split;
  });
}
