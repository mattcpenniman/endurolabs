// ============================================================
// EnduroLab - GPS projection helpers
// ============================================================

import { describe, expect, it } from "vitest";
import type { ActivityChartSample } from "@/lib/activities/models";
import {
  projectGpsRoute,
  haversineMeters,
  nearestPointIndex,
} from "@/lib/activities/activity-map";

function gps(
  elapsedSeconds: number,
  latitude: number,
  longitude: number,
  elevationMeters?: number
): ActivityChartSample {
  return {
    elapsedSeconds,
    heartRate: 140,
    power: 250,
    cadence: 175,
    speedMetersPerSecond: 3,
    latitude,
    longitude,
    elevationMeters: elevationMeters ?? null,
  };
}

describe("haversineMeters", () => {
  it("computes a plausible distance for a ~1km move", () => {
    const meters = haversineMeters(40.7128, -74.006, 40.7189, -74.001);
    expect(meters).toBeGreaterThan(600);
    expect(meters).toBeLessThan(900);
  });

  it("returns zero for identical points", () => {
    expect(haversineMeters(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });
});

describe("projectGpsRoute", () => {
  it("projects a route inside the padded viewBox and preserves point order", () => {
    const samples = [
      gps(0, 40.7128, -74.0060),
      gps(60, 40.7145, -74.0040),
      gps(120, 40.7160, -74.0055),
      gps(180, 40.7180, -74.0020),
    ];
    const { points, width, height } = projectGpsRoute(samples, 640, 400, 26);

    expect(points).toHaveLength(samples.length);
    expect(width).toBe(640);
    expect(height).toBe(400);

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(26);
      expect(point.x).toBeLessThanOrEqual(614);
      expect(point.y).toBeGreaterThanOrEqual(26);
      expect(point.y).toBeLessThanOrEqual(374);
    }

    // North moves up in SVG coordinates (lower y).
    expect(points[3].y).toBeLessThan(points[0].y);
    expect(points[3].x).toBeGreaterThan(points[0].x);
  });

  it("returns an empty projection when there are no GPS coordinates", () => {
    const samples: ActivityChartSample[] = [
      { elapsedSeconds: 0, heartRate: 140, power: 200, cadence: 170, speedMetersPerSecond: 3 },
    ];
    const result = projectGpsRoute(samples, 640, 400);
    expect(result.points).toHaveLength(0);
  });

  it("keeps a two-point route within the bounds", () => {
    const samples = [gps(0, 40.7128, -74.0060), gps(60, 40.7228, -73.9960)];
    const { points } = projectGpsRoute(samples, 640, 400, 26);
    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(26);
      expect(point.y).toBeGreaterThanOrEqual(26);
    }
  });
});

describe("nearestPointIndex", () => {
  it("finds the index of the closest point within threshold", () => {
    const { points } = projectGpsRoute([
      gps(0, 40.7128, -74.0060),
      gps(60, 40.7145, -74.0040),
    ], 640, 400, 26);
    const target = points[1];
    expect(nearestPointIndex(points, target.x, target.y)).toBe(1);
  });

  it("returns null for an empty projection and for far-away points", () => {
    expect(nearestPointIndex([], 100, 100)).toBeNull();
    const { points } = projectGpsRoute([gps(0, 40.7128, -74.0060)], 640, 400, 26);
    expect(nearestPointIndex(points, points[0].x, points[0].y)).toBe(0);
    expect(nearestPointIndex(points, points[0].x + 500, points[0].y + 500)).toBeNull();
  });
});
