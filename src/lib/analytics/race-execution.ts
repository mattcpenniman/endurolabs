// ============================================================
// EnduroLab - Race Execution Analysis
// ============================================================
// Classifies how a race was executed from its own stored
// samples. A large positive split made worse by falling heart
// rate, falling power, or a deteriorating closing 10K is the
// signature of a glycogen or muscular fade, and that finish
// time understates current fitness. Pure and leakage-safe:
// only the race's own samples are read.
// ============================================================

export const RACE_EXECUTION_VERSION = "race-execution-v1";

export type RaceExecutionQuality =
  | "well_executed"
  | "positive_split"
  | "blow_up"
  | "insufficient_data";

/** Reads a stored race-execution quality back out of persisted metrics. */
export function parseExecutionQuality(metrics: unknown): RaceExecutionQuality | null {
  if (!metrics || typeof metrics !== "object") return null;
  const quality = (metrics as { execution?: { quality?: unknown } }).execution?.quality;
  return quality === "well_executed" || quality === "positive_split" || quality === "blow_up" || quality === "insufficient_data"
    ? quality
    : null;
}

export interface RaceExecutionSample {
  elapsedSeconds: number;
  /** Absolute provider distance when present; otherwise speed is integrated. */
  distanceMeters?: number | null;
  speedMetersPerSecond: number | null;
  heartRate: number | null;
  power: number | null;
  cadence: number | null;
}

export interface RaceExecutionAnalysis {
  version: typeof RACE_EXECUTION_VERSION;
  quality: RaceExecutionQuality;
  sampleCount: number;
  integratedDistanceMeters: number;
  firstHalfSeconds: number | null;
  secondHalfSeconds: number | null;
  positiveSplitSeconds: number | null;
  positiveSplitPercent: number | null;
  first10kSeconds: number | null;
  last10kSeconds: number | null;
  closing10kDeltaPercent: number | null;
  firstHalfHeartRate: number | null;
  secondHalfHeartRate: number | null;
  heartRateFadeBpm: number | null;
  firstHalfPower: number | null;
  secondHalfPower: number | null;
  powerFadePercent: number | null;
  cadenceFade: number | null;
}

const MIN_SAMPLES = 60;
const MIN_DISTANCE_METERS = 8000;
const MAX_INTERVAL_SECONDS = 60;
const POSITIVE_SPLIT_PERCENT = 2;
const BLOW_UP_POSITIVE_SPLIT_PERCENT = 5;
const HEART_RATE_FADE_BPM = -2;
const POWER_FADE_PERCENT = -10;
const CLOSING_10K_DEGRADATION_PERCENT = 8;

interface DistanceSample extends RaceExecutionSample {
  cumulativeMeters: number;
}

function rounded(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function normalizeCadence(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= 50 && value < 120) return value * 2;
  return value >= 120 && value <= 240 ? value : null;
}

function withCumulativeDistance(samples: RaceExecutionSample[]): DistanceSample[] {
  const sorted = [...samples].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
  let cumulativeMeters = 0;
  let previous: RaceExecutionSample | null = null;
  return sorted.map((sample) => {
    if (sample.distanceMeters !== null && sample.distanceMeters !== undefined && sample.distanceMeters >= 0) {
      cumulativeMeters = sample.distanceMeters;
    } else if (previous && sample.speedMetersPerSecond !== null && sample.speedMetersPerSecond >= 0) {
      const seconds = Math.min(Math.max(sample.elapsedSeconds - previous.elapsedSeconds, 0), MAX_INTERVAL_SECONDS);
      cumulativeMeters += seconds * sample.speedMetersPerSecond;
    }
    previous = sample;
    return { ...sample, cumulativeMeters };
  });
}

function timeAtDistance(samples: DistanceSample[], targetMeters: number): number | null {
  let previous: DistanceSample | null = null;
  for (const sample of samples) {
    if (sample.cumulativeMeters >= targetMeters) {
      if (!previous || sample.cumulativeMeters === previous.cumulativeMeters) return sample.elapsedSeconds;
      const ratio = (targetMeters - previous.cumulativeMeters) / (sample.cumulativeMeters - previous.cumulativeMeters);
      return previous.elapsedSeconds + ratio * (sample.elapsedSeconds - previous.elapsedSeconds);
    }
    previous = sample;
  }
  return null;
}

function meanBetween(
  samples: DistanceSample[],
  fromMeters: number,
  toMeters: number,
  pick: (sample: DistanceSample) => number | null,
): number | null {
  const values = samples
    .filter((sample) => sample.cumulativeMeters >= fromMeters && sample.cumulativeMeters < toMeters)
    .map(pick)
    .filter((value): value is number => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function insufficientAnalysis(sampleCount: number, integratedDistanceMeters: number): RaceExecutionAnalysis {
  return {
    version: RACE_EXECUTION_VERSION,
    quality: "insufficient_data",
    sampleCount,
    integratedDistanceMeters: rounded(integratedDistanceMeters, 1),
    firstHalfSeconds: null,
    secondHalfSeconds: null,
    positiveSplitSeconds: null,
    positiveSplitPercent: null,
    first10kSeconds: null,
    last10kSeconds: null,
    closing10kDeltaPercent: null,
    firstHalfHeartRate: null,
    secondHalfHeartRate: null,
    heartRateFadeBpm: null,
    firstHalfPower: null,
    secondHalfPower: null,
    powerFadePercent: null,
    cadenceFade: null,
  };
}

/** Classifies race execution and measures the fade from stored samples. */
export function analyzeRaceExecution(samples: RaceExecutionSample[]): RaceExecutionAnalysis {
  const rows = withCumulativeDistance(samples);
  const integratedDistanceMeters = rows.at(-1)?.cumulativeMeters ?? 0;
  if (rows.length < MIN_SAMPLES || integratedDistanceMeters < MIN_DISTANCE_METERS) {
    return insufficientAnalysis(rows.length, integratedDistanceMeters);
  }

  const totalSeconds = rows.at(-1)?.elapsedSeconds ?? 0;
  const halfway = integratedDistanceMeters / 2;
  const halfwaySeconds = timeAtDistance(rows, halfway) ?? totalSeconds / 2;
  const firstHalfSeconds = halfwaySeconds;
  const secondHalfSeconds = totalSeconds - halfwaySeconds;
  const positiveSplitSeconds = secondHalfSeconds - firstHalfSeconds;
  const positiveSplitPercent = positiveSplitSeconds / firstHalfSeconds * 100;

  let first10kSeconds: number | null = null;
  let last10kSeconds: number | null = null;
  let closing10kDeltaPercent: number | null = null;
  const tenKStart = timeAtDistance(rows, 10_000);
  const tenKEnd = timeAtDistance(rows, integratedDistanceMeters - 10_000);
  if (integratedDistanceMeters >= 20_000 && tenKStart !== null && tenKEnd !== null) {
    first10kSeconds = tenKStart;
    last10kSeconds = totalSeconds - tenKEnd;
    closing10kDeltaPercent = (last10kSeconds - first10kSeconds) / first10kSeconds * 100;
  }

  const firstHalfHeartRate = meanBetween(rows, 0, halfway, (sample) => sample.heartRate);
  const secondHalfHeartRate = meanBetween(rows, halfway, integratedDistanceMeters + 1, (sample) => sample.heartRate);
  const firstHalfPower = meanBetween(rows, 0, halfway, (sample) => sample.power);
  const secondHalfPower = meanBetween(rows, halfway, integratedDistanceMeters + 1, (sample) => sample.power);
  const firstHalfCadence = meanBetween(rows, 0, halfway, (sample) => normalizeCadence(sample.cadence));
  const secondHalfCadence = meanBetween(rows, halfway, integratedDistanceMeters + 1, (sample) => normalizeCadence(sample.cadence));

  const heartRateFadeBpm = firstHalfHeartRate !== null && secondHalfHeartRate !== null
    ? secondHalfHeartRate - firstHalfHeartRate
    : null;
  const powerFadePercent = firstHalfPower !== null && secondHalfPower !== null && firstHalfPower > 0
    ? (secondHalfPower - firstHalfPower) / firstHalfPower * 100
    : null;
  const cadenceFade = firstHalfCadence !== null && secondHalfCadence !== null
    ? secondHalfCadence - firstHalfCadence
    : null;

  const fadeSignal =
    (heartRateFadeBpm !== null && heartRateFadeBpm <= HEART_RATE_FADE_BPM)
    || (powerFadePercent !== null && powerFadePercent <= POWER_FADE_PERCENT)
    || (closing10kDeltaPercent !== null && closing10kDeltaPercent >= CLOSING_10K_DEGRADATION_PERCENT);

  const quality: RaceExecutionQuality = positiveSplitPercent >= BLOW_UP_POSITIVE_SPLIT_PERCENT && fadeSignal
    ? "blow_up"
    : positiveSplitPercent >= POSITIVE_SPLIT_PERCENT
      ? "positive_split"
      : "well_executed";

  return {
    version: RACE_EXECUTION_VERSION,
    quality,
    sampleCount: rows.length,
    integratedDistanceMeters: rounded(integratedDistanceMeters, 1),
    firstHalfSeconds: rounded(firstHalfSeconds, 1),
    secondHalfSeconds: rounded(secondHalfSeconds, 1),
    positiveSplitSeconds: rounded(positiveSplitSeconds, 1),
    positiveSplitPercent: rounded(positiveSplitPercent, 2),
    first10kSeconds: first10kSeconds === null ? null : rounded(first10kSeconds, 1),
    last10kSeconds: last10kSeconds === null ? null : rounded(last10kSeconds, 1),
    closing10kDeltaPercent: closing10kDeltaPercent === null ? null : rounded(closing10kDeltaPercent, 2),
    firstHalfHeartRate: firstHalfHeartRate === null ? null : rounded(firstHalfHeartRate, 1),
    secondHalfHeartRate: secondHalfHeartRate === null ? null : rounded(secondHalfHeartRate, 1),
    heartRateFadeBpm: heartRateFadeBpm === null ? null : rounded(heartRateFadeBpm, 1),
    firstHalfPower: firstHalfPower === null ? null : rounded(firstHalfPower, 1),
    secondHalfPower: secondHalfPower === null ? null : rounded(secondHalfPower, 1),
    powerFadePercent: powerFadePercent === null ? null : rounded(powerFadePercent, 2),
    cadenceFade: cadenceFade === null ? null : rounded(cadenceFade, 1),
  };
}