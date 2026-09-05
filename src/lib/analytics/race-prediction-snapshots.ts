// ============================================================
// EnduroLab - Immutable Race Prediction Snapshots
// ============================================================

import { racePredictionSnapshots } from "@/lib/db/schema";
import type { LoadedRaceEvidence } from "@/lib/races/evidence";
import type { RacePredictorResult } from "./race-predictor";

export const RACE_PREDICTION_FEATURE_VERSION = "race-evidence-input-v1" as const;

export interface RacePredictionSnapshotInput {
  userId: string;
  planId: string | null;
  targetRaceResultId: string | null;
  targetDate: string;
  targetDistanceMeters: number;
  targetRaceName: string | null;
  predictionAt: Date;
  goalSeconds: number | null;
  prediction: RacePredictorResult;
  evidence: LoadedRaceEvidence;
}

/** Creates the complete insert payload separately for deterministic testing. */
export function buildRacePredictionSnapshotValues(input: RacePredictionSnapshotInput): typeof racePredictionSnapshots.$inferInsert {
  const predictionDate = input.predictionAt.toISOString().slice(0, 10);
  const forecastHorizonDays = Math.round(
    (Date.parse(`${input.targetDate}T00:00:00Z`) - Date.parse(`${predictionDate}T00:00:00Z`)) / 86_400_000,
  );
  return {
    userId: input.userId,
    planId: input.planId,
    targetRaceResultId: input.targetRaceResultId,
    targetDate: input.targetDate,
    targetDistanceMeters: input.targetDistanceMeters,
    targetRaceName: input.targetRaceName,
    predictionAt: input.predictionAt,
    forecastHorizonDays,
    predictedSeconds: input.prediction.predictedSeconds,
    range50LowerSeconds: null,
    range50UpperSeconds: null,
    range90LowerSeconds: input.prediction.range?.lowerSeconds ?? null,
    range90UpperSeconds: input.prediction.range?.upperSeconds ?? null,
    goalSeconds: input.goalSeconds,
    goalProbability: null,
    modelVersion: "race-evidence-v1",
    featureVersion: RACE_PREDICTION_FEATURE_VERSION,
    features: {
      asOf: predictionDate,
      races: input.evidence.races,
      sourceCoverage: input.evidence.sourceCoverage,
    },
    evidence: input.prediction.completeEvidence,
    drivers: input.prediction.strongestEvidence.slice(0, 3).map((item) => ({
      kind: "race-result",
      raceId: item.raceId,
      raceDate: item.raceDate,
      combinedWeight: item.combinedWeight,
    })),
    prediction: input.prediction,
    maximumSourceTimestamp: input.evidence.maximumSourceTimestamp,
    sensorCoverage: {
      measuredPower: input.evidence.sourceCoverage.measuredPowerRaces > 0,
      modeledPower: input.evidence.sourceCoverage.modeledPowerRaces > 0,
      ...input.evidence.sourceCoverage,
    },
    dataConfidence: input.prediction.confidence,
  };
}

/** Inserts a new snapshot; no update or conflict path is intentionally exposed. */
export async function insertRacePredictionSnapshot(input: RacePredictionSnapshotInput): Promise<string> {
  const { db } = await import("@/lib/db/client");
  const [snapshot] = await db.insert(racePredictionSnapshots)
    .values(buildRacePredictionSnapshotValues(input))
    .returning({ id: racePredictionSnapshots.id });
  return snapshot.id;
}
