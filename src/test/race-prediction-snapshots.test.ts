// ============================================================
// EnduroLab - Race Prediction Snapshot Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { buildRacePredictionSnapshotValues } from "@/lib/analytics/race-prediction-snapshots";
import type { RacePredictorResult } from "@/lib/analytics/race-predictor";

describe("race prediction snapshots", () => {
  it("freezes complete evidence, cutoff, range, and provenance", () => {
    const forecastEvidence = [{
      raceId: "official-result",
      raceDate: "2026-08-01",
      distanceLabel: "10K",
      distanceMeters: 10_000,
      actualSeconds: 2400,
      equivalentSeconds: 11_000,
      ageDays: 35,
      recencyWeight: 0.9,
      distanceWeight: 0.5,
      sameDistanceMultiplier: 1,
      combinedWeight: 0.45,
    }];
    const prediction: RacePredictorResult = {
      key: "marathon",
      label: "Marathon",
      distanceMeters: 42_195,
      distanceMiles: 26.22,
      predictedSeconds: 11_000,
      paceSecondsPerMile: 420,
      range: {
        label: "90% historical-error range",
        coveragePercent: 90,
        lowerSeconds: 10_500,
        upperSeconds: 11_700,
        errorObservations: 8,
        confidence: "low",
      },
      evidenceCount: 1,
      confidence: "limited",
      meanMedianDisagreementPercent: 1,
      strongestEvidence: forecastEvidence,
      completeEvidence: forecastEvidence,
    };
    const maximumSourceTimestamp = new Date("2026-09-04T18:00:00Z");
    const values = buildRacePredictionSnapshotValues({
      userId: "user-id",
      planId: null,
      targetRaceResultId: null,
      targetDate: "2026-10-04",
      targetDistanceMeters: 42_195,
      targetRaceName: "City Marathon",
      predictionAt: new Date("2026-09-05T12:00:00Z"),
      goalSeconds: 10_800,
      prediction,
      evidence: {
        races: [],
        trainingActivities: [],
        maximumSourceTimestamp,
        sourceCoverage: {
          canonicalResults: 1,
          verifiedResults: 1,
          garminFallbacks: 0,
          measuredPowerRaces: 0,
          modeledPowerRaces: 0,
        },
      },
    });

    expect(values.forecastHorizonDays).toBe(29);
    expect(values.range90LowerSeconds).toBe(10_500);
    expect(values.maximumSourceTimestamp).toBe(maximumSourceTimestamp);
    expect(values.evidence).toEqual(forecastEvidence);
    expect(values.modelVersion).toBe("race-evidence-v1");
    expect(values.featureVersion).toBe("race-evidence-input-v1");
    expect(values.goalProbability).toBeNull();
  });
});
