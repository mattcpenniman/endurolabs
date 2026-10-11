import { describe, expect, it } from "vitest";
import { buildActivityMileSplits, buildActivitySplitOptions, buildActivitySplits, type ActivitySplitLength } from "@/lib/activities/activity-splits";
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
  it.each<{ length: ActivitySplitLength; meters: number }>([
    { length: "mile", meters: METERS_PER_MILE },
    { length: "kilometer", meters: 1000 },
    { length: "half_mile", meters: METERS_PER_MILE / 2 },
    { length: "quarter_mile", meters: METERS_PER_MILE / 4 },
  ])("preserves distance, time and weighted metrics at $length boundaries", ({ length, meters }) => {
    const result = buildActivitySplits({
      summaryDistanceMeters: meters * 2.3,
      durationSeconds: 1200,
      hasMeasuredPower: true,
      splitLength: length,
      samples: Array.from({ length: 21 }, (_, index) => sample(index * 60, 3, {
        heartRate: 120 + index * 2,
        power: 250 + index * 5,
      })),
    });
    expect(result).toHaveLength(3);
    expect(result[0].distanceMiles * METERS_PER_MILE).toBeCloseTo(meters);
    expect(result[2].distanceMiles * METERS_PER_MILE).toBeCloseTo(meters * 0.3);
    expect(result.reduce((sum, split) => sum + split.distanceMiles * METERS_PER_MILE, 0)).toBeCloseTo(meters * 2.3);
    expect(result.reduce((sum, split) => sum + split.durationSeconds, 0)).toBeCloseTo(1200);
    expect(result.reduce((sum, split) => sum + split.averageHeartRate! * split.durationSeconds, 0) / 1200).toBeCloseTo(140);
    expect(result.reduce((sum, split) => sum + split.averagePower! * split.durationSeconds, 0) / 1200).toBeCloseTo(300);
    expect(result.reduce((sum, split) => sum + split.elevationGainMeters, 0)).toBeCloseTo(12);
    expect(result[2].elapsedSeconds).toBe(1200);
  });

  it("provides all display lengths with exact boundaries and no extra partial split", () => {
    const options = buildActivitySplitOptions({
      summaryDistanceMeters: METERS_PER_MILE * 2,
      durationSeconds: 960,
      hasMeasuredPower: false,
      samples: [sample(0, 3.5), sample(960, 3.5)],
    });
    expect(options.mile).toHaveLength(2);
    expect(options.kilometer).toHaveLength(4);
    expect(options.half_mile).toHaveLength(4);
    expect(options.quarter_mile).toHaveLength(8);
    for (const splits of Object.values(options)) {
      expect(splits.every((split) => split.distanceMiles > 0 && split.averagePower === null)).toBe(true);
    }
  });

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
