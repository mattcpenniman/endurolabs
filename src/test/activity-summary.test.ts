import { describe, expect, it } from "vitest";
import { summarizeActivitySamples } from "@/lib/analytics/activity-summary";

describe("activity analytics summaries", () => {
  it("builds deterministic 30-second windows and prepared fitness points", () => {
    const samples = Array.from({ length: 90 }, (_, elapsedSeconds) => ({
      activityId: "activity-1",
      elapsedSeconds,
      heartRate: 130 + Math.floor(elapsedSeconds / 30),
      power: 280,
      speedMetersPerSecond: 4,
      elevationMeters: 10 + elapsedSeconds / 100,
      cadence: 88,
      latitude: 51.5,
      longitude: -0.1,
    }));

    const summary = summarizeActivitySamples(samples);

    expect(summary.windows).toHaveLength(3);
    expect(summary.windows[0]).toMatchObject({
      windowStartSeconds: 0,
      sampleCount: 30,
      heartRateAverage: 130,
      powerAverage: 280,
      speedAverage: 4,
      cadenceMedian: 176,
      fitnessHeartRate: 131,
      fitnessPower: 280,
    });
    expect(summary.metrics.decoupling?.suitable).toBe(false);
    expect(summary.metrics.durability.suitable).toBe(false);
  });

  it("keeps missing sensor values nullable", () => {
    const summary = summarizeActivitySamples([{
      activityId: "activity-2",
      elapsedSeconds: 0,
      heartRate: null,
      power: null,
      speedMetersPerSecond: null,
      elevationMeters: null,
      cadence: null,
      latitude: null,
      longitude: null,
    }]);

    expect(summary.windows[0]).toMatchObject({
      heartRateAverage: null,
      powerAverage: null,
      speedAverage: null,
      cadenceMedian: null,
      fitnessHeartRate: null,
      fitnessPower: null,
    });
  });
});
