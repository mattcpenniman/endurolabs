// ============================================================
// EnduroLab - Race Performance Analysis
// ============================================================
// Builds leakage-aware, pre-race feature rows and evaluates a
// transparent race-equivalence baseline. It does not fit a model.

import { classifyRaceDistance } from "../activities/race-comparison";

const METERS_PER_MILE = 1609.344;
const DAY_MS = 86_400_000;
const RIEGEL_EXPONENT = 1.06;
const FORECAST_SOURCE_MIN_METERS = 4500;
const FORECAST_SOURCE_MAX_METERS = 44_500;
const FORECAST_MAX_SOURCE_AGE_DAYS = 5 * 365;
const FORECAST_RECENCY_HALF_LIFE_DAYS = 180;
const FORECAST_DISTANCE_DECAY = 1.5;
const FORECAST_SAME_DISTANCE_TOLERANCE = 0.03;
const FORECAST_SAME_DISTANCE_MULTIPLIER = 1.5;
// Fitness effect is a fixed, unfitted sensitivity: per 1 W of Power@140
// difference (target vs. reference) we shift the finish-time prediction by
// 0.15%. It is clamped to ±50 W so a noisy trajectory cannot move a
// prediction by more than ±7.5%, and it decays with horizon like the other
// readiness effects. Not fitted to any athlete.
const FITNESS_SENSITIVITY_PER_WATT = 0.0015;
const FITNESS_DELTA_WATTS_CAP = 50;
const FITNESS_INTERPOLATION_MAX_DAYS = 14;

export interface RaceAnalysisActivity {
  id: string;
  localDate: string;
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  eventType: string | null;
  averageHeartRate: number | null;
  averagePower: number | null;
  calculatedPower: number | null;
  elevationGainMeters: number | null;
  excludedFromAnalytics: boolean;
  trainingExcluded?: boolean;
  resultSource?: "canonical" | "garmin";
  verificationStatus?: "unverified" | "self-reported" | "verified" | null;
}

export interface RaceAnalysisPlanRun {
  date: string;
  miles: number;
  workoutType: string;
}

export interface RaceAnalysisLog {
  date: string;
  completed: boolean;
  actualMiles: number;
  loggedAt: string;
  isAdditionalRun?: boolean;
}

export interface RaceAnalysisPlan {
  id: string;
  raceName: string | null;
  raceDate: string;
  raceDistanceMeters: number;
  goalSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  plannedRuns: RaceAnalysisPlanRun[];
  logs: RaceAnalysisLog[];
}

export interface RaceTrainingFeatures {
  lookbackDays: number;
  runs: number;
  miles: number;
  milesLast7Days: number;
  milesLast28Days: number;
  milesLast56Days: number;
  milesLast84Days: number;
  milesLast112Days: number;
  durationHoursLast7Days: number;
  durationHoursLast28Days: number;
  durationHoursLast56Days: number;
  durationHoursLast84Days: number;
  durationHoursLast112Days: number;
  activeWeeks: number;
  missingWeeks: number;
  averageWeeklyMiles: number;
  peakWeeklyMiles: number;
  weeklyMileageCoefficientOfVariation: number | null;
  runFrequencyPerWeek: number;
  longestTrainingGapDays: number;
  longestRunMiles: number;
  longestRunMilesLast28Days: number;
  longestRunMilesLast56Days: number;
  longestRunMilesLast112Days: number;
  runsAtLeast12Miles: number;
  runsAtLeast14Miles: number;
  runsAtLeast16Miles: number;
  runsAtLeast18Miles: number;
  runsAtLeast20Miles: number;
  longestRunDurationHours: number;
  longestRunSharePercent: number;
  taperRatio7ToPrior28: number | null;
  taperRatio14ToPrior42: number | null;
  elevationGainMeters: number;
  averageHeartRate: number | null;
  measuredPowerRuns: number;
  calculatedPowerRuns: number;
}

export interface RaceTrainingReference {
  weeklyMiles56Days: number;
  longestRunMiles: number;
  activeWeekShare: number;
}

/**
 * A measured or modeled Power @ 140 observation at a specific date.
 * `measured` false means the value came from the athlete-specific
 * speed-to-power model applied to stored speed samples — it must never be
 * presented as sensor power, and fitness effects built from it stay bounded
 * and clearly labeled.
 */
export interface RaceFitnessObservation {
  date: string;        // YYYY-MM-DD (activity start date)
  watts: number;       // Power @ 140 in watts
  measured: boolean;   // true = measured sensor power, false = modeled from speed
}

export interface RaceTrainingAdjustedPrediction {
  modelVersion: "race-training-readiness-v1" | "race-training-readiness-v2";
  baseForecast: RaceForecastPrediction;
  predictedSeconds: number;
  adjustmentFactor: number;
  adjustmentPercent: number;
  forecastHorizonDays: number;
  readinessRelevance: number;
  targetTraining: RaceTrainingFeatures;
  referenceTraining: RaceTrainingReference;
  effects: {
    volumePercent: number;
    longRunPercent: number;
    consistencyPercent: number;
    fitnessPercent: number;
  };
  fitness: {
    targetWatts: number | null;
    referenceWatts: number | null;
    deltaWatts: number | null;
    measured: boolean | null;   // false when the delta relies on modeled power
  } | null;
  historicalErrorRange: RaceHistoricalErrorRange | null;
}

export interface RacePlanFeatures {
  planId: string;
  scheduledRuns: number;
  scheduledMiles: number;
  scheduledSpecificMiles: number;
  loggedRuns: number;
  completedRuns: number;
  loggedMiles: number;
  workoutCompletionPercent: number | null;
  loggedMileageAdherencePercent: number | null;
  mutableAfterPrediction: boolean;
}

export interface RaceBaselinePrediction {
  sourceRaceId: string;
  sourceRaceDate: string;
  sourceDistanceLabel: string;
  sourceDistanceMeters: number;
  predictedSeconds: number;
  daysSinceSourceRace: number;
}

export interface RaceForecastEvidence {
  raceId: string;
  raceDate: string;
  distanceLabel: string;
  distanceMeters: number;
  actualSeconds: number;
  equivalentSeconds: number;
  ageDays: number;
  recencyWeight: number;
  distanceWeight: number;
  sameDistanceMultiplier: number;
  combinedWeight: number;
  resultSource?: "canonical" | "garmin";
  verificationStatus?: "unverified" | "self-reported" | "verified" | null;
}

export interface RaceHistoricalErrorRange {
  label: "90% historical-error range";
  coveragePercent: 90;
  lowerSeconds: number;
  upperSeconds: number;
  errorObservations: number;
  confidence: "low" | "moderate";
}

export interface RaceForecastPrediction {
  modelVersion: "race-evidence-v1";
  predictedSeconds: number;
  weightedMeanSeconds: number;
  meanMedianDisagreementPercent: number;
  evidence: RaceForecastEvidence[];
  historicalErrorRange: RaceHistoricalErrorRange | null;
}

export interface HistoricalRaceAnalysisRow {
  raceId: string;
  raceDate: string;
  distanceLabel: string;
  distanceMeters: number;
  actualSeconds: number;
  baseline: RaceBaselinePrediction | null;
  errorSeconds: number | null;
  absoluteErrorPercent: number | null;
  forecast: RaceForecastPrediction | null;
  forecastErrorSeconds: number | null;
  forecastAbsoluteErrorPercent: number | null;
  trainingAdjustedForecast: RaceTrainingAdjustedPrediction | null;
  trainingAdjustedErrorSeconds: number | null;
  trainingAdjustedAbsoluteErrorPercent: number | null;
  training: RaceTrainingFeatures;
  plan: RacePlanFeatures | null;
}

export interface PlanTargetAnalysisRow {
  planId: string;
  raceName: string | null;
  raceDate: string;
  predictionDate: string;
  distanceLabel: string;
  distanceMeters: number;
  goalSeconds: number | null;
  baseline: RaceBaselinePrediction | null;
  goalDeltaSeconds: number | null;
  forecast: RaceForecastPrediction | null;
  forecastGoalDeltaSeconds: number | null;
  trainingAdjustedForecast: RaceTrainingAdjustedPrediction | null;
  trainingAdjustedGoalDeltaSeconds: number | null;
  training: RaceTrainingFeatures;
  plan: RacePlanFeatures;
}

export interface RaceBaselineSummary {
  comparisons: number;
  meanAbsoluteErrorSeconds: number;
  meanAbsoluteErrorPercent: number;
  rootMeanSquaredErrorSeconds: number;
  biasSeconds: number;
  medianAbsoluteErrorPercent: number;
  maxAbsoluteErrorPercent: number;
}

export interface RaceForecastComparison {
  commonComparisons: number;
  forecastWins: number;
  ties: number;
  baselineWins: number;
  forecastImprovedMedianAbsoluteError: boolean;
}

export interface RaceCandidateComparison {
  commonComparisons: number;
  candidateWins: number;
  ties: number;
  baseWins: number;
  candidateImprovedMae: boolean;
  candidateImprovedMedianAbsoluteError: boolean;
}

export interface RaceHorizonEvaluation {
  horizonDays: 7 | 28 | 84;
  base: RaceBaselineSummary | null;
  candidate: RaceBaselineSummary | null;
  comparison: RaceCandidateComparison | null;
  marathonBase: RaceBaselineSummary | null;
  marathonCandidate: RaceBaselineSummary | null;
}

export interface RacePerformanceAnalysis {
  algorithmVersion: "race-analysis-v3";
  asOf: string;
  dataCoverage: {
    activities: number;
    taggedRaces: number;
    plans: number;
    measuredPowerActivities: number;
    calculatedPowerActivities: number;
    fitnessObservations: number;
    measuredFitnessObservations: number;
  };
  baselineSummary: RaceBaselineSummary | null;
  forecastSummary: RaceBaselineSummary | null;
  forecastComparison: RaceForecastComparison | null;
  trainingAdjustedSummary: RaceBaselineSummary | null;
  trainingAdjustedComparison: RaceCandidateComparison | null;
  horizonEvaluations: RaceHorizonEvaluation[];
  historicalRaces: HistoricalRaceAnalysisRow[];
  planTargets: PlanTargetAnalysisRow[];
  warnings: string[];
}

function dateMillis(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((dateMillis(later) - dateMillis(earlier)) / DAY_MS);
}

function subtractDays(value: string, days: number): string {
  return new Date(dateMillis(value) - days * DAY_MS).toISOString().slice(0, 10);
}

function miles(meters: number): number {
  return meters / METERS_PER_MILE;
}

function rounded(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function distanceWeightedAverage(
  activities: RaceAnalysisActivity[],
  pick: (activity: RaceAnalysisActivity) => number | null,
): number | null {
  const eligible = activities.filter((activity) => pick(activity) !== null && activity.distanceMeters > 0);
  const totalDistance = eligible.reduce((sum, activity) => sum + activity.distanceMeters, 0);
  if (totalDistance === 0) return null;
  return eligible.reduce(
    (sum, activity) => sum + (pick(activity) as number) * activity.distanceMeters,
    0,
  ) / totalDistance;
}

/** Converts a result to another distance with the standard Riegel formula. */
export function predictEquivalentRaceSeconds(
  sourceSeconds: number,
  sourceDistanceMeters: number,
  targetDistanceMeters: number,
): number {
  if (sourceSeconds <= 0 || sourceDistanceMeters <= 0 || targetDistanceMeters <= 0) {
    throw new Error("Race durations and distances must be positive");
  }
  return sourceSeconds * (targetDistanceMeters / sourceDistanceMeters) ** RIEGEL_EXPONENT;
}

function latestPriorRace(
  races: RaceAnalysisActivity[],
  beforeDate: string,
): RaceAnalysisActivity | null {
  return races
    .filter((race) => race.localDate < beforeDate && race.distanceMeters >= 3000 && race.durationSeconds > 0)
    .sort((left, right) => right.localDate.localeCompare(left.localDate))[0] ?? null;
}

function baselineFor(
  races: RaceAnalysisActivity[],
  predictionDate: string,
  targetDistanceMeters: number,
): RaceBaselinePrediction | null {
  const source = latestPriorRace(races, predictionDate);
  if (!source) return null;
  return {
    sourceRaceId: source.id,
    sourceRaceDate: source.localDate,
    sourceDistanceLabel: classifyRaceDistance(miles(source.distanceMeters)).label,
    sourceDistanceMeters: source.distanceMeters,
    predictedSeconds: Math.round(predictEquivalentRaceSeconds(
      source.durationSeconds,
      source.distanceMeters,
      targetDistanceMeters,
    )),
    daysSinceSourceRace: daysBetween(source.localDate, predictionDate),
  };
}

function weightedMedian(evidence: RaceForecastEvidence[]): number {
  const ordered = [...evidence].sort((left, right) => left.equivalentSeconds - right.equivalentSeconds);
  const midpoint = ordered.reduce((sum, item) => sum + item.combinedWeight, 0) / 2;
  let cumulative = 0;
  for (const item of ordered) {
    cumulative += item.combinedWeight;
    if (cumulative >= midpoint) return item.equivalentSeconds;
  }
  return ordered.at(-1)?.equivalentSeconds ?? 0;
}

/** Combines prior race equivalents with fixed recency and distance-relevance weights. */
export function buildRaceForecast(
  races: RaceAnalysisActivity[],
  predictionDate: string,
  targetDistanceMeters: number,
  includeSameDay = false,
): RaceForecastPrediction | null {
  const dateFilter = (raceDate: string): boolean =>
    includeSameDay ? raceDate <= predictionDate : raceDate < predictionDate;
  const evidence = races
    .filter((race) => {
      const ageDays = daysBetween(race.localDate, predictionDate);
      return dateFilter(race.localDate)
        && race.eventType === "race"
        && !race.excludedFromAnalytics
        && race.distanceMeters >= FORECAST_SOURCE_MIN_METERS
        && race.distanceMeters <= FORECAST_SOURCE_MAX_METERS
        && race.durationSeconds > 0
        && ageDays <= FORECAST_MAX_SOURCE_AGE_DAYS;
    })
    .map((race): RaceForecastEvidence => {
      const ageDays = daysBetween(race.localDate, predictionDate);
      const distanceRatio = race.distanceMeters / targetDistanceMeters;
      const recencyWeight = 2 ** (-ageDays / FORECAST_RECENCY_HALF_LIFE_DAYS);
      const distanceWeight = Math.exp(-FORECAST_DISTANCE_DECAY * Math.abs(Math.log(distanceRatio)));
      const sameDistanceMultiplier = Math.abs(distanceRatio - 1) <= FORECAST_SAME_DISTANCE_TOLERANCE
        ? FORECAST_SAME_DISTANCE_MULTIPLIER
        : 1;
      return {
        raceId: race.id,
        raceDate: race.localDate,
        distanceLabel: classifyRaceDistance(miles(race.distanceMeters)).label,
        distanceMeters: race.distanceMeters,
        actualSeconds: race.durationSeconds,
        equivalentSeconds: Math.round(predictEquivalentRaceSeconds(
          race.durationSeconds,
          race.distanceMeters,
          targetDistanceMeters,
        )),
        ageDays,
        recencyWeight: rounded(recencyWeight, 4),
        distanceWeight: rounded(distanceWeight, 4),
        sameDistanceMultiplier,
        combinedWeight: rounded(recencyWeight * distanceWeight * sameDistanceMultiplier, 8),
        resultSource: race.resultSource ?? "garmin",
        verificationStatus: race.verificationStatus ?? null,
      };
    });
  if (evidence.length === 0) return null;

  const totalWeight = evidence.reduce((sum, item) => sum + item.combinedWeight, 0);
  const predictedSeconds = Math.round(weightedMedian(evidence));
  const weightedMeanSeconds = Math.round(evidence.reduce(
    (sum, item) => sum + item.equivalentSeconds * item.combinedWeight,
    0,
  ) / totalWeight);
  return {
    modelVersion: "race-evidence-v1",
    predictedSeconds,
    weightedMeanSeconds,
    meanMedianDisagreementPercent: rounded(
      Math.abs(weightedMeanSeconds - predictedSeconds) / predictedSeconds * 100,
      2,
    ),
    evidence: evidence.sort((left, right) => right.combinedWeight - left.combinedWeight),
    historicalErrorRange: null,
  };
}

function quantile(values: number[], probability: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(probability * ordered.length) - 1);
  return ordered[index];
}

function addHistoricalErrorRange(
  forecast: RaceForecastPrediction | null,
  priorLogErrors: number[],
): RaceForecastPrediction | null {
  if (!forecast || priorLogErrors.length < 5) return forecast;
  return {
    ...forecast,
    historicalErrorRange: {
      label: "90% historical-error range",
      coveragePercent: 90,
      lowerSeconds: Math.round(forecast.predictedSeconds * Math.exp(quantile(priorLogErrors, 0.05))),
      upperSeconds: Math.round(forecast.predictedSeconds * Math.exp(quantile(priorLogErrors, 0.95))),
      errorObservations: priorLogErrors.length,
      confidence: priorLogErrors.length < 10 ? "low" : "moderate",
    },
  };
}

function addTrainingHistoricalErrorRange(
  forecast: RaceTrainingAdjustedPrediction | null,
  priorLogErrors: number[],
): RaceTrainingAdjustedPrediction | null {
  if (!forecast || priorLogErrors.length < 5) return forecast;
  return {
    ...forecast,
    historicalErrorRange: {
      label: "90% historical-error range",
      coveragePercent: 90,
      lowerSeconds: Math.round(forecast.predictedSeconds * Math.exp(quantile(priorLogErrors, 0.05))),
      upperSeconds: Math.round(forecast.predictedSeconds * Math.exp(quantile(priorLogErrors, 0.95))),
      errorObservations: priorLogErrors.length,
      confidence: priorLogErrors.length < 10 ? "low" : "moderate",
    },
  };
}

/** Adds a 90% range from strictly earlier rolling-origin forecast errors. */
export function buildRaceForecastWithHistoricalRange(
  races: RaceAnalysisActivity[],
  predictionDate: string,
  targetDistanceMeters: number,
  includeSameDay = false,
): RaceForecastPrediction | null {
  const priorRaces = races
    .filter((race) => (
      race.eventType === "race"
      && !race.excludedFromAnalytics
      && race.localDate < predictionDate
    ))
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const rollingLogErrors: number[] = [];
  for (const race of priorRaces) {
    const historicalForecast = buildRaceForecast(priorRaces, race.localDate, race.distanceMeters);
    if (historicalForecast) {
      rollingLogErrors.push(Math.log(race.durationSeconds / historicalForecast.predictedSeconds));
    }
  }
  return addHistoricalErrorRange(
    buildRaceForecast(races, predictionDate, targetDistanceMeters, includeSameDay),
    rollingLogErrors,
  );
}

/** Creates summary-only training features strictly before the prediction date. */
export function buildRaceTrainingFeatures(
  activities: RaceAnalysisActivity[],
  predictionDate: string,
  lookbackDays: number,
): RaceTrainingFeatures {
  const start = subtractDays(predictionDate, lookbackDays);
  const priorActivities = activities.filter((activity) => (
    !activity.excludedFromAnalytics
    && !activity.trainingExcluded
    && activity.localDate < predictionDate
    && activity.distanceMeters > 0
    && activity.durationSeconds > 0
  ));
  const eligible = priorActivities.filter((activity) => activity.localDate >= start);
  const recent = (days: number): RaceAnalysisActivity[] => {
    const recentStart = subtractDays(predictionDate, days);
    return priorActivities.filter((activity) => activity.localDate >= recentStart);
  };
  const totalMiles = (items: RaceAnalysisActivity[]): number => items.reduce(
    (sum, activity) => sum + miles(activity.distanceMeters), 0,
  );
  const totalHours = (items: RaceAnalysisActivity[]): number => items.reduce(
    (sum, activity) => sum + activity.durationSeconds / 3600, 0,
  );
  const longestMiles = (items: RaceAnalysisActivity[]): number => Math.max(
    0, ...items.map((activity) => miles(activity.distanceMeters)),
  );
  const expectedWeeks = Math.ceil(lookbackDays / 7);
  const weeklyMiles = Array.from({ length: expectedWeeks }, () => 0);
  for (const activity of eligible) {
    const ageDays = daysBetween(activity.localDate, predictionDate);
    const weekIndex = Math.min(expectedWeeks - 1, Math.floor(Math.max(0, ageDays - 1) / 7));
    weeklyMiles[weekIndex] += miles(activity.distanceMeters);
  }
  const activeWeeks = weeklyMiles.filter((value) => value > 0).length;
  const averageWeeklyMiles = weeklyMiles.reduce((sum, value) => sum + value, 0) / expectedWeeks;
  const weeklyStandardDeviation = Math.sqrt(weeklyMiles.reduce(
    (sum, value) => sum + (value - averageWeeklyMiles) ** 2,
    0,
  ) / expectedWeeks);
  const uniqueDates = [...new Set(eligible.map((activity) => activity.localDate))]
    .sort((left, right) => left.localeCompare(right));
  const boundaryDates = [start, ...uniqueDates, predictionDate];
  const longestTrainingGapDays = Math.max(0, ...boundaryDates.slice(1).map((date, index) => (
    Math.max(0, daysBetween(boundaryDates[index], date) - 1)
  )));
  const longestRun = eligible.reduce<RaceAnalysisActivity | null>((longest, activity) => (
    !longest || activity.distanceMeters > longest.distanceMeters ? activity : longest
  ), null);
  const miles7 = totalMiles(recent(7));
  const miles14 = totalMiles(recent(14));
  const miles28 = totalMiles(recent(28));
  const miles35 = totalMiles(recent(35));
  const miles56 = totalMiles(recent(56));
  const prior28WeeklyMiles = (miles35 - miles7) / 4;
  const prior42WeeklyMiles = (miles56 - miles14) / 6;

  return {
    lookbackDays,
    runs: eligible.length,
    miles: rounded(totalMiles(eligible), 1),
    milesLast7Days: rounded(miles7, 1),
    milesLast28Days: rounded(miles28, 1),
    milesLast56Days: rounded(miles56, 1),
    milesLast84Days: rounded(totalMiles(recent(84)), 1),
    milesLast112Days: rounded(totalMiles(recent(112)), 1),
    durationHoursLast7Days: rounded(totalHours(recent(7)), 1),
    durationHoursLast28Days: rounded(totalHours(recent(28)), 1),
    durationHoursLast56Days: rounded(totalHours(recent(56)), 1),
    durationHoursLast84Days: rounded(totalHours(recent(84)), 1),
    durationHoursLast112Days: rounded(totalHours(recent(112)), 1),
    activeWeeks,
    missingWeeks: Math.max(0, expectedWeeks - activeWeeks),
    averageWeeklyMiles: rounded(averageWeeklyMiles, 1),
    peakWeeklyMiles: rounded(Math.max(0, ...weeklyMiles), 1),
    weeklyMileageCoefficientOfVariation: averageWeeklyMiles > 0
      ? rounded(weeklyStandardDeviation / averageWeeklyMiles, 3)
      : null,
    runFrequencyPerWeek: rounded(eligible.length / expectedWeeks, 2),
    longestTrainingGapDays,
    longestRunMiles: rounded(longestMiles(eligible), 1),
    longestRunMilesLast28Days: rounded(longestMiles(recent(28)), 1),
    longestRunMilesLast56Days: rounded(longestMiles(recent(56)), 1),
    longestRunMilesLast112Days: rounded(longestMiles(recent(112)), 1),
    runsAtLeast12Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 12).length,
    runsAtLeast14Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 14).length,
    runsAtLeast16Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 16).length,
    runsAtLeast18Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 18).length,
    runsAtLeast20Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 20).length,
    longestRunDurationHours: rounded(longestRun ? longestRun.durationSeconds / 3600 : 0, 2),
    longestRunSharePercent: totalMiles(eligible) > 0
      ? rounded((longestRun ? miles(longestRun.distanceMeters) : 0) / totalMiles(eligible) * 100, 1)
      : 0,
    taperRatio7ToPrior28: prior28WeeklyMiles > 0 ? rounded(miles7 / prior28WeeklyMiles, 3) : null,
    taperRatio14ToPrior42: prior42WeeklyMiles > 0 ? rounded((miles14 / 2) / prior42WeeklyMiles, 3) : null,
    elevationGainMeters: Math.round(eligible.reduce(
      (sum, activity) => sum + (activity.elevationGainMeters ?? 0),
      0,
    )),
    averageHeartRate: (() => {
      const value = distanceWeightedAverage(eligible, (activity) => activity.averageHeartRate);
      return value === null ? null : rounded(value, 1);
    })(),
    measuredPowerRuns: eligible.filter((activity) => activity.averagePower !== null).length,
    calculatedPowerRuns: eligible.filter((activity) => (
      activity.averagePower === null && activity.calculatedPower !== null
    )).length,
  };
}

function weightedTrainingReference(
  activities: RaceAnalysisActivity[],
  forecast: RaceForecastPrediction,
  lookbackDays: number,
): RaceTrainingReference {
  const totalWeight = forecast.evidence.reduce((sum, evidence) => sum + evidence.combinedWeight, 0);
  const weighted = (pick: (features: RaceTrainingFeatures) => number): number => forecast.evidence.reduce(
    (sum, evidence) => sum + pick(buildRaceTrainingFeatures(activities, evidence.raceDate, lookbackDays)) * evidence.combinedWeight,
    0,
  ) / totalWeight;
  const expectedWeeks = Math.ceil(lookbackDays / 7);
  return {
    weeklyMiles56Days: rounded(weighted((features) => features.milesLast56Days / 8), 1),
    longestRunMiles: rounded(weighted((features) => features.longestRunMiles), 1),
    activeWeekShare: rounded(weighted((features) => Math.min(1, features.activeWeeks / expectedWeeks)), 3),
  };
}

function readinessParameters(targetDistanceMeters: number): {
  volumeSaturation: number;
  volumeEffect: number;
  longRunTarget: number;
  longRunEffect: number;
  consistencyEffect: number;
} {
  if (targetDistanceMeters < 8000) {
    return { volumeSaturation: 25, volumeEffect: 0, longRunTarget: 8, longRunEffect: 0, consistencyEffect: 0 };
  }
  if (targetDistanceMeters < 18_000) {
    return { volumeSaturation: 30, volumeEffect: 0.01, longRunTarget: 10, longRunEffect: 0.005, consistencyEffect: 0.005 };
  }
  if (targetDistanceMeters < 30_000) {
    return { volumeSaturation: 40, volumeEffect: 0.025, longRunTarget: 14, longRunEffect: 0.015, consistencyEffect: 0.01 };
  }
  return { volumeSaturation: 55, volumeEffect: 0.05, longRunTarget: 20, longRunEffect: 0.04, consistencyEffect: 0.015 };
}

/** Applies fixed, bounded durability effects relative to the training behind source races.
 *
 * When `fitness` is supplied, a strictly earlier Power @ 140 trajectory is
 * interpolated to (a) the prediction date and (b) each evidence-race date,
 * and a bounded, distance-dependent adjustment is applied to the base
 * forecast. This is intentionally unfitted, does not fit any per-athlete
 * coefficients, and remains experimental until it wins out-of-sample.
 */
export function buildTrainingAdjustedRaceForecast(
  activities: RaceAnalysisActivity[],
  races: RaceAnalysisActivity[],
  predictionDate: string,
  targetDistanceMeters: number,
  lookbackDays = 112,
  forecastHorizonDays = 0,
  fitness: RaceFitnessObservation[] = [],
  fitnessEnabled = false,
): RaceTrainingAdjustedPrediction | null {
  const baseForecast = buildRaceForecast(races, predictionDate, targetDistanceMeters);
  if (!baseForecast) return null;
  const targetTraining = buildRaceTrainingFeatures(activities, predictionDate, lookbackDays);
  const referenceTraining = weightedTrainingReference(activities, baseForecast, lookbackDays);
  const parameters = readinessParameters(targetDistanceMeters);
  const saturation = (weeklyMiles: number): number => 1 - Math.exp(-weeklyMiles / parameters.volumeSaturation);
  const boundedLongRun = (longestRunMiles: number): number => Math.min(1, longestRunMiles / parameters.longRunTarget);
  const expectedWeeks = Math.ceil(lookbackDays / 7);
  const targetActiveWeekShare = Math.min(1, targetTraining.activeWeeks / expectedWeeks);
  const targetWeeklyMiles = targetTraining.milesLast56Days / 8;
  const volumeEffect = -parameters.volumeEffect * (
    saturation(targetWeeklyMiles) - saturation(referenceTraining.weeklyMiles56Days)
  );
  const longRunEffect = -parameters.longRunEffect * (
    boundedLongRun(targetTraining.longestRunMiles) - boundedLongRun(referenceTraining.longestRunMiles)
  );
  const consistencyEffect = -parameters.consistencyEffect * (
    targetActiveWeekShare - referenceTraining.activeWeekShare
  );

  // Fitness effect (Power @ 140 trajectory): experimental and OFF by default.
  // The active model is v1 (volume + long-run + consistency) because on the
  // single-athlete backtest adding the fitness term is flat-to-worse overall
  // (5:42 vs 5:28). Pass `fitnessEnabled` to evaluate v2 out-of-sample.
  let fitnessEffect = 0;
  let fitnessTarget: number | null = null;
  let fitnessReference: number | null = null;
  let fitnessMeasured: boolean | null = null;
  if (fitnessEnabled && fitness.length > 0 && targetDistanceMeters >= 8000) {
    fitnessTarget = interpolateFitness(fitness, predictionDate);
    fitnessReference = weightedFitnessReference(baseForecast, fitness);
    if (fitnessTarget !== null && fitnessReference !== null) {
      const delta = Math.max(-FITNESS_DELTA_WATTS_CAP, Math.min(FITNESS_DELTA_WATTS_CAP, fitnessTarget - fitnessReference));
      fitnessMeasured = fitnessMeasuredFlag(fitness);
      fitnessEffect = -FITNESS_SENSITIVITY_PER_WATT * delta * fitnessDistanceFactor(targetDistanceMeters);
    }
  }

  const readinessRelevance = Math.max(0, Math.min(1, (84 - forecastHorizonDays) / 84));
  const adjustmentFactor = Math.exp(
    (volumeEffect + longRunEffect + consistencyEffect + fitnessEffect) * readinessRelevance,
  );

  return {
    modelVersion: fitnessEffect !== 0 ? "race-training-readiness-v2" : "race-training-readiness-v1",
    baseForecast,
    predictedSeconds: Math.round(baseForecast.predictedSeconds * adjustmentFactor),
    adjustmentFactor: rounded(adjustmentFactor, 5),
    adjustmentPercent: rounded((adjustmentFactor - 1) * 100, 2),
    forecastHorizonDays,
    readinessRelevance: rounded(readinessRelevance, 3),
    targetTraining,
    referenceTraining,
    fitness: fitnessTarget !== null && fitnessReference !== null
      ? {
          targetWatts: Math.round(fitnessTarget),
          referenceWatts: Math.round(fitnessReference),
          deltaWatts: Math.round(fitnessTarget - fitnessReference),
          measured: fitnessMeasured,
        }
      : null,
    effects: {
      volumePercent: rounded(volumeEffect * 100, 2),
      longRunPercent: rounded(longRunEffect * 100, 2),
      consistencyPercent: rounded(consistencyEffect * 100, 2),
      fitnessPercent: rounded(fitnessEffect * 100, 2),
    },
    historicalErrorRange: null,
  };
}

/**
 * Interpolates a Power @ 140 trajectory to a target date using only strictly
 * earlier observations (no leakage). Returns null when no sample falls within
 * the interpolation window — the caller should treat that as "no fitness
 * effect" rather than forcing a value.
 */
export function interpolateFitness(observations: RaceFitnessObservation[], date: string): number | null {
  const target = Date.parse(`${date}T00:00:00Z`);
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  // Find the most recent observation strictly before target within window.
  let priorDate: string | null = null;
  let priorDateTs: number | null = null;
  let priorWatts: number | null = null;
  for (const obs of sorted) {
    const ts = Date.parse(`${obs.date}T00:00:00Z`);
    if (ts < target && (priorDateTs === null || ts > priorDateTs)) {
      priorDate = obs.date;
      priorDateTs = ts;
      priorWatts = obs.watts;
    }
  }
  if (priorDate === null || priorWatts === null || priorDateTs === null) return null;
  const gapDays = (target - priorDateTs) / 86_400_000;
  if (gapDays > FITNESS_INTERPOLATION_MAX_DAYS) return null;
  // Use the most recent observation. A short-horizon linear extrapolation
  // would be unfitted and overconfident with ≤ 2 points; instead we rely on
  // the bounded effect + decay to avoid over-correcting sparse data.
  return priorWatts;
}

/** Weighted reference Power @ 140 across evidence races, same weights as training. */
export function weightedFitnessReference(
  forecast: RaceForecastPrediction,
  observations: RaceFitnessObservation[],
): number | null {
  if (observations.length === 0 || forecast.evidence.length === 0) return null;
  const totalWeight = forecast.evidence.reduce((sum, evidence) => sum + evidence.combinedWeight, 0);
  if (totalWeight <= 0) return null;
  const weighted = forecast.evidence.reduce((sum, evidence) => {
    const watts = interpolateFitness(observations, evidence.raceDate);
    return watts === null ? sum : sum + watts * evidence.combinedWeight;
  }, 0);
  const usedWeight = forecast.evidence.reduce((sum, evidence) => (
    interpolateFitness(observations, evidence.raceDate) === null ? sum : sum + evidence.combinedWeight
  ), 0);
  return usedWeight > 0 ? weighted / usedWeight : null;
}

/** When true, every contributing observation is measured Power @ 140. */
function fitnessMeasuredFlag(observations: RaceFitnessObservation[]): boolean {
  const relevant = observations.filter((obs) => Number.isFinite(obs.watts));
  return relevant.length > 0 && relevant.every((obs) => obs.measured);
}

/** Distance-dependent damping: shorter races don't use the full effect. */
function fitnessDistanceFactor(targetDistanceMeters: number): number {
  if (targetDistanceMeters < 8000) return 0;
  if (targetDistanceMeters < 18_000) return 0.4;
  if (targetDistanceMeters < 30_000) return 0.7;
  return 1;
}

/** Summarizes plan intent and logs that were knowable by the prediction date. */
export function buildRacePlanFeatures(
  plan: RaceAnalysisPlan,
  predictionDate: string,
): RacePlanFeatures {
  const planned = plan.plannedRuns.filter((run) => run.date < predictionDate);
  const logs = plan.logs.filter((log) => log.date < predictionDate && log.loggedAt.slice(0, 10) < predictionDate);
  const completed = logs.filter((log) => log.completed && !log.isAdditionalRun);
  const scheduledMiles = planned.reduce((sum, run) => sum + run.miles, 0);
  const loggedMiles = logs.reduce((sum, log) => sum + log.actualMiles, 0);
  const specificTypes = new Set(["long", "marathon_pace", "threshold", "vo2", "progression"]);

  return {
    planId: plan.id,
    scheduledRuns: planned.length,
    scheduledMiles: rounded(scheduledMiles, 1),
    scheduledSpecificMiles: rounded(planned.reduce(
      (sum, run) => sum + (specificTypes.has(run.workoutType) ? run.miles : 0),
      0,
    ), 1),
    loggedRuns: logs.length,
    completedRuns: completed.length,
    loggedMiles: rounded(loggedMiles, 1),
    workoutCompletionPercent: planned.length > 0 ? rounded(completed.length / planned.length * 100, 1) : null,
    loggedMileageAdherencePercent: scheduledMiles > 0 ? rounded(loggedMiles / scheduledMiles * 100, 1) : null,
    mutableAfterPrediction: plan.updatedAt.slice(0, 10) >= predictionDate,
  };
}

function matchingPlan(
  plans: RaceAnalysisPlan[],
  raceDate: string,
): RaceAnalysisPlan | null {
  return plans
    .filter((plan) => plan.raceDate === raceDate && plan.createdAt.slice(0, 10) < raceDate)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function summarizeErrors(errors: number[], absoluteErrorPercents: number[]): RaceBaselineSummary | null {
  if (errors.length === 0) return null;
  return {
    comparisons: errors.length,
    meanAbsoluteErrorSeconds: rounded(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length, 1),
    meanAbsoluteErrorPercent: rounded(
      absoluteErrorPercents.reduce((sum, error) => sum + error, 0) / absoluteErrorPercents.length,
      2,
    ),
    rootMeanSquaredErrorSeconds: rounded(Math.sqrt(
      errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length,
    ), 1),
    biasSeconds: rounded(errors.reduce((sum, error) => sum + error, 0) / errors.length, 1),
    medianAbsoluteErrorPercent: rounded(median(absoluteErrorPercents), 2),
    maxAbsoluteErrorPercent: rounded(Math.max(...absoluteErrorPercents), 2),
  };
}

function summarizeBaseline(rows: HistoricalRaceAnalysisRow[]): RaceBaselineSummary | null {
  const eligible = rows.filter((row) => row.errorSeconds !== null && row.absoluteErrorPercent !== null);
  if (eligible.length === 0) return null;
  return summarizeErrors(
    eligible.map((row) => row.errorSeconds as number),
    eligible.map((row) => row.absoluteErrorPercent as number),
  );
}

function summarizeForecast(rows: HistoricalRaceAnalysisRow[]): RaceBaselineSummary | null {
  const eligible = rows.filter((row) => (
    row.forecastErrorSeconds !== null && row.forecastAbsoluteErrorPercent !== null
  ));
  return summarizeErrors(
    eligible.map((row) => row.forecastErrorSeconds as number),
    eligible.map((row) => row.forecastAbsoluteErrorPercent as number),
  );
}

function summarizeTrainingAdjusted(rows: HistoricalRaceAnalysisRow[]): RaceBaselineSummary | null {
  const eligible = rows.filter((row) => (
    row.trainingAdjustedErrorSeconds !== null && row.trainingAdjustedAbsoluteErrorPercent !== null
  ));
  return summarizeErrors(
    eligible.map((row) => row.trainingAdjustedErrorSeconds as number),
    eligible.map((row) => row.trainingAdjustedAbsoluteErrorPercent as number),
  );
}

function compareTrainingAdjusted(rows: HistoricalRaceAnalysisRow[]): RaceCandidateComparison | null {
  const eligible = rows.filter((row) => (
    row.forecastErrorSeconds !== null
    && row.forecastAbsoluteErrorPercent !== null
    && row.trainingAdjustedErrorSeconds !== null
    && row.trainingAdjustedAbsoluteErrorPercent !== null
  ));
  if (eligible.length === 0) return null;
  const baseAbsoluteSeconds = eligible.map((row) => Math.abs(row.forecastErrorSeconds as number));
  const candidateAbsoluteSeconds = eligible.map((row) => Math.abs(row.trainingAdjustedErrorSeconds as number));
  const baseMedian = median(eligible.map((row) => row.forecastAbsoluteErrorPercent as number));
  const candidateMedian = median(eligible.map((row) => row.trainingAdjustedAbsoluteErrorPercent as number));
  return {
    commonComparisons: eligible.length,
    candidateWins: eligible.filter((row) => (
      Math.abs(row.trainingAdjustedErrorSeconds as number) < Math.abs(row.forecastErrorSeconds as number)
    )).length,
    ties: eligible.filter((row) => (
      Math.abs(row.trainingAdjustedErrorSeconds as number) === Math.abs(row.forecastErrorSeconds as number)
    )).length,
    baseWins: eligible.filter((row) => (
      Math.abs(row.trainingAdjustedErrorSeconds as number) > Math.abs(row.forecastErrorSeconds as number)
    )).length,
    candidateImprovedMae: candidateAbsoluteSeconds.reduce((sum, value) => sum + value, 0)
      < baseAbsoluteSeconds.reduce((sum, value) => sum + value, 0),
    candidateImprovedMedianAbsoluteError: candidateMedian < baseMedian,
  };
}

function summarizePredictionPairs(pairs: Array<{
  actualSeconds: number;
  predictedSeconds: number;
}>): RaceBaselineSummary | null {
  return summarizeErrors(
    pairs.map((pair) => pair.predictedSeconds - pair.actualSeconds),
    pairs.map((pair) => Math.abs(pair.predictedSeconds - pair.actualSeconds) / pair.actualSeconds * 100),
  );
}

function comparePredictionPairs(pairs: Array<{
  actualSeconds: number;
  baseSeconds: number;
  candidateSeconds: number;
}>): RaceCandidateComparison | null {
  if (pairs.length === 0) return null;
  const baseErrors = pairs.map((pair) => Math.abs(pair.baseSeconds - pair.actualSeconds));
  const candidateErrors = pairs.map((pair) => Math.abs(pair.candidateSeconds - pair.actualSeconds));
  const basePercents = pairs.map((pair, index) => baseErrors[index] / pair.actualSeconds * 100);
  const candidatePercents = pairs.map((pair, index) => candidateErrors[index] / pair.actualSeconds * 100);
  return {
    commonComparisons: pairs.length,
    candidateWins: pairs.filter((pair) => (
      Math.abs(pair.candidateSeconds - pair.actualSeconds) < Math.abs(pair.baseSeconds - pair.actualSeconds)
    )).length,
    ties: pairs.filter((pair) => (
      Math.abs(pair.candidateSeconds - pair.actualSeconds) === Math.abs(pair.baseSeconds - pair.actualSeconds)
    )).length,
    baseWins: pairs.filter((pair) => (
      Math.abs(pair.candidateSeconds - pair.actualSeconds) > Math.abs(pair.baseSeconds - pair.actualSeconds)
    )).length,
    candidateImprovedMae: candidateErrors.reduce((sum, value) => sum + value, 0)
      < baseErrors.reduce((sum, value) => sum + value, 0),
    candidateImprovedMedianAbsoluteError: median(candidatePercents) < median(basePercents),
  };
}

function evaluateHorizons(
  activities: RaceAnalysisActivity[],
  races: RaceAnalysisActivity[],
  lookbackDays: number,
  fitness: RaceFitnessObservation[] = [],
  fitnessEnabled = false,
): RaceHorizonEvaluation[] {
  return ([7, 28, 84] as const).map((horizonDays): RaceHorizonEvaluation => {
    const pairs = races.flatMap((race) => {
      const predictionDate = subtractDays(race.localDate, horizonDays);
      const base = buildRaceForecast(races, predictionDate, race.distanceMeters);
        const candidate = buildTrainingAdjustedRaceForecast(
          activities,
          races,
          predictionDate,
          race.distanceMeters,
          lookbackDays,
          horizonDays,
          fitness,
          fitnessEnabled,
        );
      if (!base || !candidate) return [];
      return [{
        actualSeconds: race.durationSeconds,
        targetDistanceMeters: race.distanceMeters,
        baseSeconds: base.predictedSeconds,
        candidateSeconds: candidate.predictedSeconds,
      }];
    });
    const marathonPairs = pairs.filter((pair) => pair.targetDistanceMeters >= 30_000);
    return {
      horizonDays,
      base: summarizePredictionPairs(pairs.map((pair) => ({
        actualSeconds: pair.actualSeconds,
        predictedSeconds: pair.baseSeconds,
      }))),
      candidate: summarizePredictionPairs(pairs.map((pair) => ({
        actualSeconds: pair.actualSeconds,
        predictedSeconds: pair.candidateSeconds,
      }))),
      comparison: comparePredictionPairs(pairs),
      marathonBase: summarizePredictionPairs(marathonPairs.map((pair) => ({
        actualSeconds: pair.actualSeconds,
        predictedSeconds: pair.baseSeconds,
      }))),
      marathonCandidate: summarizePredictionPairs(marathonPairs.map((pair) => ({
        actualSeconds: pair.actualSeconds,
        predictedSeconds: pair.candidateSeconds,
      }))),
    };
  });
}

function compareForecast(rows: HistoricalRaceAnalysisRow[]): RaceForecastComparison | null {
  const eligible = rows.filter((row) => (
    row.absoluteErrorPercent !== null && row.forecastAbsoluteErrorPercent !== null
  ));
  if (eligible.length === 0) return null;
  const baselineMedian = median(eligible.map((row) => row.absoluteErrorPercent as number));
  const forecastMedian = median(eligible.map((row) => row.forecastAbsoluteErrorPercent as number));
  return {
    commonComparisons: eligible.length,
    forecastWins: eligible.filter((row) => (
      (row.forecastAbsoluteErrorPercent as number) < (row.absoluteErrorPercent as number)
    )).length,
    ties: eligible.filter((row) => row.forecastAbsoluteErrorPercent === row.absoluteErrorPercent).length,
    baselineWins: eligible.filter((row) => (
      (row.forecastAbsoluteErrorPercent as number) > (row.absoluteErrorPercent as number)
    )).length,
    forecastImprovedMedianAbsoluteError: forecastMedian < baselineMedian,
  };
}

/** Builds historical baseline evaluations and forecasts for plans active as of the cutoff. */
export function analyzeRacePerformance(input: {
  activities: RaceAnalysisActivity[];
  plans: RaceAnalysisPlan[];
  asOf: string;
  lookbackDays?: number;
  fitness?: RaceFitnessObservation[];
  /** Opt-in Power @ 140 fitness effect (v2). Off by default; v1 is the
   * active model until the fitness effect wins out-of-sample. */
  fitnessEnabled?: boolean;
}): RacePerformanceAnalysis {
  const lookbackDays = input.lookbackDays ?? 112;
  const fitnessEnabled = input.fitnessEnabled === true;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 28) {
    throw new Error("lookbackDays must be an integer of at least 28");
  }
  const activities = input.activities.filter((activity) => activity.localDate <= input.asOf);
  const races = activities
    .filter((activity) => (
      activity.eventType === "race"
      && !activity.excludedFromAnalytics
      && activity.distanceMeters > 0
      && activity.durationSeconds > 0
    ))
    .sort((left, right) => left.localDate.localeCompare(right.localDate));

  const historicalRaces: HistoricalRaceAnalysisRow[] = [];
  const rollingForecastLogErrors: number[] = [];
  const rollingTrainingAdjustedLogErrors: number[] = [];
  for (const race of races) {
    const baseline = baselineFor(races, race.localDate, race.distanceMeters);
    const rawForecast = buildRaceForecast(races, race.localDate, race.distanceMeters);
    const forecast = addHistoricalErrorRange(rawForecast, rollingForecastLogErrors);
      const trainingAdjustedForecast = addTrainingHistoricalErrorRange(
        buildTrainingAdjustedRaceForecast(
          activities,
          races,
          race.localDate,
          race.distanceMeters,
          lookbackDays,
          0,
          input.fitness ?? [],
          fitnessEnabled,
        ),
      rollingTrainingAdjustedLogErrors,
    );
    const plan = matchingPlan(input.plans, race.localDate);
    const errorSeconds = baseline ? baseline.predictedSeconds - race.durationSeconds : null;
    const forecastErrorSeconds = forecast ? forecast.predictedSeconds - race.durationSeconds : null;
    const trainingAdjustedErrorSeconds = trainingAdjustedForecast
      ? trainingAdjustedForecast.predictedSeconds - race.durationSeconds
      : null;
    historicalRaces.push({
      raceId: race.id,
      raceDate: race.localDate,
      distanceLabel: classifyRaceDistance(miles(race.distanceMeters)).label,
      distanceMeters: race.distanceMeters,
      actualSeconds: race.durationSeconds,
      baseline,
      errorSeconds,
      absoluteErrorPercent: errorSeconds === null
        ? null
        : rounded(Math.abs(errorSeconds) / race.durationSeconds * 100, 2),
      forecast,
      forecastErrorSeconds,
      forecastAbsoluteErrorPercent: forecastErrorSeconds === null
        ? null
        : rounded(Math.abs(forecastErrorSeconds) / race.durationSeconds * 100, 2),
      trainingAdjustedForecast,
      trainingAdjustedErrorSeconds,
      trainingAdjustedAbsoluteErrorPercent: trainingAdjustedErrorSeconds === null
        ? null
        : rounded(Math.abs(trainingAdjustedErrorSeconds) / race.durationSeconds * 100, 2),
      training: buildRaceTrainingFeatures(activities, race.localDate, lookbackDays),
      plan: plan ? buildRacePlanFeatures(plan, race.localDate) : null,
    });
    if (forecast) rollingForecastLogErrors.push(Math.log(race.durationSeconds / forecast.predictedSeconds));
    if (trainingAdjustedForecast) {
      rollingTrainingAdjustedLogErrors.push(Math.log(race.durationSeconds / trainingAdjustedForecast.predictedSeconds));
    }
  }

  const planTargets = input.plans
    .filter((plan) => plan.raceDate >= input.asOf && plan.createdAt.slice(0, 10) <= input.asOf)
    .sort((left, right) => left.raceDate.localeCompare(right.raceDate))
    .map((plan): PlanTargetAnalysisRow => {
      const baseline = baselineFor(races, input.asOf, plan.raceDistanceMeters);
      const forecast = addHistoricalErrorRange(
        buildRaceForecast(races, input.asOf, plan.raceDistanceMeters),
        rollingForecastLogErrors,
      );
        const trainingAdjustedForecast = addTrainingHistoricalErrorRange(
          buildTrainingAdjustedRaceForecast(
            activities,
            races,
            input.asOf,
            plan.raceDistanceMeters,
            lookbackDays,
            Math.max(0, daysBetween(input.asOf, plan.raceDate)),
            input.fitness ?? [],
            fitnessEnabled,
          ),
        rollingTrainingAdjustedLogErrors,
      );
      return {
        planId: plan.id,
        raceName: plan.raceName,
        raceDate: plan.raceDate,
        predictionDate: input.asOf,
        distanceLabel: classifyRaceDistance(miles(plan.raceDistanceMeters)).label,
        distanceMeters: plan.raceDistanceMeters,
        goalSeconds: plan.goalSeconds,
        baseline,
        goalDeltaSeconds: baseline && plan.goalSeconds !== null
          ? baseline.predictedSeconds - plan.goalSeconds
          : null,
        forecast,
        forecastGoalDeltaSeconds: forecast && plan.goalSeconds !== null
          ? forecast.predictedSeconds - plan.goalSeconds
          : null,
        trainingAdjustedForecast,
        trainingAdjustedGoalDeltaSeconds: trainingAdjustedForecast && plan.goalSeconds !== null
          ? trainingAdjustedForecast.predictedSeconds - plan.goalSeconds
          : null,
        training: buildRaceTrainingFeatures(activities, input.asOf, lookbackDays),
        plan: buildRacePlanFeatures(plan, input.asOf),
      };
    });

  return {
    algorithmVersion: "race-analysis-v3",
    asOf: input.asOf,
    dataCoverage: {
      activities: activities.length,
      taggedRaces: races.length,
      plans: input.plans.length,
      measuredPowerActivities: activities.filter((activity) => activity.averagePower !== null).length,
      calculatedPowerActivities: activities.filter((activity) => (
        activity.averagePower === null && activity.calculatedPower !== null
      )).length,
      fitnessObservations: (input.fitness ?? []).length,
      measuredFitnessObservations: (input.fitness ?? []).filter((obs) => obs.measured).length,
    },
    baselineSummary: summarizeBaseline(historicalRaces),
    forecastSummary: summarizeForecast(historicalRaces),
    forecastComparison: compareForecast(historicalRaces),
    trainingAdjustedSummary: summarizeTrainingAdjusted(historicalRaces),
    trainingAdjustedComparison: compareTrainingAdjusted(historicalRaces),
    horizonEvaluations: evaluateHorizons(activities, races, lookbackDays, input.fitness ?? [], fitnessEnabled),
    historicalRaces,
    planTargets,
    warnings: [
      "Race outcomes may mix reviewed canonical results with unreviewed Garmin GPS fallbacks; inspect source provenance.",
      "The Riegel baseline does not adjust for course, weather, fatigue, or race execution.",
      "The race-evidence forecast is a fixed heuristic; its range reflects historical errors and is not calibrated.",
      "The training-readiness candidate uses fixed bounded effects and remains experimental until it wins across athletes and horizons.",
      "The fitness effect uses a fixed, unfitted Power@140 sensitivity; a modeled trajectory (not measured sensor power) is clearly flagged and never presented as measured power.",
      "Plan JSON and logs are mutable; mutableAfterPrediction marks known snapshot leakage risk.",
      "Calculated power is speed-derived and is reported only as coverage, never as independent pace evidence.",
      "Do not present goal probabilities until they are calibrated with temporal and athlete-held-out validation.",
    ],
  };
}
