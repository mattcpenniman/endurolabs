// ============================================================
// EnduroLab — Readiness Metric Validation
// ============================================================
// Ranks the candidate readiness metrics (volume, minutes at
// HR/power effort, long-run exposure, consistency) with the
// existing rolling-origin race backtest and athlete-held-out
// folds, reports MAE/RMSE/bias, and promotes only the metrics
// that beat the incumbent set under an explicit, fixed policy.
//
// The metric effects themselves stay fixed and unfitted in
// `race-performance-analysis.ts`; this module decides which of
// them may be surfaced as impact in the plan-vs-actual beacon.
// No metric is promoted on domain intuition alone.

import {
  READINESS_METRIC_KEYS,
  buildRaceForecast,
  buildRaceTrainingFeatures,
  comparePredictionPairs,
  computeReadinessAdjustment,
  summarizePredictionPairs,
  weightedTrainingReference,
  type RaceAnalysisActivity,
  type RaceBaselineSummary,
  type RaceCandidateComparison,
  type RaceForecastPrediction,
  type RaceTrainingFeatures,
  type RaceTrainingReference,
  type ReadinessMetricKey,
} from "./race-performance-analysis";

export const READINESS_METRICS_VERSION = "readiness-metrics-v1";
export const READINESS_VALIDATION_HORIZONS = [7, 28, 84] as const;

const DAY_MS = 86_400_000;
const MARATHON_METERS = 30_000;

const READINESS_METRIC_LABELS: Record<ReadinessMetricKey, string> = {
  volume: "Weekly volume",
  long_run: "Long-run exposure",
  consistency: "Weekly consistency",
  hr_effort: "Minutes at HR effort",
  power_effort: "Minutes at power effort",
};

const READINESS_METRIC_DEFINITIONS: Record<ReadinessMetricKey, string> = {
  volume: "56-day weekly mileage vs the training behind the evidence races.",
  long_run: "Longest run vs the training behind the evidence races.",
  consistency: "Active-week share vs the training behind the evidence races.",
  hr_effort: "Weekly minutes in the marathon-or-faster heart-rate zones from stored samples.",
  power_effort: "Weekly minutes in the marathon-or-faster measured-power zones from stored samples.",
};

export interface ReadinessValidationSubject {
  athleteId: string;
  activities: RaceAnalysisActivity[];
}

export interface ReadinessPromotionPolicy {
  /** Minimum pooled common comparisons before any metric can be promoted. */
  minComparisons: number;
  /** Minimum MAE improvement over the incumbent set, as a share of mean actual time. */
  minRelativeMaeImprovement: number;
  /** Maximum marathon-only MAE regression tolerated, as a share of mean marathon time. */
  maxRelativeMarathonRegression: number;
  /** Require the median absolute error to improve on the pairs the metric actually moves. */
  requireChangedMedianImprovement: boolean;
  requireWinsOverLosses: boolean;
  /** Minimum share of prediction pairs with usable data for a metric. */
  minCoverageShare: number;
  /** Athlete-held-out folds need at least this many subjects. */
  minSubjectsForHoldout: number;
}

export const DEFAULT_READINESS_PROMOTION_POLICY: ReadinessPromotionPolicy = {
  minComparisons: 8,
  minRelativeMaeImprovement: 0.0015,
  maxRelativeMarathonRegression: 0.001,
  requireChangedMedianImprovement: true,
  requireWinsOverLosses: true,
  minCoverageShare: 0.5,
  minSubjectsForHoldout: 2,
};

export interface ReadinessValidationPair {
  athleteId: string;
  raceId: string;
  raceDate: string;
  horizonDays: number;
  distanceMeters: number;
  actualSeconds: number;
  baseSeconds: number;
}

interface ReadinessPairSeed extends ReadinessValidationPair {
  baseForecast: RaceForecastPrediction;
  targetTraining: RaceTrainingFeatures;
  referenceTraining: RaceTrainingReference;
  metricData: Record<ReadinessMetricKey, boolean>;
}

export interface ReadinessMetricSetResult {
  metrics: readonly ReadinessMetricKey[];
  comparisons: number;
  meanActualSeconds: number;
  summary: RaceBaselineSummary | null;
  /** Candidate vs the race-evidence-v1 base model. */
  comparison: RaceCandidateComparison | null;
  marathon: RaceBaselineSummary | null;
  marathonMeanActualSeconds: number;
  horizons: Array<{
    horizonDays: number;
    summary: RaceBaselineSummary | null;
    comparison: RaceCandidateComparison | null;
  }>;
  /** Minimum coverage share across the set's metrics (1 for the empty set). */
  coverageShare: number;
}

export interface ReadinessMetricRanking {
  metric: ReadinessMetricKey;
  label: string;
  definition: string;
  coverageShare: number;
  eligible: boolean;
  /** 1-based rank among promoted metrics; null when the metric is rejected. */
  rank: number | null;
  promotion: "promoted" | "rejected";
  /** Set result for the base model plus this single metric. */
  standalone: ReadinessMetricSetResult;
  maeImprovementSeconds: number;
  relativeMaeImprovement: number;
  /** Gate reasons against the base model. */
  reasons: string[];
}

export interface ReadinessForwardStep {
  step: number;
  metric: ReadinessMetricKey;
  metrics: readonly ReadinessMetricKey[];
  maeImprovementSeconds: number;
  relativeMaeImprovement: number;
  medianImproved: boolean;
  wins: number;
  ties: number;
  losses: number;
  coverageShare: number;
}

export interface ReadinessAthleteFold {
  heldOutAthleteId: string;
  selectedMetrics: readonly ReadinessMetricKey[];
  heldOutComparisons: number;
  heldOutMaeImprovementSeconds: number | null;
  heldOutRelativeMaeImprovement: number | null;
  heldOutMedianImproved: boolean;
  heldOutWins: number;
  heldOutLosses: number;
}

export interface ReadinessAthleteHeldOut {
  available: boolean;
  folds: ReadinessAthleteFold[];
  /** Share of folds whose held-out athlete improved in pooled MAE. */
  improvedFoldShare: number | null;
  medianFoldMaeImprovementSeconds: number | null;
  validated: boolean;
}

export interface ReadinessMetricsReport {
  version: typeof READINESS_METRICS_VERSION;
  asOf: string;
  lookbackDays: number;
  horizons: readonly number[];
  policy: ReadinessPromotionPolicy;
  subjects: number;
  races: number;
  pairs: number;
  base: ReadinessMetricSetResult;
  ranking: ReadinessMetricRanking[];
  forwardSelection: ReadinessForwardStep[];
  /**
   * Metrics that earn a place in the beacon: gate passers ranked by
   * rolling-origin MAE improvement. Correlated metrics can both pass; the
   * stepwise subset is reported separately.
   */
  promoted: readonly ReadinessMetricKey[];
  /** Stepwise incremental subset, which drops correlated later additions. */
  incrementalSelection: readonly ReadinessMetricKey[];
  rejected: readonly ReadinessMetricKey[];
  athleteHeldOut: ReadinessAthleteHeldOut;
  warnings: string[];
}

export interface ReadinessValidationInput {
  subjects: ReadinessValidationSubject[];
  asOf: string;
  lookbackDays?: number;
  horizons?: readonly number[];
  policy?: Partial<ReadinessPromotionPolicy>;
}

function dateMillis(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

function subtractDays(value: string, days: number): string {
  return new Date(dateMillis(value) - days * DAY_MS).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function metricSetKey(metrics: readonly ReadinessMetricKey[]): string {
  return [...metrics].sort().join("+");
}

function validRaces(activities: RaceAnalysisActivity[]): RaceAnalysisActivity[] {
  return activities
    .filter((activity) => (
      activity.eventType === "race"
      && !activity.excludedFromAnalytics
      && activity.distanceMeters > 0
      && activity.durationSeconds > 0
    ))
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
}

function metricHasData(features: RaceTrainingFeatures, metric: ReadinessMetricKey): boolean {
  switch (metric) {
    case "volume": return features.runs > 0 && features.miles > 0;
    case "long_run": return features.longestRunMiles > 0;
    case "consistency": return features.activeWeeks > 0;
    case "hr_effort": return features.hrEffortRuns > 0;
    case "power_effort": return features.powerEffortRuns > 0;
  }
}

/** Builds one leakage-safe pair seed per race and forecast horizon. */
function buildPairSeeds(
  subject: ReadinessValidationSubject,
  lookbackDays: number,
  horizons: readonly number[],
): ReadinessPairSeed[] {
  const races = validRaces(subject.activities);
  const seeds: ReadinessPairSeed[] = [];
  for (const race of races) {
    for (const horizonDays of horizons) {
      const predictionDate = subtractDays(race.localDate, horizonDays);
      const baseForecast = buildRaceForecast(races, predictionDate, race.distanceMeters);
      if (!baseForecast) continue;
      const targetTraining = buildRaceTrainingFeatures(subject.activities, predictionDate, lookbackDays);
      const referenceTraining = weightedTrainingReference(subject.activities, baseForecast, lookbackDays);
      seeds.push({
        athleteId: subject.athleteId,
        raceId: race.id,
        raceDate: race.localDate,
        horizonDays,
        distanceMeters: race.distanceMeters,
        actualSeconds: race.durationSeconds,
        baseSeconds: baseForecast.predictedSeconds,
        baseForecast,
        targetTraining,
        referenceTraining,
        metricData: Object.fromEntries(
          READINESS_METRIC_KEYS.map((metric) => [metric, metricHasData(targetTraining, metric)]),
        ) as Record<ReadinessMetricKey, boolean>,
      });
    }
  }
  return seeds;
}

function candidateSeconds(seed: ReadinessPairSeed, metrics: readonly ReadinessMetricKey[]): number {
  const adjustment = computeReadinessAdjustment({
    targetTraining: seed.targetTraining,
    referenceTraining: seed.referenceTraining,
    targetDistanceMeters: seed.distanceMeters,
    forecastHorizonDays: seed.horizonDays,
    metrics,
  });
  return Math.round(seed.baseSeconds * Math.exp(adjustment.logAdjustment * adjustment.readinessRelevance));
}

function coverageShareFor(seeds: ReadinessPairSeed[], metrics: readonly ReadinessMetricKey[]): number {
  if (metrics.length === 0 || seeds.length === 0) return 1;
  return Math.min(...metrics.map((metric) => (
    seeds.filter((seed) => seed.metricData[metric]).length / seeds.length
  )));
}

function evaluateSet(
  seeds: ReadinessPairSeed[],
  metrics: readonly ReadinessMetricKey[],
): ReadinessMetricSetResult {
  const pairs = seeds.map((seed) => ({
    seed,
    candidateSeconds: candidateSeconds(seed, metrics),
  }));
  const toPredictionPairs = (items: typeof pairs) => items.map((item) => ({
    actualSeconds: item.seed.actualSeconds,
    predictedSeconds: item.candidateSeconds,
  }));
  const toComparisonPairs = (items: typeof pairs) => items.map((item) => ({
    actualSeconds: item.seed.actualSeconds,
    baseSeconds: item.seed.baseSeconds,
    candidateSeconds: item.candidateSeconds,
  }));
  const marathonPairs = pairs.filter((item) => item.seed.distanceMeters >= MARATHON_METERS);
  const horizons = [...new Set(seeds.map((seed) => seed.horizonDays))].sort((left, right) => left - right)
    .map((horizonDays) => {
      const horizonPairs = pairs.filter((item) => item.seed.horizonDays === horizonDays);
      return {
        horizonDays,
        summary: summarizePredictionPairs(toPredictionPairs(horizonPairs)),
        comparison: comparePredictionPairs(toComparisonPairs(horizonPairs)),
      };
    });
  const meanActualSeconds = seeds.length > 0
    ? seeds.reduce((sum, seed) => sum + seed.actualSeconds, 0) / seeds.length
    : 0;
  const marathonMeanActualSeconds = marathonPairs.length > 0
    ? marathonPairs.reduce((sum, item) => sum + item.seed.actualSeconds, 0) / marathonPairs.length
    : 0;
  return {
    metrics: [...metrics],
    comparisons: seeds.length,
    meanActualSeconds,
    summary: summarizePredictionPairs(toPredictionPairs(pairs)),
    comparison: comparePredictionPairs(toComparisonPairs(pairs)),
    marathon: summarizePredictionPairs(toPredictionPairs(marathonPairs)),
    marathonMeanActualSeconds,
    horizons,
    coverageShare: coverageShareFor(seeds, metrics),
  };
}

export interface ReadinessPairedComparison {
  /** All-pair wins/ties/losses of the candidate against the incumbent set. */
  comparison: RaceCandidateComparison;
  /** Pairs where the candidate prediction actually differs from the incumbent. */
  changedComparisons: number;
  changedIncumbentMedianAbsoluteErrorPercent: number | null;
  changedCandidateMedianAbsoluteErrorPercent: number | null;
}

function compareAgainstIncumbent(
  seeds: ReadinessPairSeed[],
  incumbent: readonly ReadinessMetricKey[],
  candidate: readonly ReadinessMetricKey[],
): ReadinessPairedComparison | null {
  if (seeds.length === 0) return null;
  const rows = seeds.map((seed) => {
    const incumbentSeconds = candidateSeconds(seed, incumbent);
    const candidateValue = candidateSeconds(seed, candidate);
    const changed = candidateValue !== incumbentSeconds;
    return {
      actualSeconds: seed.actualSeconds,
      baseSeconds: incumbentSeconds,
      candidateSeconds: candidateValue,
      changed,
      incumbentAbsoluteErrorPercent: Math.abs(incumbentSeconds - seed.actualSeconds) / seed.actualSeconds * 100,
      candidateAbsoluteErrorPercent: Math.abs(candidateValue - seed.actualSeconds) / seed.actualSeconds * 100,
    };
  });
  const comparison = comparePredictionPairs(rows);
  if (!comparison) return null;
  const changed = rows.filter((row) => row.changed);
  return {
    comparison,
    changedComparisons: changed.length,
    changedIncumbentMedianAbsoluteErrorPercent: median(changed.map((row) => row.incumbentAbsoluteErrorPercent)),
    changedCandidateMedianAbsoluteErrorPercent: median(changed.map((row) => row.candidateAbsoluteErrorPercent)),
  };
}

function formatSeconds(value: number): string {
  return `${Math.round(value)}s`;
}

/**
 * Decides whether adding a metric to the incumbent set passes the fixed
 * promotion policy. Failures are returned as human-readable reasons.
 */
export function evaluateReadinessPromotionGate(
  incumbent: ReadinessMetricSetResult,
  candidate: ReadinessMetricSetResult,
  paired: ReadinessPairedComparison | null,
  policy: ReadinessPromotionPolicy,
): { passed: boolean; reasons: string[] } {
  const comparison = paired?.comparison ?? null;
  const reasons: string[] = [];
  if (candidate.comparisons < policy.minComparisons || incumbent.comparisons < policy.minComparisons) {
    reasons.push(`insufficient common comparisons (${candidate.comparisons} < ${policy.minComparisons})`);
  }
  if (candidate.coverageShare < policy.minCoverageShare) {
    reasons.push(`metric coverage ${(candidate.coverageShare * 100).toFixed(0)}% below ${(policy.minCoverageShare * 100).toFixed(0)}%`);
  }
  const requiredSeconds = candidate.meanActualSeconds * policy.minRelativeMaeImprovement;
  const improvementSeconds = (incumbent.summary?.meanAbsoluteErrorSeconds ?? Number.POSITIVE_INFINITY)
    - (candidate.summary?.meanAbsoluteErrorSeconds ?? Number.NEGATIVE_INFINITY);
  if (improvementSeconds < requiredSeconds) {
    reasons.push(
      `MAE improvement ${formatSeconds(improvementSeconds)} below the required ${formatSeconds(requiredSeconds)}`,
    );
  }
  if (policy.requireChangedMedianImprovement) {
    if (!paired || paired.changedComparisons < 4) {
      reasons.push("too few changed predictions to confirm a median improvement");
    } else if (
      (paired.changedCandidateMedianAbsoluteErrorPercent ?? Number.POSITIVE_INFINITY)
      >= (paired.changedIncumbentMedianAbsoluteErrorPercent ?? Number.NEGATIVE_INFINITY)
    ) {
      reasons.push("median absolute error did not improve on changed predictions");
    }
  }
  if (
    policy.requireWinsOverLosses
    && (!comparison || comparison.candidateWins <= comparison.baseWins)
  ) {
    reasons.push(
      comparison
        ? `candidate wins ${comparison.candidateWins} vs losses ${comparison.baseWins}`
        : "no common comparison against the incumbent",
    );
  }
  const marathonRegression = (candidate.marathon?.meanAbsoluteErrorSeconds ?? 0)
    - (incumbent.marathon?.meanAbsoluteErrorSeconds ?? 0);
  const allowedMarathonRegression = candidate.marathonMeanActualSeconds * policy.maxRelativeMarathonRegression;
  if (marathonRegression > allowedMarathonRegression) {
    reasons.push(
      `marathon-only MAE regressed ${formatSeconds(marathonRegression)} (limit ${formatSeconds(allowedMarathonRegression)})`,
    );
  }
  return { passed: reasons.length === 0, reasons };
}

function runForwardSelection(input: {
  seeds: ReadinessPairSeed[];
  policy: ReadinessPromotionPolicy;
  baseResult: ReadinessMetricSetResult;
  cache: Map<string, ReadinessMetricSetResult>;
}): { steps: ReadinessForwardStep[]; promoted: ReadinessMetricKey[] } {
  const { seeds, policy, baseResult, cache } = input;
  const evaluate = (metrics: readonly ReadinessMetricKey[]): ReadinessMetricSetResult => {
    const key = metricSetKey(metrics);
    const cached = cache.get(key);
    if (cached) return cached;
    const result = evaluateSet(seeds, [...metrics].sort() as ReadinessMetricKey[]);
    cache.set(key, result);
    return result;
  };
  const steps: ReadinessForwardStep[] = [];
  let current: ReadinessMetricKey[] = [];
  let currentResult = baseResult;
  for (;;) {
    const additions = READINESS_METRIC_KEYS.filter((metric) => !current.includes(metric));
    let best: {
      metric: ReadinessMetricKey;
      metrics: ReadinessMetricKey[];
      result: ReadinessMetricSetResult;
      paired: ReadinessPairedComparison | null;
      maeImprovementSeconds: number;
    } | null = null;
    for (const metric of additions) {
      const metrics = [...current, metric].sort() as ReadinessMetricKey[];
      const result = evaluate(metrics);
      const paired = compareAgainstIncumbent(seeds, current, metrics);
      const gate = evaluateReadinessPromotionGate(currentResult, result, paired, policy);
      if (!gate.passed) continue;
      const maeImprovementSeconds = (currentResult.summary?.meanAbsoluteErrorSeconds ?? 0)
        - (result.summary?.meanAbsoluteErrorSeconds ?? 0);
      if (!best || maeImprovementSeconds > best.maeImprovementSeconds) {
        best = { metric, metrics, result, paired, maeImprovementSeconds };
      }
    }
    if (!best) break;
    const step = steps.length + 1;
    steps.push({
      step,
      metric: best.metric,
      metrics: best.metrics,
      maeImprovementSeconds: Math.round(best.maeImprovementSeconds * 10) / 10,
      relativeMaeImprovement: best.result.meanActualSeconds > 0
        ? Math.round(best.maeImprovementSeconds / best.result.meanActualSeconds * 10000) / 100
        : 0,
      medianImproved: best.paired !== null
        && (best.paired.changedCandidateMedianAbsoluteErrorPercent ?? Number.POSITIVE_INFINITY)
          < (best.paired.changedIncumbentMedianAbsoluteErrorPercent ?? Number.NEGATIVE_INFINITY),
      wins: best.paired?.comparison.candidateWins ?? 0,
      ties: best.paired?.comparison.ties ?? 0,
      losses: best.paired?.comparison.baseWins ?? 0,
      coverageShare: best.result.coverageShare,
    });
    current = best.metrics;
    currentResult = best.result;
  }
  return { steps, promoted: [...current] };
}

function evaluateHeldOutFolds(input: {
  subjects: ReadinessValidationSubject[];
  lookbackDays: number;
  horizons: readonly number[];
  policy: ReadinessPromotionPolicy;
}): ReadinessAthleteHeldOut {
  const { subjects, lookbackDays, horizons, policy } = input;
  if (subjects.length < policy.minSubjectsForHoldout) {
    return {
      available: false,
      folds: [],
      improvedFoldShare: null,
      medianFoldMaeImprovementSeconds: null,
      validated: false,
    };
  }
  const folds: ReadinessAthleteFold[] = [];
  for (const heldOut of subjects) {
    const trainingSubjects = subjects.filter((subject) => subject.athleteId !== heldOut.athleteId);
    const trainingSeeds = trainingSubjects.flatMap((subject) => buildPairSeeds(subject, lookbackDays, horizons));
    if (trainingSeeds.length === 0) continue;
    const trainingCache = new Map<string, ReadinessMetricSetResult>();
    const base = evaluateSet(trainingSeeds, []);
    trainingCache.set(metricSetKey([]), base);
    const { promoted } = runForwardSelection({ seeds: trainingSeeds, policy, baseResult: base, cache: trainingCache });

    const heldOutSeeds = buildPairSeeds(heldOut, lookbackDays, horizons);
    if (heldOutSeeds.length === 0) continue;
    const heldOutBase = evaluateSet(heldOutSeeds, []);
    const heldOutCandidate = evaluateSet(heldOutSeeds, promoted);
    const paired = compareAgainstIncumbent(heldOutSeeds, [], promoted);
    folds.push({
      heldOutAthleteId: heldOut.athleteId,
      selectedMetrics: promoted,
      heldOutComparisons: heldOutSeeds.length,
      heldOutMaeImprovementSeconds: heldOutBase.summary && heldOutCandidate.summary
        ? Math.round((heldOutBase.summary.meanAbsoluteErrorSeconds - heldOutCandidate.summary.meanAbsoluteErrorSeconds) * 10) / 10
        : null,
      heldOutRelativeMaeImprovement: heldOutBase.meanActualSeconds > 0
        && heldOutBase.summary && heldOutCandidate.summary
        ? Math.round(
            (heldOutBase.summary.meanAbsoluteErrorSeconds - heldOutCandidate.summary.meanAbsoluteErrorSeconds)
            / heldOutBase.meanActualSeconds * 10000,
          ) / 100
        : null,
      heldOutMedianImproved: heldOutBase.summary !== null && heldOutCandidate.summary !== null
        && heldOutCandidate.summary.medianAbsoluteErrorPercent < heldOutBase.summary.medianAbsoluteErrorPercent,
      heldOutWins: paired?.comparison.candidateWins ?? 0,
      heldOutLosses: paired?.comparison.baseWins ?? 0,
    });
  }
  const improvements = folds
    .map((fold) => fold.heldOutMaeImprovementSeconds)
    .filter((value): value is number => value !== null);
  const improvedFolds = improvements.filter((value) => value > 0).length;
  const improvedFoldShare = improvements.length > 0 ? improvedFolds / improvements.length : null;
  const medianFoldMaeImprovementSeconds = improvements.length > 0 ? median(improvements) : null;
  return {
    available: folds.length > 0,
    folds,
    improvedFoldShare,
    medianFoldMaeImprovementSeconds,
    validated: folds.length > 0
      && improvedFoldShare !== null
      && improvedFoldShare >= 0.5
      && (medianFoldMaeImprovementSeconds ?? 0) > 0,
  };
}

/**
 * Runs the full validation: pairwise ranking with the rolling-origin race
 * backtest, forward selection under the promotion policy, and leave-one-
 * athlete-out folds when at least two athletes have race history.
 */
export function evaluateReadinessMetrics(input: ReadinessValidationInput): ReadinessMetricsReport {
  const lookbackDays = input.lookbackDays ?? 112;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 28) {
    throw new Error("lookbackDays must be an integer of at least 28");
  }
  const horizons = input.horizons ?? READINESS_VALIDATION_HORIZONS;
  const policy: ReadinessPromotionPolicy = {
    ...DEFAULT_READINESS_PROMOTION_POLICY,
    ...input.policy,
  };
  const subjects = input.subjects
    .map((subject) => ({
      athleteId: subject.athleteId,
      activities: subject.activities.filter((activity) => activity.localDate <= input.asOf),
    }))
    .filter((subject) => subject.activities.some((activity) => activity.eventType === "race"));

  const seeds = subjects.flatMap((subject) => buildPairSeeds(subject, lookbackDays, horizons));
  const cache = new Map<string, ReadinessMetricSetResult>();
  const evaluate = (metrics: readonly ReadinessMetricKey[]): ReadinessMetricSetResult => {
    const key = metricSetKey(metrics);
    const cached = cache.get(key);
    if (cached) return cached;
    const result = evaluateSet(seeds, [...metrics].sort() as ReadinessMetricKey[]);
    cache.set(key, result);
    return result;
  };

  const base = evaluate([]);
  const baseMae = base.summary?.meanAbsoluteErrorSeconds ?? Number.POSITIVE_INFINITY;
  const ranked = READINESS_METRIC_KEYS.map((metric) => {
    const standalone = evaluate([metric]);
    const gate = evaluateReadinessPromotionGate(
      base,
      standalone,
      compareAgainstIncumbent(seeds, [], [metric]),
      policy,
    );
    const maeImprovementSeconds = baseMae - (standalone.summary?.meanAbsoluteErrorSeconds ?? Number.NEGATIVE_INFINITY);
    return {
      metric,
      label: READINESS_METRIC_LABELS[metric],
      definition: READINESS_METRIC_DEFINITIONS[metric],
      coverageShare: Math.round(standalone.coverageShare * 1000) / 1000,
      eligible: standalone.coverageShare >= policy.minCoverageShare,
      standalone,
      maeImprovementSeconds,
      relativeMaeImprovement: standalone.meanActualSeconds > 0
        ? maeImprovementSeconds / standalone.meanActualSeconds * 100
        : 0,
      passed: gate.passed,
      reasons: gate.reasons,
    };
  });
  const promotedOrder = ranked
    .filter((entry) => entry.passed)
    .sort((left, right) => right.maeImprovementSeconds - left.maeImprovementSeconds);
  const rankByMetric = new Map(promotedOrder.map((entry, index) => [entry.metric, index + 1]));
  const ranking: ReadinessMetricRanking[] = ranked
    .map((entry): ReadinessMetricRanking => ({
      metric: entry.metric,
      label: entry.label,
      definition: entry.definition,
      coverageShare: entry.coverageShare,
      eligible: entry.eligible,
      rank: rankByMetric.get(entry.metric) ?? null,
      promotion: entry.passed ? "promoted" : "rejected",
      standalone: entry.standalone,
      maeImprovementSeconds: Math.round(entry.maeImprovementSeconds * 10) / 10,
      relativeMaeImprovement: Math.round(entry.relativeMaeImprovement * 100) / 100,
      reasons: entry.reasons,
    }))
    .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER));

  const promoted = promotedOrder.map((entry) => entry.metric);
  const { steps, promoted: incrementalSelection } = runForwardSelection({ seeds, policy, baseResult: base, cache });
  const rejected = READINESS_METRIC_KEYS.filter((metric) => !promoted.includes(metric));
  const athleteHeldOut = evaluateHeldOutFolds({
    subjects,
    lookbackDays,
    horizons,
    policy,
  });

  const warnings: string[] = [];
  if (subjects.length < policy.minSubjectsForHoldout) {
    warnings.push(
      `Athlete-held-out validation is unavailable with ${subjects.length} athlete(s) of race history; `
      + "promoted metrics are provisional and must not be described as cross-athlete validated.",
    );
  } else if (!athleteHeldOut.validated) {
    warnings.push("Athlete-held-out folds did not confirm the promoted set; treat the promotion as rejected.");
  }
  const ineligible = ranking.filter((entry) => !entry.eligible).map((entry) => entry.metric);
  if (ineligible.length > 0) {
    warnings.push(`Metrics without usable coverage: ${ineligible.join(", ")}.`);
  }
  const redundant = promoted.filter((metric) => !incrementalSelection.includes(metric));
  if (redundant.length > 0) {
    warnings.push(
      `Promoted metrics that added no incremental signal after stepwise selection (correlated): ${redundant.join(", ")}.`,
    );
  }
  if (base.comparisons < policy.minComparisons) {
    warnings.push(
      `Only ${base.comparisons} common comparisons; the policy needs ${policy.minComparisons} to promote any metric.`,
    );
  }
  warnings.push(
    "The candidate effects are fixed and unfitted; validation decides promotion, never a fitted coefficient.",
  );

  return {
    version: READINESS_METRICS_VERSION,
    asOf: input.asOf,
    lookbackDays,
    horizons,
    policy,
    subjects: subjects.length,
    races: subjects.reduce((sum, subject) => sum + validRaces(subject.activities).length, 0),
    pairs: seeds.length,
    base,
    ranking,
    forwardSelection: steps,
    promoted,
    incrementalSelection,
    rejected,
    athleteHeldOut,
    warnings,
  };
}

export type ReadinessPromotionTier = "validated" | "provisional" | "rejected";

export interface ReadinessMetricPromotion {
  key: ReadinessMetricKey;
  label: string;
  definition: string;
  tier: ReadinessPromotionTier;
  /** Frozen summary of the validation run that produced this tier. */
  evidence: string;
}

/**
 * Metrics the plan-vs-actual beacon may highlight. `validated` passed both
 * rolling-origin and athlete-held-out folds; `provisional` passed the
 * rolling-origin backtest but no athlete-held-out fold exists yet. A
 * `rejected` metric must never be presented as an impact driver.
 *
 * Regenerate this table with `npm run readiness:validate` after any change to
 * features or effects; do not edit it from intuition.
 */
export const READINESS_METRIC_PROMOTIONS: readonly ReadinessMetricPromotion[] = [
  {
    key: "long_run",
    label: READINESS_METRIC_LABELS.long_run,
    definition: READINESS_METRIC_DEFINITIONS.long_run,
    tier: "provisional",
    evidence: "readiness-metrics-v1 run 2026-09-28, 34 rolling-origin pairs: MAE 5:18 vs 5:31 base "
      + "(-14 s, 0.19%), RMSE 7:11 vs 7:28, bias +1:55, 7 wins / 4 losses. No athlete-held-out fold yet.",
  },
  {
    key: "volume",
    label: READINESS_METRIC_LABELS.volume,
    definition: READINESS_METRIC_DEFINITIONS.volume,
    tier: "provisional",
    evidence: "readiness-metrics-v1 run 2026-09-28, 34 rolling-origin pairs: MAE 5:20 vs 5:31 base "
      + "(-11 s, 0.15%), RMSE 7:10 vs 7:28, bias +1:45, 11 wins / 6 losses. No athlete-held-out fold yet.",
  },
  {
    key: "consistency",
    label: READINESS_METRIC_LABELS.consistency,
    definition: READINESS_METRIC_DEFINITIONS.consistency,
    tier: "rejected",
    evidence: "readiness-metrics-v1 run 2026-09-28: MAE 2 s worse than the base with 9 wins / 8 losses; "
      + "not enough improvement to earn a place.",
  },
  {
    key: "hr_effort",
    label: READINESS_METRIC_LABELS.hr_effort,
    definition: READINESS_METRIC_DEFINITIONS.hr_effort,
    tier: "rejected",
    evidence: "readiness-metrics-v1 run 2026-09-28 (94% coverage): MAE 14 s worse than the base, 3 wins / 13 "
      + "losses, marathon-only MAE 36 s worse. The fixed marathon-effort sensitivity hurts this athlete's backtest.",
  },
  {
    key: "power_effort",
    label: READINESS_METRIC_LABELS.power_effort,
    definition: READINESS_METRIC_DEFINITIONS.power_effort,
    tier: "rejected",
    evidence: "readiness-metrics-v1 run 2026-09-28: no stored plan carries power zones (0% coverage), so the "
      + "metric cannot be computed or validated. Re-run readiness:validate after power zones exist.",
  },
];

/**
 * The whitelist for plan-vs-actual impact beacons: validated and provisional
 * metrics only. Rejected metrics are omitted and must not be rendered as
 * impact reasons even when the plan differs on them.
 */
export function beaconReadinessMetrics(): ReadinessMetricKey[] {
  return READINESS_METRIC_PROMOTIONS
    .filter((promotion) => promotion.tier !== "rejected")
    .map((promotion) => promotion.key);
}

/** Recomputes tiers from a fresh report; used to refresh the frozen table. */
export function readinessPromotionTiers(report: ReadinessMetricsReport): Record<ReadinessMetricKey, ReadinessPromotionTier> {
  return Object.fromEntries(READINESS_METRIC_KEYS.map((metric) => {
    if (!report.promoted.includes(metric)) return [metric, "rejected"];
    return [metric, report.athleteHeldOut.available
      ? (report.athleteHeldOut.validated ? "validated" : "rejected")
      : "provisional"];
  })) as Record<ReadinessMetricKey, ReadinessPromotionTier>;
}