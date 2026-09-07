// ============================================================
// EnduroLab - Race Predictor Presentation Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildRacePredictorResponse,
  STANDARD_PREDICTION_DISTANCES,
} from "@/lib/analytics/race-predictor";
import type { RaceAnalysisActivity } from "@/lib/analytics/race-performance-analysis";

function race(index: number): RaceAnalysisActivity {
  return {
    id: `race-${index}`,
    localDate: `2025-${String(index + 1).padStart(2, "0")}-01`,
    distanceMeters: index % 2 === 0 ? 10_000 : 21_097.5,
    durationSeconds: index % 2 === 0 ? 2500 + index * 10 : 5500 + index * 20,
    movingDurationSeconds: null,
    eventType: "race",
    averageHeartRate: 170,
    averagePower: null,
    calculatedPower: null,
    elevationGainMeters: 100,
    excludedFromAnalytics: false,
  };
}

describe("race predictor response", () => {
  it("builds standard-distance predictions with a 90% historical range", () => {
    const response = buildRacePredictorResponse({
      races: Array.from({ length: 8 }, (_, index) => race(index)),
      asOf: "2026-01-01",
      distances: [...STANDARD_PREDICTION_DISTANCES],
    });

    expect(response.predictions.map((prediction) => prediction.key)).toEqual([
      "5k",
      "10k",
      "10-mile",
      "half-marathon",
      "marathon",
    ]);
    expect(response.predictions[4].range).toMatchObject({
      label: "90% historical-error range",
      coveragePercent: 90,
      errorObservations: 7,
      confidence: "low",
    });
    expect(response.validation.forecast?.comparisons).toBe(7);
    expect(response.predictions[4].completeEvidence).toHaveLength(8);
    expect(response.sourceCoverage).toEqual({
      canonicalResults: 0,
      verifiedResults: 0,
      garminFallbacks: 8,
    });
    expect(response.disclaimer).toContain("not a calibrated confidence interval");
  });

  it("calculates pace and labels for a custom distance", () => {
    const response = buildRacePredictorResponse({
      races: Array.from({ length: 3 }, (_, index) => race(index)),
      asOf: "2026-01-01",
      distances: [{ key: "custom", label: "8 Mile Custom", distanceMeters: 8 * 1609.344 }],
    });
    const prediction = response.predictions[0];

    expect(prediction.label).toBe("8 Mile Custom");
    expect(prediction.distanceMeters).toBe(8 * 1609.344);
    expect(prediction.distanceMiles).toBe(8);
    expect(prediction.paceSecondsPerMile).toBe(Math.round(prediction.predictedSeconds / 8));
  });
});
