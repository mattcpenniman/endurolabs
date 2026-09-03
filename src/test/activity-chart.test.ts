import { describe, expect, it } from "vitest";
import { buildActivityChartData, downsampleActivitySamples } from "@/lib/activities/activity-chart";
import type { ActivityChartSample } from "@/lib/activities/models";

function sample(elapsedSeconds: number, speedMetersPerSecond = 3): ActivityChartSample {
  return {
    elapsedSeconds,
    heartRate: 140,
    power: 300,
    cadence: 170,
    speedMetersPerSecond,
  };
}

describe("activity chart helpers", () => {
  it("bounds chart samples while preserving both endpoints", () => {
    const samples = Array.from({ length: 5000 }, (_, index) => sample(index));
    const result = downsampleActivitySamples(samples, 1000);

    expect(result).toHaveLength(1000);
    expect(result[0].elapsedSeconds).toBe(0);
    expect(result.at(-1)?.elapsedSeconds).toBe(4999);
  });

  it("converts speed to pace and removes invalid spikes", () => {
    const result = buildActivityChartData([
      sample(0, 1609.344 / 480),
      sample(1, 0),
      sample(2, 20),
    ]);

    expect(result[0].paceMinutesPerMile).toBeCloseTo(8);
    expect(result[1].paceMinutesPerMile).toBeNull();
    expect(result[2].paceMinutesPerMile).toBeNull();
  });
});
