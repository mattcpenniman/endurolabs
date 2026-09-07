// ============================================================
// EnduroLab - Course Elevation Comparison
// ============================================================
// Compares an uploaded GPX course against the athlete's stored
// running history (activity_samples) and produces a plain-language
// elevation/grade difference note plus bounded pace adjustments.
//
// Elevation and grade handling mirrors src/lib/analytics/
// elevation-grade.ts: course distance comes from cumulative ground
// distance, athlete grade is re-derived from sample pairs
// (Δelevation ÷ (average speed × Δt)), and per-sample distanceMeters
// and grade are never assumed to exist.
//
// The pace adjustment is derived from a single transparent
// assumption — climbing costs roughly the same power as flat
// running at the grade's pace-penalty — so it is presented as a
// small sensitivity window, not a fitted prediction.
// ============================================================

import {
  analyzeElevationAndGrade,
  ElevationGradeActivityInput,
  ElevationGradeWeekWindow,
} from "@/lib/analytics/elevation-grade";
import {
  CoursePoint,
  PROFILE_STEP,
  courseElevationSummary,
  gradeBands,
  resampleProfile,
} from "./gpx";

export type CourseRole = "target" | "training";

export interface CourseSeriesInput {
  name: string;
  role: CourseRole;
  points: CoursePoint[];
  /** Where per-point elevation came from (defaults to the GPX file). */
  elevationSource?: "gpx" | "open-elevation";
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
/**
 * Pace sensitivity constants (fixed, not fitted to any athlete).
 * Assumption chain: an extra 1 m of climbing per mile implies roughly
 * 1/0.03 m of 3%-grade uphill distance; at constant effort a 3% grade
 * costs ≈5.4% of time (Daniels ~1.8%/grade point); over a 400 s/mile
 * mile that is ≈0.45 s. Below is that product, rounded to 0.45.
 */
const EXTRA_SECONDS_PER_MILE_PER_METER_OF_GAIN_PER_MILE = 0.45;
/** Cap so a noisy GPX cannot move pace expectations by more than ±15%
 *  of a 400 s/mile reference pace. */
const MAXIMUM_PACE_ADJUSTMENT_SECONDS_PER_MILE = 60;
/** Below this difference the note treats the courses as equivalent. */
const ELEVATION_DIFFERENCE_TOLERANCE_FEET_PER_MILE = 15;
const REFERENCE_PACE_SECONDS_PER_MILE = 400;

export interface CourseComparisonResult {
  /** Normalized elevation profiles (distance as %, 0-100) for charting. */
  profiles: Array<{
    key: string;
    name: string;
    role: CourseRole;
    points: Array<{ axis: number; elevationMeters: number | null }>;
  }>;
  target: CourseMetrics;
  /** Athlete training comparison derived from stored sample data. */
  athlete: {
    hasSampleData: boolean;
    note: string | null;
    elevationGainFeetPerMile: number | null;
    qualifyingActivities: number;
    partialNote: string | null;
    bands: Array<{
      key: string;
      label: string;
      usableMinutes: number;
      activityCount: number;
      paceSecondsPerMile: number | null;
      heartRate: number | null;
    }>;
  };
  difference: {
    elevationGainFeetPerMileTarget: number | null;
    elevationGainFeetPerMileAthlete: number | null;
    /** Positive = target climbs more per mile than the athlete's races. */
    deltaFeetPerMile: number | null;
    gradeDistributionDelta: Array<{
      label: string;
      targetSharePercent: number;
      athleteSharePercent: number | null;
      deltaPercent: number | null;
    }>;
    /** Bounded seconds-per-mile pace shift attributed to terrain. */
    paceAdjustmentSecondsPerMile: number | null;
    paceAdjustmentPercent: number | null;
    equivalentTimeSeconds: number | null;
    /** Plain-language reading, e.g. "Berlin gains 1,067 ft/mile more…". */
    note: string;
    /** True when the difference is within the equivalence tolerance. */
    withinTolerance: boolean;
  };
}

export interface CourseMetrics {
  name: string;
  role: CourseRole;
  distanceMeters: number;
  distanceMiles: number;
  gainFeet: number;
  lossFeet: number;
  netFeet: number;
  elevationGainFeetPerMile: number | null;
  elevationCoverage: number;
  /** "gpx" = from the uploaded file, "open-elevation" = backfilled DEM. */
  elevationSource: "gpx" | "open-elevation";
  gradeBands: Array<{
    key: string;
    label: string;
    distanceMeters: number;
    sharePercent: number;
  }>;
}

function courseMetrics(input: CourseSeriesInput): CourseMetrics {
  const points = input.points;
  const totalMeters = points.length > 0
    ? points[points.length - 1].cumulativeMeters - points[0].cumulativeMeters
    : 0;
  const totalMiles = Math.max(0.01, totalMeters / METERS_PER_MILE);
  const elevation = courseElevationSummary(points);
  const gainFeet = elevation.gainMeters / METERS_PER_FOOT;
  const lossFeet = elevation.lossMeters / METERS_PER_FOOT;
  return {
    name: input.name,
    role: input.role,
    distanceMeters: Math.round(totalMeters),
    distanceMiles: Math.round(totalMiles * 100) / 100,
    gainFeet: Math.round(gainFeet),
    lossFeet: Math.round(lossFeet),
    netFeet: Math.round(elevation.netMeters / METERS_PER_FOOT),
    elevationGainFeetPerMile: elevation.elevationCoverage >= 0.3
      ? Math.round((gainFeet / totalMiles) * 10) / 10
      : null,
    elevationCoverage: Math.round(elevation.elevationCoverage * 100) / 100,
    elevationSource: input.elevationSource ?? "gpx",
    gradeBands: gradeBands(points),
  };
}

function athleteGradeShares(analysis: ReturnType<typeof analyzeElevationAndGrade>):
  Record<string, number> | null {
  if (analysis.qualifyingActivities === 0) return null;
  const totals = new Map<string, number>();
  let covered = 0;
  for (const band of analysis.bands) {
    if (band.usableMinutes > 0 && band.activityCount > 0) {
      totals.set(band.key, band.usableMinutes);
      covered += band.usableMinutes;
    }
  }
  if (covered === 0) return null;
  const shares: Record<string, number> = {};
  for (const [key, minutes] of totals) {
    shares[key] = Math.round((minutes / covered) * 1000) / 10;
  }
  // The GPX band split is finer; attribute the athlete's "climbing" bucket
  // evenly across the two upward GPX bands, likewise for descending.
  const athlete = {
    climbing: shares["climbing"] ?? 0,
    descending: shares["descending"] ?? 0,
    flat: shares["flat"] ?? 0,
  };
  return {
    steep_climbing: Math.round(athlete.climbing * 0.45 * 10) / 10,
    climbing: Math.round(athlete.climbing * 0.55 * 10) / 10,
    flat: athlete.flat,
    descending: Math.round(athlete.descending * 0.55 * 10) / 10,
    steep_descending: Math.round(athlete.descending * 0.45 * 10) / 10,
  };
}

function describeGradeDeltas(
  targetBands: CourseMetrics["gradeBands"],
  athleteShares: Record<string, number> | null,
): string[] {
  const phrasing: string[] = [];
  const byKey = new Map(targetBands.map((b) => [b.key, b]));
  const athleteUp = athleteShares
    ? (athleteShares["steep_climbing"] ?? 0) + (athleteShares["climbing"] ?? 0)
    : null;
  const targetUp = (byKey.get("steep_climbing")?.sharePercent ?? 0)
    + (byKey.get("climbing")?.sharePercent ?? 0);
  if (athleteUp !== null && targetUp - athleteUp >= 10) {
    phrasing.push(`it runs ${Math.round(targetUp - athleteUp)} points more of its distance uphill than you have trained on`);
  } else if (athleteUp !== null && athleteUp - targetUp >= 10) {
    phrasing.push(`it has ${Math.round(athleteUp - targetUp)} points less uphill distance than your trained terrain`);
  }
  const targetDown = (byKey.get("steep_descending")?.sharePercent ?? 0) + (byKey.get("descending")?.sharePercent ?? 0);
  const athleteDown = athleteShares
    ? (athleteShares["steep_descending"] ?? 0) + (athleteShares["descending"] ?? 0)
    : null;
  if (athleteDown !== null && Math.abs(targetDown - athleteDown) >= 10) {
    phrasing.push(targetDown > athleteDown
      ? `with ${Math.round(targetDown - athleteDown)} more points of downhill`
      : `with ${Math.round(athleteDown - targetDown)} fewer points of downhill`);
  }
  return phrasing;
}

function equivalentSecondsForMiles(miles: number, adjustmentSecondsPerMile: number): number {
  return Math.round(miles * adjustmentSecondsPerMile);
}

/**
 * Compares course profile, grade distribution, and pace impact against
 * the athlete's stored history.
 *
 * @param targetSeries One or two GPX courses (target = the race, training =
 *        prior racing for reference).
 * @param athleteActivities Stored sample traces used to build the
 *        elevation/grade baseline.
 * @param athleteWeeks Windows for the elevation/grade analytics.
 */
export function buildCourseComparison(input: {
  targetSeries: CourseSeriesInput[];
  athleteActivities: ElevationGradeActivityInput[];
  athleteWeeks: ElevationGradeWeekWindow[];
}): CourseComparisonResult {
  const target = courseMetrics(input.targetSeries[0]);
  const profiles = input.targetSeries.map((series) => {
    const totalMeters = series.points.length > 0
      ? series.points[series.points.length - 1].cumulativeMeters - series.points[0].cumulativeMeters
      : 0;
    const samples = PROFILE_STEP;
    const distances = Array.from(
      { length: samples + 1 },
      (_, i) => totalMeters > 0 ? (i * totalMeters) / samples : 0,
    );
    const resampled = resampleProfile(
      series.points.map((p) => ({
        distanceMeters: p.cumulativeMeters - series.points[0].cumulativeMeters,
        elevationMeters: p.elevationMeters,
      })),
      distances,
    );
    return {
      key: series.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
      name: series.name,
      role: series.role,
      points: resampled.map((p) => ({
        axis: totalMeters > 0 ? Math.round((p.distanceMeters / totalMeters) * 1000) / 10 : 0,
        elevationMeters: p.elevationMeters,
      })),
    };
  });

  const analysis = analyzeElevationAndGrade(
    input.athleteActivities,
    input.athleteWeeks,
    false,
  );
  const athleteShares = athleteGradeShares(analysis);
  const athleteGainFpm = analysis.elevationGainFeetPerMile;

  const delta = target.elevationGainFeetPerMile !== null && athleteGainFpm !== null
    ? Math.round((target.elevationGainFeetPerMile - athleteGainFpm) * 10) / 10
    : null;
  const withinTolerance = delta === null
    || Math.abs(delta) < ELEVATION_DIFFERENCE_TOLERANCE_FEET_PER_MILE;

  // Pace sensitivity: the extra climbing per mile on the target race
  // versus what the athlete has trained on slows the equivalent pace by
  // a fixed seconds-per-mille gain rate — positive when the target is
  // harder, negative when it is flatter.
  let paceAdjustmentSecondsPerMile: number | null = null;
  if (delta !== null && (athleteShares !== null || target.elevationGainFeetPerMile !== null)) {
    const extraMetersPerMile = (delta * METERS_PER_FOOT);
    const raw = extraMetersPerMile * EXTRA_SECONDS_PER_MILE_PER_METER_OF_GAIN_PER_MILE;
    if (Number.isFinite(raw) && Math.abs(raw) > 1) {
      const capped = Math.max(
        -MAXIMUM_PACE_ADJUSTMENT_SECONDS_PER_MILE,
        Math.min(MAXIMUM_PACE_ADJUSTMENT_SECONDS_PER_MILE, raw),
      );
      paceAdjustmentSecondsPerMile = Math.round(capped);
    }
  }

  const paceAdjustmentPercent = paceAdjustmentSecondsPerMile !== null
    ? Math.round((paceAdjustmentSecondsPerMile / REFERENCE_PACE_SECONDS_PER_MILE) * 100) / 100
    : null;
  const equivalentTimeSeconds = paceAdjustmentSecondsPerMile !== null
    ? equivalentSecondsForMiles(target.distanceMiles, paceAdjustmentSecondsPerMile)
    : null;

  const gradeDistributionDelta = target.gradeBands.map((band) => {
    const athlete = athleteShares?.[band.key] ?? null;
    return {
      label: band.label,
      targetSharePercent: band.sharePercent,
      athleteSharePercent: athlete,
      deltaPercent: athlete !== null
        ? Math.round((band.sharePercent - athlete) * 10) / 10
        : null,
    };
  });

  let note = "";
  const demCaveat = target.elevationSource === "open-elevation"
    ? " Elevation is backfilled from a 30 m digital elevation model (Open-Elevation), so small undulations are smoothed out."
    : "";
  if (target.elevationGainFeetPerMile === null) {
    note = `${target.name} does not include elevation data in the GPX file, so no elevation comparison can be made. The distance profile is still available.`;
  } else if (athleteGainFpm === null) {
    note = `${target.name} gains about ${formatFeetPerMile(target.elevationGainFeetPerMile)}. There is not yet enough qualifying sample history to benchmark the climbing against your recent racing, so treat the profile and terrain-mix chart as the primary reference for splits.${gradeNote(gradeDistributionDelta)}`;
  } else if (withinTolerance) {
    note = `${target.name} gains about ${formatFeetPerMile(target.elevationGainFeetPerMile)} of elevation per mile${
      athleteGainFpm !== null ? ` versus your recent racing (${formatFeetPerMile(athleteGainFpm)})` : ""
    } — the terrain is close enough that your pace expectations transfer directly. ${gradeNote(gradeDistributionDelta)}`;
  } else if ((paceAdjustmentPercent ?? 0) >= 0.005) {
    const grade = describeGradeDeltas(target.gradeBands, athleteShares);
    note = `${target.name} gains ${formatFeetPerMile(target.elevationGainFeetPerMile)} per mile — ${formatFeetPerMile(delta!)} more than your recent racing${
      athleteGainFpm !== null ? ` (${formatFeetPerMile(athleteGainFpm)})` : ""
    }. Expect to lose roughly ${formatSeconds(paceAdjustmentSecondsPerMile!)} per mile${
      equivalentTimeSeconds !== null ? ` (about ${formatDuration(equivalentTimeSeconds)} on the full distance)` : ""
    }${grade.length > 0 ? `; ${grade.join(", ")}` : ""}. Build the climbs into your splits rather than treating them as pace losses — that is where the time-pickup comes from on a hilly target.`;
  } else if ((paceAdjustmentPercent ?? 0) <= -0.005) {
    note = `${target.name} is flatter than your recent racing: ${formatFeetPerMile(target.elevationGainFeetPerMile)} per mile${
      athleteGainFpm !== null ? ` versus your ${formatFeetPerMile(athleteGainFpm)}` : ""
    }. That is worth roughly ${formatSeconds(Math.abs(paceAdjustmentSecondsPerMile!))} per mile of time-pickup potential${
      equivalentTimeSeconds !== null ? ` (${formatDuration(Math.abs(equivalentTimeSeconds))} on the full distance)` : ""
    }. Your forecast is fitness-based, so this upside is an execution opportunity — the flatness is not a fitness change.`;
  } else {
    note = `${target.name} gains ${formatFeetPerMile(target.elevationGainFeetPerMile)} per mile${
      athleteGainFpm !== null ? ` versus your ${formatFeetPerMile(athleteGainFpm)}` : ""
    }. The profile differs in shape${gradeNote(gradeDistributionDelta)} but the net climbing per mile is similar to what you have trained on, so your race-forecast time should hold with normal variance.`;
  }
  if (demCaveat) note += demCaveat;

  return {
    profiles,
    target,
    athlete: {
      hasSampleData: analysis.qualifyingActivities > 0 || analysis.suppressReason !== null,
      note: analysis.suppressReason ?? null,
      elevationGainFeetPerMile: analysis.elevationGainFeetPerMile,
      qualifyingActivities: analysis.qualifyingActivities,
      partialNote: analysis.partialNote,
      bands: analysis.bands.map((b) => ({
        key: b.key,
        label: b.label,
        usableMinutes: b.usableMinutes,
        activityCount: b.activityCount,
        paceSecondsPerMile: b.paceSecondsPerMile,
        heartRate: b.heartRate,
      })),
    },
    difference: {
      elevationGainFeetPerMileTarget: target.elevationGainFeetPerMile,
      elevationGainFeetPerMileAthlete: athleteGainFpm,
      deltaFeetPerMile: delta,
      gradeDistributionDelta,
      paceAdjustmentSecondsPerMile,
      paceAdjustmentPercent,
      equivalentTimeSeconds,
      note,
      withinTolerance,
    },
  };
}

function formatFeetPerMile(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} ft/mile`;
}

function formatSeconds(seconds: number): string {
  const total = Math.abs(seconds);
  if (total < 60) return `${Math.round(total)} seconds`;
  const minutes = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  return rest > 0 ? `${minutes} minutes ${rest} seconds` : `${minutes} minutes`;
}

function formatDuration(seconds: number): string {
  const total = Math.abs(Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes} minutes`;
  return `${total} seconds`;
}

function gradeNote(deltas: Array<{ deltaPercent: number | null }>): string {
  const significant = deltas
    .map((d) => d.deltaPercent)
    .filter((d): d is number => d !== null)
    .filter((d) => Math.abs(d) >= 10);
  if (significant.length === 0) return "";
  const uphill = significant.filter((d) => d > 0).length;
  const downhill = significant.filter((d) => d < 0).length;
  if (uphill > 0 && downhill === 0) return "Expect a heavier climb concentration than your recent races.";
  if (downhill > 0 && uphill === 0) return "The downhill mix is also lighter than your recent races.";
  return "The grade mix is different from your recent races.";
}
