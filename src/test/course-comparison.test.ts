// ============================================================
// EnduroLab - Course Elevation Comparison Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  analyzeElevationAndGrade,
  ElevationGradeActivityInput,
  ElevationGradeWeekWindow,
} from "@/lib/analytics/elevation-grade";
import {
  buildCourseComparison,
  CourseSeriesInput,
} from "@/lib/courses/comparison";
import {
  courseElevationSummary,
  gradeBands,
  CoursePoint,
} from "@/lib/courses/gpx";

const MILE_METERS = 1609.344;

/** Synthetic course: `miles` long at a constant slope (m/m) starting at a
 *  chosen elevation. ~120 sample points per mile keeps the profile
 *  resampling smooth. */
function syntheticCourse(
  name: string,
  miles: number,
  slope: number,
  startElevation = 0,
  withElevation = true,
): CourseSeriesInput {
  const points: CoursePoint[] = [];
  const steps = Math.max(40, Math.round(miles * 120));
  const perStepMeters = (miles * MILE_METERS) / steps;
  let cumulative = 0;
  let elevation = startElevation;
  for (let i = 0; i <= steps; i += 1) {
    cumulative = i * perStepMeters;
    elevation = startElevation + (i * perStepMeters) * slope;
    points.push({
      latitude: 52.52 + i * 1e-6,
      longitude: 13.405,
      elevationMeters: withElevation ? Math.round(elevation * 100) / 100 : null,
      cumulativeMeters: cumulative,
    });
  }
  return { name, role: "target", points };
}

function flatAthlete(): ElevationGradeActivityInput[] {
  const sampleActivity = (id: string, slope: number): ElevationGradeActivityInput => {
    const speed = 3.2;
    const samples = [];
    let elapsed = 0;
    let elevation = 50;
    const windows = Math.round((10 * MILE_METERS) / (speed * 10));
    for (let i = 0; i < windows; i += 1) {
      elevation += speed * 10 * slope;
      samples.push({
        activityId: id,
        elapsedSeconds: elapsed,
        heartRate: 140,
        power: null,
        speedMetersPerSecond: speed,
        elevationMeters: elevation,
        latitude: 47.6,
        longitude: -122.3,
      });
      elapsed += 10;
    }
    return {
      activityId: id,
      activityStartDate: "2026-08-10",
      summaryDistanceMeters: 10 * MILE_METERS,
      samples,
    };
  };
  return [
    sampleActivity("flat-1", 0),
    sampleActivity("flat-2", 0),
    sampleActivity("climb-1", 0.035),
  ];
}

const weeks: ElevationGradeWeekWindow[] = [
  { weekNumber: 1, startDate: "2026-08-03", endDate: "2026-08-23" },
];

describe("buildCourseComparison", () => {
  it("scores a hilly target as slower than flat-heavy stored racing", () => {
    const target = syntheticCourse("Hilly Target", 26.2, 0.024);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });

    expect(result.target.elevationGainFeetPerMile).toBeGreaterThan(100);
    expect(result.athlete.elevationGainFeetPerMile).toBeGreaterThan(0);
    expect(result.difference.deltaFeetPerMile).toBeGreaterThan(15);
    expect(result.difference.paceAdjustmentSecondsPerMile).toBeGreaterThan(0);
    expect(result.difference.equivalentTimeSeconds).toBeGreaterThan(0);
    expect(result.difference.note).toMatch(/more than your recent racing/);
    expect(result.difference.withinTolerance).toBe(false);
  });

  it("scores a flat target as time-pickup over climbing stored racing", () => {
    const target = syntheticCourse("Flat Target", 26.2, 0);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });

    expect(result.difference.deltaFeetPerMile).toBeLessThan(-15);
    expect(result.difference.paceAdjustmentSecondsPerMile).toBeLessThan(-1);
    expect(result.difference.note).toMatch(/flatter than your recent racing/);
  });

  it("treats similar courses as transferable and stays within tolerance", () => {
    // Athlete history: two flat 10-milers + one 3.5% climb → ~0.017 m/m
    // mean gain. A 0.017-slope course lands inside the ±15 ft/mile band.
    const athlete = flatAthlete();
    const athleteAnalysis = analyzeElevationAndGrade(athlete, weeks, false);
    expect(athleteAnalysis.elevationGainFeetPerMile).toBeGreaterThan(0);
    const targetSlope = (athleteAnalysis.elevationGainFeetPerMile! * 0.3048) / MILE_METERS;
    const target = syntheticCourse("Match", 26.2, targetSlope);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: athlete,
      athleteWeeks: weeks,
    });
    expect(result.difference.withinTolerance).toBe(true);
    expect(result.difference.note).toMatch(/pace expectations transfer directly/);
    expect(result.difference.paceAdjustmentSecondsPerMile).toBeNull();
  });

  it("reports courses without elevation as comparison-free", () => {
    const target = syntheticCourse("No Elev", 10, 0.02, 0, false);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });
    expect(result.target.elevationGainFeetPerMile).toBeNull();
    expect(result.difference.note).toMatch(/does not include elevation data/);
    expect(result.difference.paceAdjustmentSecondsPerMile).toBeNull();
  });

  it("falls back to descriptive notes when stored history is absent", () => {
    const target = syntheticCourse("Hilly", 26.2, 0.03);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: [],
      athleteWeeks: weeks,
    });
    expect(result.difference.elevationGainFeetPerMileAthlete).toBeNull();
    expect(result.difference.paceAdjustmentSecondsPerMile).toBeNull();
    expect(result.difference.note).toMatch(/not yet enough qualifying sample history/);
  });

  it("resamples both series onto an aligned 0-100 axis", () => {
    const target = syntheticCourse("Long", 26.2, 0.01);
    const reference = syntheticCourse("Short", 13.1, 0.02);
    const result = buildCourseComparison({
      targetSeries: [
        { ...target, role: "target" },
        { ...reference, role: "training" },
      ],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });
    expect(result.profiles).toHaveLength(2);
    for (const profile of result.profiles) {
      expect(profile.points[0]?.axis).toBe(0);
      expect(profile.points[profile.points.length - 1]?.axis).toBe(100);
      expect(profile.points.length).toBeGreaterThanOrEqual(100);
    }
    expect(result.profiles[0]?.role).toBe("target");
    expect(result.profiles[1]?.role).toBe("training");
  });

  it("caps the pace sensitivity at ±60 seconds per mile", () => {
    const athlete = [
      (() => {
        const speed = 3.2;
        const samples = [];
        let elapsed = 0;
        let elevation = 100;
        const windows = Math.round((10 * MILE_METERS) / (speed * 10));
        for (let i = 0; i < windows; i += 1) {
          // Steep 15% climbs on every step.
          elevation += speed * 10 * 0.15;
          samples.push({
            activityId: "steep",
            elapsedSeconds: elapsed,
            heartRate: 165,
            power: null,
            speedMetersPerSecond: speed,
            elevationMeters: elevation,
            latitude: 47.6,
            longitude: -122.3,
          });
          elapsed += 10;
        }
        return {
          activityId: "steep",
          activityStartDate: "2026-08-10",
          summaryDistanceMeters: 10 * MILE_METERS,
          samples,
        };
      })(),
    ];
    const target = syntheticCourse("Flat", 26.2, 0);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: athlete,
      athleteWeeks: weeks,
    });
    const adjustment = result.difference.paceAdjustmentSecondsPerMile;
    if (adjustment !== null) {
      expect(Math.abs(adjustment)).toBeLessThanOrEqual(60);
    }
  });

  it("produces a stable, plain-language note for a typical course", () => {
    const target = syntheticCourse("Berlin 2026", 26.2, 0.006);
    const result = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });
    const note = result.difference.note;
    expect(note.length).toBeGreaterThan(60);
    expect(note).toMatch(/Berlin 2026/);
  });

  it("discloses when elevation is DEM-backfilled rather than from the GPX", () => {
    const target = syntheticCourse("Berlin 2026", 26.2, 0.006, 0, true);
    const withDem = buildCourseComparison({
      targetSeries: [{ ...target, elevationSource: "open-elevation" }],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });
    expect(withDem.target.elevationSource).toBe("open-elevation");
    expect(withDem.difference.note).toMatch(/digital elevation model/i);

    const fromGpx = buildCourseComparison({
      targetSeries: [target],
      athleteActivities: flatAthlete(),
      athleteWeeks: weeks,
    });
    expect(fromGpx.target.elevationSource).toBe("gpx");
    expect(fromGpx.difference.note).not.toMatch(/digital elevation model/i);
  });
});

describe("gradeBands for courses (regression)", () => {
  it("classifies synthetic slopes into the expected bands", () => {
    const flat = syntheticCourse("Flat", 5, 0).points;
    expect(gradeBands(flat).find((b) => b.key === "flat")?.sharePercent).toBeGreaterThan(90);
    const up = syntheticCourse("Up", 5, 0.06).points;
    const upBands = gradeBands(up);
    const covered = upBands.reduce((sum, b) => sum + b.distanceMeters, 0);
    expect(covered).toBeGreaterThan(0);
    expect(upBands.find((b) => b.key === "steep_climbing")?.sharePercent).toBeGreaterThan(80);
    const down = syntheticCourse("Down", 5, -0.06, 2000).points;
    const downBands = gradeBands(down);
    const coveredDown = downBands.reduce((sum, b) => sum + b.distanceMeters, 0);
    expect(coveredDown).toBeGreaterThan(0);
    expect(downBands.find((b) => b.key === "steep_descending")?.sharePercent).toBeGreaterThan(80);
  });

  it("sums elevation gain to the slope length for a steady climb", () => {
    const course = syntheticCourse("Climb", 10, 0.03).points;
    const summary = courseElevationSummary(course);
    expect(summary.gainMeters).toBeCloseTo(10 * 0.03 * MILE_METERS, -1);
    expect(summary.lossMeters).toBe(0);
  });
});
