// ============================================================
// EnduroLab - Activity Quality Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  ACTIVITY_QUALITY_VERSION,
  ANALYTICS_QUALITY_THRESHOLD,
  computeActivityQualityScore,
} from "@/lib/analytics/activity-quality";
import { GarminActivitySample } from "@/lib/garmin/activity-detail";

function samples(overrides: Partial<GarminActivitySample> = {}): GarminActivitySample[] {
  const start = new Date("2026-08-04T10:30:00.000Z");
  return Array.from({ length: 1201 }, (_, elapsedSeconds) => ({
    timestamp: new Date(start.getTime() + elapsedSeconds * 1000),
    elapsedSeconds,
    distanceMeters: elapsedSeconds * 3,
    heartRate: 140,
    power: 250 + (elapsedSeconds % 3),
    speedMetersPerSecond: 3,
    elevationMeters: 10,
    grade: 0,
    cadence: 170,
    latitude: 40,
    longitude: -74,
    temperatureCelsius: 15,
    ...overrides,
  }));
}

describe("activity quality", () => {
  it("versions the formula and gives complete steady detail a high score", () => {
    expect(ACTIVITY_QUALITY_VERSION).toBe("detail-v1");
    expect(computeActivityQualityScore(samples(), 1200)).toBe(100);
  });

  it("keeps empty detail and traces without heart rate below the analytics threshold", () => {
    expect(computeActivityQualityScore([], 1200)).toBe(0);
    expect(computeActivityQualityScore(samples({ heartRate: null }), 1200))
      .toBeLessThan(ANALYTICS_QUALITY_THRESHOLD);
  });
});
