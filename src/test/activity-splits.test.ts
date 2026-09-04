import { describe, expect, it } from "vitest";
import { buildActivityMileSplits } from "@/lib/activities/activity-splits";
import type { ActivityChartSample } from "@/lib/activities/models";

const METERS_PER_MILE = 1609.344;

function sample(
  elapsedSeconds: number,
  speedMetersPerSecond: number | null,
  overrides: Partial<ActivityChartSample> = {},
): ActivityChartSample {
  return {
    elapsedSeconds,
    speedMetersPerSecond,
    heartRate: 140,
    power: 300,
    cadence: 85,
    elevationMeters: 100 + elapsedSeconds / 100,
    temperatureCelsius: 12,
    ...overrides,
  };
}

describe("recorded activity mile splits", () => {
  it("builds full and partial splits reconciled to summary distance", () => {
    const samples = Array.from({ length: 21 }, (_, index) => sample(index * 60, 3));
    const result = buildActivityMileSplits({
      summaryDistanceMeters: METERS_PER_MILE * 2.25,
      durationSeconds: 1200,
      hasMeasuredPower: true,
      samples,
    });

    expect(result).toHaveLength(3);
    expect(result[0].distanceMiles).toBeCloseTo(1);
    expect(result[1].distanceMiles).toBeCloseTo(1);
    expect(result[2].distanceMiles).toBeCloseTo(0.25);
    expect(result.reduce((sum, split) => sum + split.durationSeconds, 0)).toBeCloseTo(1200);
    expect(result[0].averageHeartRate).toBeCloseTo(140);
    expect(result[0].averagePower).toBeCloseTo(300);
    expect(result[0].averageCadence).toBeCloseTo(170);
    expect(result[2].elapsedSeconds).toBe(1200);
  });

  it("includes stopped time in the split containing the pause", () => {
    const result = buildActivityMileSplits({
      summaryDistanceMeters: METERS_PER_MILE * 2,
      durationSeconds: 1080,
      hasMeasuredPower: true,
      samples: [
        sample(0, 4),
        sample(200, 4),
        sample(320, 0),
        sample(480, 0),
        sample(1080, 4),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0].durationSeconds).toBeGreaterThan(480);
    expect(result[0].durationSeconds + result[1].durationSeconds).toBeCloseTo(1080);
  });

  it("does not expose modeled power as measured split power", () => {
    const result = buildActivityMileSplits({
      summaryDistanceMeters: METERS_PER_MILE,
      durationSeconds: 480,
      hasMeasuredPower: false,
      samples: [sample(0, 3.5), sample(480, 3.5)],
    });

    expect(result[0].averagePower).toBeNull();
  });

  it("returns no splits without usable speed", () => {
    const result = buildActivityMileSplits({
      summaryDistanceMeters: METERS_PER_MILE,
      durationSeconds: 480,
      hasMeasuredPower: true,
      samples: [sample(0, null), sample(480, null)],
    });

    expect(result).toEqual([]);
  });
});
