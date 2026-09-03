// ============================================================
// EnduroLab - Elevation And Grade Analytics
// ============================================================
// Computes weekly elevation gain per mile and compares observed
// pace, heart rate, and measured power across flat, climbing, and
// descending terrain. Per-sample `distanceMeters` is unreliable in
// the stored Garmin data (often null), so activity distance comes
// from the activity summary. Grade is derived from consecutive
// sample pairs — Δelevation ÷ (speed × Δt) — because the stored
// `grade` column is empty for real Garmin detail.
//
// `power` is surface-only when hasMeasuredPower is true. This
// function never models missing power.
// ============================================================

export interface ElevationGradeSampleInput {
  activityId: string;
  elapsedSeconds: number;
  heartRate: number | null;
  power: number | null;
  speedMetersPerSecond: number | null;
  elevationMeters: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ElevationGradeActivityInput {
  activityId: string;
  activityStartDate: string;
  /** Distance stored on the activity summary (run_activities.distance_meters). */
  summaryDistanceMeters: number | null;
  samples: ElevationGradeSampleInput[];
}

export interface ElevationGradeWeek {
  weekNumber: number;
  distanceMiles: number;
  gainFeet: number;
  lossFeet: number;
  elevationGainFeetPerMile: number | null;
}

export type GradeBandKey = "flat" | "climbing" | "descending";

export interface GradeBandResult {
  key: GradeBandKey;
  label: string;
  usableMinutes: number;
  activityCount: number;
  paceSecondsPerMile: number | null;
  heartRate: number | null;
  powerWattsMeasured: number | null;
}

export interface ElevationGradeAnalysisResult {
  /** Total activities in the sample set (before any gates). */
  totalActivities: number;
  /** Activities that passed every gate and contributed to aggregates. */
  qualifyingActivities: number;
  /** When set, aggregates are computed from fewer than three qualifying runs. */
  partialNote: string | null;
  /** Why, if any, no aggregates could be produced. */
  suppressReason: string | null;
  /** Breakdown of which gate rejected each activity (useful for UI hints). */
  rejectionReasons: Record<string, number>;
  elevationGainFeetPerMile: number | null;
  distanceMiles: number;
  weeks: ElevationGradeWeek[];
  bands: GradeBandResult[];
}

export interface ElevationGradeWeekWindow {
  weekNumber: number;
  startDate: string;
  endDate: string;
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const MINIMUM_ACTIVITY_USABLE_MINUTES = 6;
const MINIMUM_ACTIVITY_DISTANCE_METERS = 500;
const MINIMUM_QUALIFYING_ACTIVITIES = 3;
const MINIMUM_BAND_USABLE_MINUTES = 8;
const MINIMUM_BAND_ACTIVITIES = 2;
const MINIMUM_BAND_VALUES = 20;
const GPS_COVERAGE_THRESHOLD = 0.4;
const ELEVATION_COVERAGE_THRESHOLD = 0.3;
const SPEED_COVERAGE_THRESHOLD = 0.3;
const MAXIMUM_PLAUSIBLE_GRADE = 0.25;
const FLAT_GRADE_TOLERANCE = 0.02;
const MAXIMUM_CONSECUTIVE_ELEVATION_DELTA_METERS = 35;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function finite(value: number | null | undefined, minimum?: number, maximum?: number): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
    && (minimum === undefined || value >= minimum)
    && (maximum === undefined || value <= maximum);
}

function bandKey(grade: number): GradeBandKey {
  if (grade >= -FLAT_GRADE_TOLERANCE && grade <= FLAT_GRADE_TOLERANCE) return "flat";
  return grade > 0 ? "climbing" : "descending";
}

interface BandSamples {
  band: GradeBandKey;
  speeds: number[];
  heartRates: number[];
  powers: number[];
  seconds: number;
}

interface ActivitySummary {
  activityId: string;
  startDate: string;
  distanceMeters: number;
  gainMeters: number;
  lossMeters: number;
  gpsCoverage: number;
  elevationCoverage: number;
  speedCoverage: number;
  usableMinutes: number;
  bands: Map<GradeBandKey, BandSamples>;
}

/**
 * Analyze elevation gain and flat/climbing/describing physiological response.
 *
 * `power` on samples is only used when `hasMeasuredPower` is true;
 * callers are responsible for ensuring it is measured sensor power.
 * This function never models missing power.
 */
export function analyzeElevationAndGrade(
  activities: ElevationGradeActivityInput[],
  weeks: ElevationGradeWeekWindow[],
  hasMeasuredPower = false,
): ElevationGradeAnalysisResult {
  const totalActivities = activities.length;
  const rejections: Record<string, number> = {
    too_short: 0,
    too_short_distance: 0,
    insufficient_gps: 0,
    insufficient_elevation: 0,
    insufficient_speed: 0,
  };
  const reject = (code: keyof typeof rejections): void => { rejections[code] += 1; };

  const qualifying: ActivitySummary[] = [];
  for (const activity of activities) {
    const sorted = [...activity.samples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) continue;
    const usableMinutes = Math.max(0, last.elapsedSeconds - first.elapsedSeconds) / 60;
    if (usableMinutes < MINIMUM_ACTIVITY_USABLE_MINUTES) {
      reject("too_short");
      continue;
    }

    // Prefer the activity summary distance. Fall back to speed-integrated
    // distance when the summary is null or implausibly small.
    let distanceMeters = finite(activity.summaryDistanceMeters, 100, 100_000)
      ? activity.summaryDistanceMeters!
      : 0;
    if (distanceMeters < MINIMUM_ACTIVITY_DISTANCE_METERS) {
      let fallback = 0;
      let prevT: number | null = null;
      let prevS: number | null = null;
      for (const sample of sorted) {
        if (finite(sample.speedMetersPerSecond, 0.5, 10) && prevT !== null && prevS !== null) {
          fallback += (sample.speedMetersPerSecond + prevS) / 2 * (sample.elapsedSeconds - prevT);
        }
        prevT = sample.elapsedSeconds;
        prevS = sample.speedMetersPerSecond;
      }
      distanceMeters = Math.max(distanceMeters, fallback);
    }
    if (distanceMeters < MINIMUM_ACTIVITY_DISTANCE_METERS) {
      reject("too_short_distance");
      continue;
    }

    let gainMeters = 0;
    let lossMeters = 0;
    let gpsCount = 0;
    let elevationCount = 0;
    let speedCount = 0;
    const bands = new Map<GradeBandKey, BandSamples>();
    for (const sample of sorted) {
      if (finite(sample.latitude, -90, 90) && finite(sample.longitude, -180, 180)) gpsCount += 1;
      if (finite(sample.elevationMeters, -500, 10_000)) elevationCount += 1;
      if (finite(sample.speedMetersPerSecond, 0.5, 10)) speedCount += 1;
    }

    // Derive gradient bands from consecutive sample pairs.
    let prev: ElevationGradeSampleInput | null = null;
    for (const sample of sorted) {
      if (prev !== null) {
        const dt = sample.elapsedSeconds - prev.elapsedSeconds;
        if (dt > 0) {
          const prevElev = prev.elevationMeters;
          const currElev = sample.elevationMeters;
          const midSpeed = (
            (finite(prev.speedMetersPerSecond, 0.5, 10) ? prev.speedMetersPerSecond! : 0)
            + (finite(sample.speedMetersPerSecond, 0.5, 10) ? sample.speedMetersPerSecond! : 0)
          ) / 2;
          if (
            prevElev !== null && currElev !== null
            && finite(midSpeed, 0.5, 10)
            && Math.abs(currElev - prevElev) <= MAXIMUM_CONSECUTIVE_ELEVATION_DELTA_METERS
          ) {
            const dtMeters = midSpeed * dt;
            if (dtMeters >= 1) {
              const grade = (currElev - prevElev) / dtMeters;
              if (finite(grade, -MAXIMUM_PLAUSIBLE_GRADE, MAXIMUM_PLAUSIBLE_GRADE)) {
                const band = bandKey(grade);
                if (band === "climbing") gainMeters += currElev - prevElev;
                else if (band === "descending") lossMeters += prevElev - currElev;
                let state = bands.get(band);
                if (!state) {
                  state = { band, speeds: [], heartRates: [], powers: [], seconds: 0 };
                  bands.set(band, state);
                }
                state.seconds += dt;
                if (finite(sample.speedMetersPerSecond, 0.8, 10)) state.speeds.push(sample.speedMetersPerSecond!);
                if (finite(sample.heartRate, 80, 210)) state.heartRates.push(sample.heartRate!);
                if (hasMeasuredPower && finite(sample.power, 60, 800)) state.powers.push(sample.power!);
              }
            }
          }
        }
      }
      prev = sample;
    }

    const gpsCoverage = sorted.length > 0 ? gpsCount / sorted.length : 0;
    const elevationCoverage = sorted.length > 0 ? elevationCount / sorted.length : 0;
    const speedCoverage = sorted.length > 0 ? speedCount / sorted.length : 0;
    if (gpsCoverage < GPS_COVERAGE_THRESHOLD) {
      reject("insufficient_gps");
      continue;
    }
    if (elevationCoverage < ELEVATION_COVERAGE_THRESHOLD) {
      reject("insufficient_elevation");
      continue;
    }
    if (speedCoverage < SPEED_COVERAGE_THRESHOLD) {
      reject("insufficient_speed");
      continue;
    }

    qualifying.push({
      activityId: activity.activityId,
      startDate: activity.activityStartDate,
      distanceMeters,
      gainMeters,
      lossMeters,
      gpsCoverage,
      elevationCoverage,
      speedCoverage,
      usableMinutes,
      bands,
    });
  }

  if (qualifying.length === 0) {
    const reason = buildSuppression(totalActivities, rejections);
    return {
      totalActivities,
      qualifyingActivities: 0,
      partialNote: null,
      suppressReason: reason,
      rejectionReasons: rejections,
      elevationGainFeetPerMile: null,
      distanceMiles: 0,
      weeks: [],
      bands: [],
    };
  }

  const partialNote = qualifying.length < MINIMUM_QUALIFYING_ACTIVITIES
    ? `Showing results from ${qualifying.length} qualifying ${qualifying.length === 1 ? "run" : "runs"} (at least three is preferred for a reliable trend).`
    : null;

  const totalDistanceMiles = qualifying.reduce((sum, a) => sum + a.distanceMeters / METERS_PER_MILE, 0);
  const totalGainFeet = qualifying.reduce((sum, a) => sum + a.gainMeters / METERS_PER_FOOT, 0);

  const weeklyTotals = new Map<number, { distanceMeters: number; gainMeters: number; lossMeters: number }>();
  for (const activity of qualifying) {
    const week = weeks.find((entry) => activity.startDate >= entry.startDate && activity.startDate <= entry.endDate);
    if (!week) continue;
    const totals = weeklyTotals.get(week.weekNumber) ?? { distanceMeters: 0, gainMeters: 0, lossMeters: 0 };
    totals.distanceMeters += activity.distanceMeters;
    totals.gainMeters += activity.gainMeters;
    totals.lossMeters += activity.lossMeters;
    weeklyTotals.set(week.weekNumber, totals);
  }

  const weeksResult: ElevationGradeWeek[] = [...weeklyTotals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekNumber, totals]) => {
      const distanceMiles = totals.distanceMeters / METERS_PER_MILE;
      return {
        weekNumber,
        distanceMiles: Math.round(distanceMiles * 100) / 100,
        gainFeet: Math.round(totals.gainMeters / METERS_PER_FOOT),
        lossFeet: Math.round(totals.lossMeters / METERS_PER_FOOT),
        elevationGainFeetPerMile: distanceMiles > 0
          ? Math.round(totals.gainMeters / METERS_PER_FOOT / distanceMiles * 10) / 10
          : null,
      };
    });

  const allBands = new Map<GradeBandKey, BandSamples>();
  for (const activity of qualifying) {
    for (const state of activity.bands.values()) {
      const existing = allBands.get(state.band);
      if (!existing) {
        allBands.set(state.band, {
          band: state.band,
          speeds: [...state.speeds],
          heartRates: [...state.heartRates],
          powers: [...state.powers],
          seconds: state.seconds,
        });
      } else {
        existing.speeds.push(...state.speeds);
        existing.heartRates.push(...state.heartRates);
        existing.powers.push(...state.powers);
        existing.seconds += state.seconds;
      }
    }
  }

  const bands = (["flat", "climbing", "descending"] as const)
    .map((key): GradeBandResult => {
      const state = allBands.get(key);
      const activitiesInBand = qualifying.filter((a) => a.bands.has(key)).length;
      const minutes = state ? state.seconds / 60 : 0;
      if (!state || activitiesInBand < MINIMUM_BAND_ACTIVITIES || minutes < MINIMUM_BAND_USABLE_MINUTES) {
        return {
          key,
          label: key === "flat" ? "Flat" : key === "climbing" ? "Climbing" : "Descending",
          usableMinutes: Math.round(minutes),
          activityCount: activitiesInBand,
          paceSecondsPerMile: null,
          heartRate: null,
          powerWattsMeasured: null,
        };
      }
      return {
        key,
        label: key === "flat" ? "Flat" : key === "climbing" ? "Climbing" : "Descending",
        usableMinutes: Math.round(minutes),
        activityCount: activitiesInBand,
        paceSecondsPerMile: state.speeds.length >= MINIMUM_BAND_VALUES
          ? Math.round(METERS_PER_MILE / median(state.speeds))
          : null,
        heartRate: state.heartRates.length >= MINIMUM_BAND_VALUES
          ? Math.round(median(state.heartRates))
          : null,
        powerWattsMeasured: hasMeasuredPower && state.powers.length >= MINIMUM_BAND_VALUES
          ? Math.round(median(state.powers))
          : null,
      };
    });

  return {
    totalActivities,
    qualifyingActivities: qualifying.length,
    partialNote,
    elevationGainFeetPerMile: totalDistanceMiles > 0
      ? Math.round(totalGainFeet / totalDistanceMiles * 10) / 10
      : null,
    distanceMiles: Math.round(totalDistanceMiles * 100) / 100,
    weeks: weeksResult,
    bands,
    rejectionReasons: rejections,
    suppressReason: null,
  };
}

function buildSuppression(totalActivities: number, rejections: Record<string, number>): string {
  if (totalActivities === 0) return "No activity detail samples are stored yet.";
  const format = (n: number, singular: string, plural: string): string =>
    `${n} ${n === 1 ? singular : plural}`;
  const parts = Object.entries(rejections)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => {
      switch (code) {
        case "too_short":
          return `${format(count, "run under 6 minutes", "runs under 6 minutes")}`;
        case "too_short_distance":
          return `${format(count, "run under 1/3 mile", "runs under 1/3 mile")}`;
        case "insufficient_gps":
          return `${format(count, "run with weak GPS", "runs with weak GPS")}`;
        case "insufficient_elevation":
          return `${format(count, "run with no elevation data", "runs with no elevation data")}`;
        case "insufficient_speed":
          return `${format(count, "run with no speed data", "runs with no speed data")}`;
        default:
          return null;
      }
    })
    .filter((label): label is string => label !== null);
  return parts.length > 0
    ? `None of the ${totalActivities} runs qualified — ${parts.join(", ")}.`
    : `None of the ${totalActivities} runs qualified.`;
}
