// ============================================================
// EnduroLab - Race Predictor Presentation Model
// ============================================================
// Converts the race-evidence forecast into stable API models for
// standard and custom race distances.

import {
  analyzeRacePerformance,
  buildRaceForecastWithHistoricalRange,
  buildTrainingAdjustedRaceForecast,
  type RaceAnalysisActivity,
  type RaceAnalysisLog,
  type RaceAnalysisPlan,
  type RaceBaselineSummary,
  type RaceForecastComparison,
  type RaceForecastEvidence,
  type RaceHistoricalErrorRange,
  type RaceTrainingAdjustedPrediction,
} from "./race-performance-analysis";

const METERS_PER_MILE = 1609.344;

export const STANDARD_PREDICTION_DISTANCES = [
  { key: "5k", label: "5K", distanceMeters: 5000 },
  { key: "10k", label: "10K", distanceMeters: 10_000 },
  { key: "10-mile", label: "10 Mile", distanceMeters: 10 * METERS_PER_MILE },
  { key: "half-marathon", label: "Half Marathon", distanceMeters: 21_097.5 },
  { key: "marathon", label: "Marathon", distanceMeters: 42_195 },
] as const;

/** Readiness-adjusted forecast from the bounded training effects. */
export interface RaceReadinessResult {
  modelVersion: "race-training-readiness-v1" | "race-training-readiness-v2";
  predictedSeconds: number;
  adjustmentPercent: number;
  effects: {
    volumePercent: number;
    longRunPercent: number;
    consistencyPercent: number;
    fitnessPercent: number;
  };
}

export interface RacePredictorResult {
  key: string;
  label: string;
  distanceMeters: number;
  distanceMiles: number;
  predictedSeconds: number;
  paceSecondsPerMile: number;
  range: RaceHistoricalErrorRange | null;
  evidenceCount: number;
  confidence: "limited" | "developing";
  meanMedianDisagreementPercent: number;
  strongestEvidence: RaceForecastEvidence[];
  completeEvidence: RaceForecastEvidence[];
  /** Volume + long-run + consistency readiness candidate (v1). Null when the
   *  bounded effect is zero (e.g. 5K) or no training features exist. */
  readiness?: RaceReadinessResult | null;
}

export interface RacePredictorResponse {
  asOf: string;
  modelVersion: "race-evidence-v1";
  raceCount: number;
  sourceCoverage: {
    canonicalResults: number;
    verifiedResults: number;
    garminFallbacks: number;
  };
  predictions: RacePredictorResult[];
  validation: {
    baseline: RaceBaselineSummary | null;
    forecast: RaceBaselineSummary | null;
    comparison: RaceForecastComparison | null;
  };
  disclaimer: string;
}

export interface RacePredictionDistance {
  key: string;
  label: string;
  distanceMeters: number;
}

/** Builds API-ready predictions and model validation from race history. */
export function buildRacePredictorResponse(input: {
  races: RaceAnalysisActivity[];
  /** All activities (runs + races) for training-feature effects. When absent,
   *  the readiness block is omitted and the response degrades to evidence-only. */
  activities?: RaceAnalysisActivity[];
  plans?: RaceAnalysisPlan[];
  logs?: RaceAnalysisLog[];
  asOf: string;
  distances: RacePredictionDistance[];
  sourceCoverage?: RacePredictorResponse["sourceCoverage"];
  /** When true, races completed on the as-of date are included in evidence.
   *  The /race-predictor product view sets this; backtests keep the default. */
  includeSameDay?: boolean;
}): RacePredictorResponse {
  const activities = input.activities ?? input.races;
  const predictions = input.distances.flatMap((distance): RacePredictorResult[] => {
    const forecast = buildRaceForecastWithHistoricalRange(
      input.races,
      input.asOf,
      distance.distanceMeters,
      input.includeSameDay === true,
    );
    if (!forecast) return [];
    const distanceMiles = distance.distanceMeters / METERS_PER_MILE;
    const readiness = buildReadinessResult(activities, input.races, input.asOf, distance.distanceMeters);
    return [{
      key: distance.key,
      label: distance.label,
      distanceMeters: distance.distanceMeters,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
      predictedSeconds: forecast.predictedSeconds,
      paceSecondsPerMile: Math.round(forecast.predictedSeconds / distanceMiles),
      range: forecast.historicalErrorRange,
      evidenceCount: forecast.evidence.length,
      confidence: forecast.historicalErrorRange?.confidence === "moderate" ? "developing" : "limited",
      meanMedianDisagreementPercent: forecast.meanMedianDisagreementPercent,
      strongestEvidence: forecast.evidence.slice(0, 5),
      completeEvidence: forecast.evidence,
      readiness,
    }];
  });
  const analysis = analyzeRacePerformance({
    activities,
    plans: (input.plans ?? []),
    asOf: input.asOf,
  });
  return {
    asOf: input.asOf,
    modelVersion: "race-evidence-v1",
    raceCount: analysis.dataCoverage.taggedRaces,
    sourceCoverage: input.sourceCoverage ?? {
      canonicalResults: 0,
      verifiedResults: 0,
      garminFallbacks: analysis.dataCoverage.taggedRaces,
    },
    predictions,
    validation: {
      baseline: analysis.baselineSummary,
      forecast: analysis.forecastSummary,
      comparison: analysis.forecastComparison,
    },
    disclaimer: "The 90% range reflects this athlete's prior rolling forecast errors. It is not a calibrated confidence interval and does not account for course, weather, health, or race-day execution.",
  };
}

/** Bounded training-readiness effect for one target distance. */
function buildReadinessResult(
  activities: RaceAnalysisActivity[],
  races: RaceAnalysisActivity[],
  predictionDate: string,
  targetDistanceMeters: number,
  lookbackDays = 112,
): RaceReadinessResult | null {
  const adjusted = buildTrainingAdjustedRaceForecast(
    activities,
    races,
    predictionDate,
    targetDistanceMeters,
    lookbackDays,
    0,
  );
  if (!adjusted) return null;
  const effects = adjusted.effects;
  if (
    effects.volumePercent === 0
    && effects.longRunPercent === 0
    && effects.consistencyPercent === 0
    && effects.fitnessPercent === 0
  ) return null;
  return {
    modelVersion: adjusted.modelVersion,
    predictedSeconds: adjusted.predictedSeconds,
    adjustmentPercent: adjusted.adjustmentPercent,
    effects,
  };
}
