import { describe, expect, it } from "vitest";
import { analyzePowerAtHeartRate } from "@/lib/analytics/running-fitness";
import { ActivitySampleInput } from "@/lib/analytics/models";

function seededTrace(activityId: string, offset: number): ActivitySampleInput[] {
  return Array.from({ length: 901 }, (_, elapsedSeconds) => {
    const heartRate = 98 + 0.07 * elapsedSeconds + offset;
    const deterministicNoise = elapsedSeconds % 2 === 0 ? 7 : -7;
    return {
      activityId,
      elapsedSeconds,
      heartRate: Math.round(heartRate),
      power: Math.round(2.5 * (98 + 0.07 * (elapsedSeconds + 30) + offset) + deterministicNoise),
      speedMetersPerSecond: 3.2,
    };
  });
}

describe("seeded data smoke", () => {
  it("recovers a stable two-activity model in deterministic noise", () => {
    const model = analyzePowerAtHeartRate([
      ...seededTrace("seed-run-1", 0),
      ...seededTrace("seed-run-2", 4),
    ]);
    expect(model).not.toBeNull();
    expect(model?.activityCount).toBe(2);
    const p140 = model?.estimates.find((estimate) => estimate.heartRate === 140);
    expect(p140?.watts).toBeGreaterThan(340);
    expect(p140?.watts).toBeLessThan(360);
  });
});
