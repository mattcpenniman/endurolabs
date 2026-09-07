// ============================================================
// EnduroLab - Race Prediction Scheduler Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { isFixedRacePredictionHorizon } from "@/lib/analytics/race-prediction-scheduler";

describe("race prediction scheduler", () => {
  it("recognizes only predeclared fixed horizons", () => {
    expect(isFixedRacePredictionHorizon("2026-07-05", "2026-09-27")).toBe(true);
    expect(isFixedRacePredictionHorizon("2026-08-30", "2026-09-27")).toBe(true);
    expect(isFixedRacePredictionHorizon("2026-09-20", "2026-09-27")).toBe(true);
    expect(isFixedRacePredictionHorizon("2026-09-26", "2026-09-27")).toBe(true);
    expect(isFixedRacePredictionHorizon("2026-09-05", "2026-09-27")).toBe(false);
  });
});
