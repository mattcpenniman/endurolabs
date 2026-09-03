// ============================================================
// EnduroLab - Cadence By Pace Analytics
// ============================================================
// Describes weekly cadence within fixed pace bands. Sensor samples
// are paired and smoothed before bucketing so pace changes do not
// get mistaken for cadence changes.
// ============================================================

export interface CadenceSampleInput {
  activityId: string;
  activityStartDate: string;
  elapsedSeconds: number;
  cadence: number | null;
  speedMetersPerSecond: number | null;
}

export interface CadenceWeekWindow {
  weekNumber: number;
  startDate: string;
  endDate: string;
}

export interface CadenceWeekPoint {
  weekNumber: number;
  cadenceSpm: number;
  usableMinutes: number;
  activityCount: number;
}

export interface CadencePaceBandTrend {
  key: string;
  label: string;
  minimumPaceSecondsPerMile: number;
  maximumPaceSecondsPerMile: number;
  weeks: CadenceWeekPoint[];
}

export interface CadenceByPaceResult {
  bands: CadencePaceBandTrend[];
}

const METERS_PER_MILE = 1609.344;
const WINDOW_SECONDS = 30;
const PACE_BAND_SECONDS = 30;
const MINIMUM_WINDOW_SPAN_SECONDS = 20;
const MINIMUM_WEEKLY_WINDOWS = 20;
const MINIMUM_SPEED_METERS_PER_SECOND = 1.8;
const MAXIMUM_SPEED_METERS_PER_SECOND = 8;
const MINIMUM_HALF_CADENCE = 50;
const FULL_CADENCE_THRESHOLD = 120;
const MAXIMUM_FULL_CADENCE = 240;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatPace(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function paceBand(secondsPerMile: number): Omit<CadencePaceBandTrend, "weeks"> {
  const minimum = Math.floor(secondsPerMile / PACE_BAND_SECONDS) * PACE_BAND_SECONDS;
  const maximum = minimum + PACE_BAND_SECONDS - 1;
  return {
    key: String(minimum),
    label: `${formatPace(minimum)}-${formatPace(maximum)} /mi`,
    minimumPaceSecondsPerMile: minimum,
    maximumPaceSecondsPerMile: maximum,
  };
}

function matchingWeek(date: string, weeks: CadenceWeekWindow[]): CadenceWeekWindow | null {
  return weeks.find((week) => date >= week.startDate && date <= week.endDate) ?? null;
}

function normalizeCadence(cadence: number | null): number | null {
  if (cadence === null || !Number.isFinite(cadence)) return null;
  if (cadence >= MINIMUM_HALF_CADENCE && cadence < FULL_CADENCE_THRESHOLD) return cadence * 2;
  if (cadence >= FULL_CADENCE_THRESHOLD && cadence <= MAXIMUM_FULL_CADENCE) return cadence;
  return null;
}

export function analyzeCadenceByPace(
  samples: CadenceSampleInput[],
  weeks: CadenceWeekWindow[],
): CadenceByPaceResult {
  const samplesByWindow = new Map<string, CadenceSampleInput[]>();
  for (const sample of samples) {
    const cadence = normalizeCadence(sample.cadence);
    if (
      cadence === null
      || sample.speedMetersPerSecond === null
      || !Number.isFinite(sample.speedMetersPerSecond)
      || sample.speedMetersPerSecond < MINIMUM_SPEED_METERS_PER_SECOND
      || sample.speedMetersPerSecond > MAXIMUM_SPEED_METERS_PER_SECOND
    ) continue;
    const windowIndex = Math.floor(sample.elapsedSeconds / WINDOW_SECONDS);
    const key = `${sample.activityId}:${windowIndex}`;
    const windowSamples = samplesByWindow.get(key) ?? [];
    windowSamples.push({ ...sample, cadence });
    samplesByWindow.set(key, windowSamples);
  }

  const bandMetadata = new Map<string, Omit<CadencePaceBandTrend, "weeks">>();
  const weeklyWindows = new Map<string, Array<{ cadence: number; activityId: string }>>();
  for (const windowSamples of samplesByWindow.values()) {
    const elapsed = windowSamples.map((sample) => sample.elapsedSeconds);
    if (windowSamples.length < 3 || Math.max(...elapsed) - Math.min(...elapsed) < MINIMUM_WINDOW_SPAN_SECONDS) continue;
    const week = matchingWeek(windowSamples[0].activityStartDate, weeks);
    if (!week) continue;
    const speed = median(windowSamples.map((sample) => sample.speedMetersPerSecond!));
    const cadence = median(windowSamples.map((sample) => sample.cadence!));
    const band = paceBand(METERS_PER_MILE / speed);
    bandMetadata.set(band.key, band);
    const key = `${band.key}:${week.weekNumber}`;
    const entries = weeklyWindows.get(key) ?? [];
    entries.push({ cadence, activityId: windowSamples[0].activityId });
    weeklyWindows.set(key, entries);
  }

  const bands = [...bandMetadata.values()]
    .sort((a, b) => a.minimumPaceSecondsPerMile - b.minimumPaceSecondsPerMile)
    .map((band): CadencePaceBandTrend => {
      const points = weeks.flatMap((week): CadenceWeekPoint[] => {
        const entries = weeklyWindows.get(`${band.key}:${week.weekNumber}`) ?? [];
        if (entries.length < MINIMUM_WEEKLY_WINDOWS) return [];
        return [{
          weekNumber: week.weekNumber,
          cadenceSpm: Math.round(median(entries.map((entry) => entry.cadence)) * 10) / 10,
          usableMinutes: Math.round(entries.length * WINDOW_SECONDS / 60),
          activityCount: new Set(entries.map((entry) => entry.activityId)).size,
        }];
      });
      return { ...band, weeks: points };
    })
    .filter((band) => band.weeks.length > 0);

  return { bands };
}
