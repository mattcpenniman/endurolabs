// ============================================================
// EnduroLab - Elevation And Grade Analytics Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  analyzeElevationAndGrade,
  ElevationGradeActivityInput,
  ElevationGradeWeekWindow,
} from "@/lib/analytics/elevation-grade";

const MILE_METERS = 1609.344;

function trace({
  activityId,
  date,
  pacing = 480, // sec/mi
  heartRate = 140,
  power = null,
  summaryDistanceMeters = MILE_METERS / pacing,
  slope = 0, // m/m — 0 = flat, positive = climb, negative = descent
  windows = 40,
  startElevation = 100,
  gps = true,
}: {
  activityId: string;
  date: string;
  pacing?: number;
  heartRate?: number;
  power?: number | null;
  summaryDistanceMeters?: number;
  slope?: number;
  windows?: number;
  startElevation?: number;
  gps?: boolean;
}): ElevationGradeActivityInput {
  const speedMetersPerSecond = MILE_METERS / pacing;
  const samples = [];
  let elev = startElevation;
  let elapsed = 0;
  for (let i = 0; i < windows; i++) {
    const dt = 10;
    const distMeters = speedMetersPerSecond * dt;
    elev += distMeters * slope;
    samples.push({
      activityId,
      elapsedSeconds: elapsed,
      heartRate,
      power,
      speedMetersPerSecond,
      elevationMeters: Math.round(elev * 100) / 100,
      latitude: gps ? 47.6 : null,
      longitude: gps ? -122.3 : null,
    });
    elapsed += dt;
  }
  return {
    activityId,
    activityStartDate: date,
    summaryDistanceMeters,
    samples,
  };
}

const weeks: ElevationGradeWeekWindow[] = [
  { weekNumber: 1, startDate: "2026-08-03", endDate: "2026-08-09" },
  { weekNumber: 2, startDate: "2026-08-10", endDate: "2026-08-16" },
  { weekNumber: 3, startDate: "2026-08-17", endDate: "2026-08-23" },
];

const threeFlat = (): ElevationGradeActivityInput[] => [
  trace({
    activityId: "a1",
    date: "2026-08-05",
    slope: 0,
    summaryDistanceMeters: 10 * MILE_METERS,
    windows: 200,
  }),
  trace({
    activityId: "a2",
    date: "2026-08-12",
    slope: 0,
    summaryDistanceMeters: 10 * MILE_METERS,
    windows: 200,
  }),
  trace({
    activityId: "a3",
    date: "2026-08-19",
    slope: 0,
    summaryDistanceMeters: 10 * MILE_METERS,
    windows: 200,
  }),
];

const threeClimb = (): ElevationGradeActivityInput[] => [
  trace({ activityId: "u1", date: "2026-08-05", slope: 0.05, power: 280, heartRate: 158, windows: 200 }),
  trace({ activityId: "u2", date: "2026-08-12", slope: 0.06, power: 290, heartRate: 160, windows: 200 }),
  trace({ activityId: "u3", date: "2026-08-19", slope: 0.05, power: 285, heartRate: 159, windows: 200 }),
];

const threeDescend = (): ElevationGradeActivityInput[] => [
  trace({ activityId: "d1", date: "2026-08-05", slope: -0.05, power: 240, heartRate: 130, windows: 200 }),
  trace({ activityId: "d2", date: "2026-08-12", slope: -0.06, power: 230, heartRate: 128, windows: 200 }),
  trace({ activityId: "d3", date: "2026-08-19", slope: -0.05, power: 235, heartRate: 129, windows: 200 }),
];

describe("analyzeElevationAndGrade", () => {
  it("splits flat / climbing / descending bands from the derived slope", () => {
    const acts = [...threeFlat(), ...threeClimb(), ...threeDescend()];
    const result = analyzeElevationAndGrade(acts, weeks, true);
    expect(result.suppressReason).toBeNull();
    expect(result.qualifyingActivities).toBe(9);
    expect(result.elevationGainFeetPerMile).not.toBeNull();
    const flat = result.bands.find((b) => b.key === "flat")!;
    const climb = result.bands.find((b) => b.key === "climbing")!;
    const descend = result.bands.find((b) => b.key === "descending")!;
    expect(flat.paceSecondsPerMile).not.toBeNull();
    expect(flat.heartRate).not.toBeNull();
    expect(flat.activityCount).toBeGreaterThanOrEqual(2);
    // climb and descend should have measurable values too
    expect(climb.paceSecondsPerMile).not.toBeNull();
    expect(climb.heartRate).not.toBeNull();
    expect(descend.paceSecondsPerMile).not.toBeNull();
    expect(descend.heartRate).not.toBeNull();
  });

  it("reports weekly elevation gain per mile", () => {
    const result = analyzeElevationAndGrade(threeClimb(), weeks, false);
    expect(result.suppressReason).toBeNull();
    expect(result.weeks.length).toBe(3);
    for (const w of result.weeks) {
      expect(w.elevationGainFeetPerMile).not.toBeNull();
      expect(w.gainFeet).toBeGreaterThan(0);
    }
  });

  it("computes total elevation gain consistent with slope × distance", () => {
    // Each run ≈ 6700 m at 5% slope ≈ 335 m gain per run × 3 ≈ 1005 m ≈ 3300 ft
    const acts = threeClimb();
    const result = analyzeElevationAndGrade(acts, weeks, false);
    const totalGain = result.weeks.reduce((sum, w) => sum + w.gainFeet, 0);
    expect(totalGain).toBeGreaterThan(2900);
    expect(totalGain).toBeLessThan(3700);
  });

  it("does not include modeled power in bands when hasMeasuredPower is false", () => {
    const result = analyzeElevationAndGrade(threeClimb(), weeks, false);
    expect(result.suppressReason).toBeNull();
    for (const band of result.bands) {
      expect(band.powerWattsMeasured).toBeNull();
    }
  });

  it("shows measured median power in bands when hasMeasuredPower is true and power is consistent", () => {
    // Give every sample the same power so the median is unambiguous.
    const acts = trace({ activityId: "a1", date: "2026-08-05", slope: 0.0, power: 250, heartRate: 140, windows: 200 });
    const acts2 = trace({ activityId: "a2", date: "2026-08-12", slope: 0.0, power: 250, heartRate: 140, windows: 200 });
    const acts3 = trace({ activityId: "a3", date: "2026-08-19", slope: 0.0, power: 250, heartRate: 140, windows: 200 });
    const result = analyzeElevationAndGrade([acts, acts2, acts3], weeks, true);
    const flat = result.bands.find((b) => b.key === "flat")!;
    expect(flat.powerWattsMeasured).toBe(250);
  });

  it("returns partial-note results when there are valid runs but fewer than three", () => {
    const result = analyzeElevationAndGrade(threeClimb().slice(0, 2), weeks, false);
    expect(result.suppressReason).toBeNull();
    expect(result.partialNote).toMatch(/at least three is preferred/);
    expect(result.qualifyingActivities).toBe(2);
    expect(result.elevationGainFeetPerMile).not.toBeNull();
  });

  it("suppresses with a diagnostic message when every run fails a gate", () => {
    const noGps = threeClimb().map((a) => ({
      ...a,
      samples: a.samples.map((s) => ({ ...s, latitude: null, longitude: null })),
    }));
    const result = analyzeElevationAndGrade(noGps, weeks, false);
    expect(result.partialNote).toBeNull();
    expect(result.suppressReason).not.toBeNull();
    expect(result.suppressReason).toMatch(/weak GPS/);
    expect(result.rejectionReasons.insufficient_gps).toBe(3);
    expect(result.totalActivities).toBe(3);
  });

  it("suppresses when there are no activities at all", () => {
    const result = analyzeElevationAndGrade([], weeks, false);
    expect(result.suppressReason).not.toBeNull();
    expect(result.totalActivities).toBe(0);
  });

  it("falls back to speed-integrated distance when summary distance is missing", () => {
    const acts = threeFlat().map((a) => ({ ...a, summaryDistanceMeters: null }));
    const result = analyzeElevationAndGrade(acts, weeks, false);
    // 200 windows × 10 s = 2000 s of time; speed = ~1.868 m/s; distance ≈ 10 mi
    expect(result.suppressReason).toBeNull();
    expect(result.distanceMiles).toBeGreaterThan(0);
    expect(result.elevationGainFeetPerMile).not.toBeNull();
  });

  it("distinguishes climb vs descent heart rate and pace", () => {
    const acts = [...threeClimb(), ...threeDescend()];
    const result = analyzeElevationAndGrade(acts, weeks, true);
    const climb = result.bands.find((b) => b.key === "climbing")!;
    const descend = result.bands.find((b) => b.key === "descending")!;
    expect(climb.paceSecondsPerMile).not.toBeNull();
    expect(descend.paceSecondsPerMile).not.toBeNull();
    expect(climb.heartRate!).toBeGreaterThan(descend.heartRate!);
  });
});
