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
  milesLast28Days: number;
  milesLast56Days: number;
  activeWeeks: number;
  missingWeeks: number;
  longestRunMiles: number;
  runsAtLeast16Miles: number;
  runsAtLeast20Miles: number;
  elevationGainMeters: number;
  averageHeartRate: number | null;
  measuredPowerRuns: number;
  calculatedPowerRuns: number;
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

export interface RacePerformanceAnalysis {
  algorithmVersion: "race-analysis-v2";
  asOf: string;
  dataCoverage: {
    activities: number;
    taggedRaces: number;
    plans: number;
    measuredPowerActivities: number;
    calculatedPowerActivities: number;
  };
  baselineSummary: RaceBaselineSummary | null;
  forecastSummary: RaceBaselineSummary | null;
  forecastComparison: RaceForecastComparison | null;
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

function mondayKey(value: string): string {
  const date = new Date(dateMillis(value));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
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
): RaceForecastPrediction | null {
  const evidence = races
    .filter((race) => {
      const ageDays = daysBetween(race.localDate, predictionDate);
      return race.localDate < predictionDate
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

/** Adds a 90% range from strictly earlier rolling-origin forecast errors. */
export function buildRaceForecastWithHistoricalRange(
  races: RaceAnalysisActivity[],
  predictionDate: string,
  targetDistanceMeters: number,
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
    buildRaceForecast(priorRaces, predictionDate, targetDistanceMeters),
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
    && activity.localDate < predictionDate
    && activity.distanceMeters > 0
    && activity.durationSeconds > 0
  ));
  const eligible = priorActivities.filter((activity) => activity.localDate >= start);
  const recentMiles = (days: number): number => {
    const recentStart = subtractDays(predictionDate, days);
    return priorActivities
      .filter((activity) => activity.localDate >= recentStart)
      .reduce((sum, activity) => sum + miles(activity.distanceMeters), 0);
  };
  const activeWeeks = new Set(eligible.map((activity) => mondayKey(activity.localDate))).size;
  const expectedWeeks = Math.ceil(lookbackDays / 7);

  return {
    lookbackDays,
    runs: eligible.length,
    miles: rounded(eligible.reduce((sum, activity) => sum + miles(activity.distanceMeters), 0), 1),
    milesLast28Days: rounded(recentMiles(28), 1),
    milesLast56Days: rounded(recentMiles(56), 1),
    activeWeeks,
    missingWeeks: Math.max(0, expectedWeeks - activeWeeks),
    longestRunMiles: rounded(Math.max(0, ...eligible.map((activity) => miles(activity.distanceMeters))), 1),
    runsAtLeast16Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 16).length,
    runsAtLeast20Miles: eligible.filter((activity) => miles(activity.distanceMeters) >= 20).length,
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
}): RacePerformanceAnalysis {
  const lookbackDays = input.lookbackDays ?? 112;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 28) {
    throw new Error("lookbackDays must be an integer of at least 28");
  }
  const activities = input.activities.filter((activity) => activity.localDate <= input.asOf);
  const races = activities
    .filter((activity) => activity.eventType === "race" && !activity.excludedFromAnalytics)
    .sort((left, right) => left.localDate.localeCompare(right.localDate));

  const historicalRaces: HistoricalRaceAnalysisRow[] = [];
  const rollingForecastLogErrors: number[] = [];
  for (const race of races) {
    const baseline = baselineFor(races, race.localDate, race.distanceMeters);
    const rawForecast = buildRaceForecast(races, race.localDate, race.distanceMeters);
    const forecast = addHistoricalErrorRange(rawForecast, rollingForecastLogErrors);
    const plan = matchingPlan(input.plans, race.localDate);
    const errorSeconds = baseline ? baseline.predictedSeconds - race.durationSeconds : null;
    const forecastErrorSeconds = forecast ? forecast.predictedSeconds - race.durationSeconds : null;
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
      training: buildRaceTrainingFeatures(activities, race.localDate, lookbackDays),
      plan: plan ? buildRacePlanFeatures(plan, race.localDate) : null,
    });
    if (forecast) rollingForecastLogErrors.push(Math.log(race.durationSeconds / forecast.predictedSeconds));
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
        training: buildRaceTrainingFeatures(activities, input.asOf, lookbackDays),
        plan: buildRacePlanFeatures(plan, input.asOf),
      };
    });

  return {
    algorithmVersion: "race-analysis-v2",
    asOf: input.asOf,
    dataCoverage: {
      activities: activities.length,
      taggedRaces: races.length,
      plans: input.plans.length,
      measuredPowerActivities: activities.filter((activity) => activity.averagePower !== null).length,
      calculatedPowerActivities: activities.filter((activity) => (
        activity.averagePower === null && activity.calculatedPower !== null
      )).length,
    },
    baselineSummary: summarizeBaseline(historicalRaces),
    forecastSummary: summarizeForecast(historicalRaces),
    forecastComparison: compareForecast(historicalRaces),
    historicalRaces,
    planTargets,
    warnings: [
      "Race outcomes are Garmin GPS activities, not verified official chip times or distances.",
      "The Riegel baseline does not adjust for course, weather, fatigue, or race execution.",
      "The race-evidence forecast is a fixed heuristic; its range reflects historical errors and is not calibrated.",
      "Plan JSON and logs are mutable; mutableAfterPrediction marks known snapshot leakage risk.",
      "Calculated power is speed-derived and is reported only as coverage, never as independent pace evidence.",
      "Do not present goal probabilities until they are calibrated with temporal and athlete-held-out validation.",
    ],
  };
}
