// ============================================================
// EnduroLab - GPX Parsing Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildCoursePoints,
  courseElevationSummary,
  gradeBands,
  parseGPXTrkpoints,
  resampleProfile,
} from "@/lib/courses/gpx";

const SELF_CLOSING_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Test</name>
    <trkseg>
      <trkpt lat="52.5200" lon="13.4050"><ele>34.0</ele></trkpt>
      <trkpt lat="52.5210" lon="13.4060"><ele>35.0</ele></trkpt>
      <trkpt lat="52.5220" lon="13.4070"><ele>36.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const NON_SELF_CLOSING_GPX = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="47.60621" lon="-122.33207"><ele>12.5</ele><time>2026-09-01T08:00:00Z</time></trkpt>
      <trkpt lat="47.60625" lon="-122.33210"><ele>12.6</ele></trkpt>
      <trkpt lat="47.60630" lon="-122.33215"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const NAMED_SPACE_GPX = `<gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <gpx:trkpt lat="10.0" lon="20.0"><ele>5.0</ele></gpx:trkpt>
    <gpx:trkpt lat="10.001" lon="20.001"><ele>6.0</ele></gpx:trkpt>
  </trkseg></trk>
</gpx>`;

const NEGATIVE_COORDS = `<gpx><trk><trkseg>
  <trkpt lat="-45.6" lon="-170.2"><ele>-3.0</ele></trkpt>
  <trkpt lat="-45.599" lon="-170.199"><ele>-2.8</ele></trkpt>
</trkseg></trk></gpx>`;

describe("parseGPXTrkpoints", () => {
  it("parses self-closing and nested trkpt elements", () => {
    const points = parseGPXTrkpoints(SELF_CLOSING_GPX);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ latitude: 52.52, longitude: 13.405, elevationMeters: 34 });
    expect(points[2]).toMatchObject({ latitude: 52.522, longitude: 13.407, elevationMeters: 36 });
  });

  it("parses non-self-closing trkpt with <ele> child before </trkpt>", () => {
    const points = parseGPXTrkpoints(NON_SELF_CLOSING_GPX);
    expect(points).toHaveLength(3);
    expect(points[0]?.elevationMeters).toBe(12.5);
    expect(points[1]?.elevationMeters).toBe(12.6);
  });

  it("supports a namespaced <gpx:trkpt> variant", () => {
    const points = parseGPXTrkpoints(NAMED_SPACE_GPX);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ latitude: 10.0, longitude: 20.0, elevationMeters: 5 });
  });

  it("handles negative lat/lon/elevation values", () => {
    const points = parseGPXTrkpoints(NEGATIVE_COORDS);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      latitude: -45.6,
      longitude: -170.2,
      elevationMeters: -3,
    });
  });

  it("returns an empty array for a file with no trkpt", () => {
    expect(parseGPXTrkpoints("<gpx><wpt/></gpx>")).toEqual([]);
    expect(parseGPXTrkpoints("not xml at all")).toEqual([]);
  });

  it("skips trkpt with non-numeric coordinates", () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lat="abc" lon="def"></trkpt>
      <trkpt lat="51.5" lon="-0.1"><ele>10</ele></trkpt>
    </trkseg></trk></gpx>`;
    const points = parseGPXTrkpoints(xml);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ latitude: 51.5, longitude: -0.1 });
  });
});

describe("buildCoursePoints / courseElevationSummary", () => {
  it("computes cumulative distance from lat/lon deltas", () => {
    const points = buildCoursePoints(parseGPXTrkpoints(SELF_CLOSING_GPX));
    expect(points).toHaveLength(3);
    expect(points[0]?.cumulativeMeters).toBe(0);
    expect(points[1]?.cumulativeMeters).toBeGreaterThan(0);
    expect(points[2]?.cumulativeMeters).toBeGreaterThan(points[1]!.cumulativeMeters);
  });

  it("aggregates gain, loss, and net elevation", () => {
    const points = buildCoursePoints(parseGPXTrkpoints(SELF_CLOSING_GPX));
    const summary = courseElevationSummary(points);
    expect(summary.gainMeters).toBeCloseTo(2, 5);
    expect(summary.lossMeters).toBe(0);
    expect(summary.netMeters).toBeCloseTo(2, 5);
    expect(summary.elevationCoverage).toBe(1);
  });

  it("bridges a mid-track missing elevation point", () => {
    const points = buildCoursePoints([
      { latitude: 10, longitude: 20, elevationMeters: 100 },
      { latitude: 10.001, longitude: 20.001, elevationMeters: null },
      { latitude: 10.002, longitude: 20.002, elevationMeters: 105 },
    ]);
    const summary = courseElevationSummary(points);
    expect(summary.elevationCoverage).toBeCloseTo(2 / 3, 5);
    // The gap is bridged: the elevation at both ends is used.
    expect(summary.gainMeters).toBeCloseTo(5, 5);
    expect(summary.netMeters).toBeCloseTo(5, 5);
    expect(summary.lossMeters).toBe(0);
  });

  it("skips points that have no elevation data adjacent to nulls only", () => {
    const points = buildCoursePoints([
      { latitude: 10, longitude: 20, elevationMeters: null },
      { latitude: 10.001, longitude: 20.001, elevationMeters: null },
      { latitude: 10.002, longitude: 20.002, elevationMeters: null },
    ]);
    const summary = courseElevationSummary(points);
    expect(summary.elevationCoverage).toBe(0);
    expect(summary.gainMeters).toBe(0);
    expect(summary.lossMeters).toBe(0);
    expect(summary.netMeters).toBe(0);
  });
});

describe("gradeBands", () => {
  it("assigns points to grade bands using consecutive Δelevation/Δdistance", () => {
    const points = buildCoursePoints([
      { latitude: 10, longitude: 20, elevationMeters: 0 },
      { latitude: 10.0011, longitude: 20.0011, elevationMeters: 10 },
      { latitude: 10.0022, longitude: 20.0022, elevationMeters: 12 },
      { latitude: 10.0033, longitude: 20.0033, elevationMeters: 0 },
      { latitude: 10.0044, longitude: 20.0044, elevationMeters: -2 },
      { latitude: 10.0055, longitude: 20.0055, elevationMeters: 3.048 },
    ]);
    const bands = gradeBands(points);
    const flat = bands.find((b) => b.key === "flat");
    const climbing = bands.find((b) => b.key === "climbing");
    const steepClimbing = bands.find((b) => b.key === "steep_climbing");
    const descending = bands.find((b) => b.key === "descending");
    const steepDescending = bands.find((b) => b.key === "steep_descending");

    expect(climbing?.distanceMeters).toBeGreaterThan(0);
    expect(steepClimbing?.distanceMeters).toBeGreaterThan(0);
    expect(steepDescending?.distanceMeters).toBeGreaterThan(0);
    expect(descending?.distanceMeters).toBe(0);
    const covered = bands.reduce((sum, b) => sum + b.distanceMeters, 0);
    expect(covered).toBeGreaterThan(0);
    // Shares sum to approximately 100% across the covered bands.
    expect(bands.reduce((sum, b) => sum + b.sharePercent, 0)).toBeGreaterThan(95);
  });

  it("returns zero distances when elevation is not present", () => {
    const points = buildCoursePoints([
      { latitude: 10, longitude: 20, elevationMeters: null },
      { latitude: 10.01, longitude: 20.01, elevationMeters: null },
    ]);
    const bands = gradeBands(points);
    expect(bands.every((band) => band.distanceMeters === 0 && band.sharePercent === 0)).toBe(true);
  });
});

describe("resampleProfile", () => {
  it("interpolates elevation on evenly spaced axes", () => {
    const profile = [
      { distanceMeters: 0, elevationMeters: 100 },
      { distanceMeters: 1000, elevationMeters: 110 },
      { distanceMeters: 2000, elevationMeters: 105 },
    ];
    const samples = resampleProfile(profile, [0, 500, 1000, 1500, 2000, 2500]);
    expect(samples[0]?.elevationMeters).toBe(100);
    expect(samples[1]?.elevationMeters).toBeCloseTo(105, 5);
    expect(samples[2]?.elevationMeters).toBeCloseTo(110, 5);
    expect(samples[3]?.elevationMeters).toBeCloseTo(107.5, 5);
    expect(samples[4]?.elevationMeters).toBeCloseTo(105, 5);
    expect(samples[5]?.elevationMeters).toBe(105);
  });

  it("yields nulls beyond the known elevation range", () => {
    const profile = [
      { distanceMeters: 0, elevationMeters: 0 },
      { distanceMeters: 1000, elevationMeters: null },
      { distanceMeters: 2000, elevationMeters: 5 },
    ];
    const samples = resampleProfile(profile, [500, 1500]);
    expect(samples[0]?.elevationMeters).toBeNull();
    expect(samples[1]?.elevationMeters).toBeNull();
  });

  it("handles an empty source profile by returning nulls at every sample", () => {
    const samples = resampleProfile([], [0, 100, 200]);
    expect(samples.every((s) => s.elevationMeters === null)).toBe(true);
  });
});
