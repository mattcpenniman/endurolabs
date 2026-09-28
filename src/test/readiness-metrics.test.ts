// ============================================================
// EnduroLab — Readiness Metric Validation Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildRaceTrainingFeatures,
  computeReadinessAdjustment,
  type RaceAnalysisActivity,
  type RaceBaselineSummary,
  type RaceTrainingFeatures,
  type RaceTrainingReference,
} from "@/lib/analytics/race-performance-analysis";
import {
  beaconReadinessMetrics,
  evaluateReadinessMetrics,
  evaluateReadinessPromotionGate,
  readinessPromotionTiers,
  type ReadinessMetricSetResult,
  type ReadinessPairedComparison,
} from "@/lib/analytics/readiness-metrics";
import type { TimeAtEffortSummary } from "@/lib/analytics/time-at-effort";

const METERS_PER_MILE = 1609.344;
const MARATHON = 42_195;

function activity(overrides: Partial<RaceAnalysisActivity> = {}): RaceAnalysisActivity {
  return {
    id: "run-1",
    localDate: "2026-04-01",
    distanceMeters: 10 * METERS_PER_MILE,
    durationSeconds: 3600,
    movingDurationSeconds: 3550,
    eventType: null,
    averageHeartRate: 145,
    averagePower: null,
    calculatedPower: null,
    elevationGainMeters: 100,
    excludedFromAnalytics: false,
    ...overrides,
  };
}

function effort(secondsByZone: Partial<Record<string, number>>): TimeAtEffortSummary {
  const zoneSeconds = (zone: string) => secondsByZone[zone] ?? 0;
  const buckets = ["recovery", "easy", "marathon", "threshold", "vo2"].map((zone) => ({
    zone: zone as "recovery" | "easy" | "marathon" | "threshold" | "vo2",
    seconds: zoneSeconds(zone),
  }));
  const totalSeconds = buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
  return {
    durationSeconds: totalSeconds,
    heartRate: { totalSeconds, unclassifiedSeconds: 0, buckets },
    power: { totalSeconds: 0, unclassifiedSeconds: 0, buckets: buckets.map((bucket) => ({ ...bucket, seconds: 0 })) },
  };
}

function race(id: string, date: string, durationSeconds: number, distanceMeters = MARATHON): RaceAnalysisActivity {
  return activity({
    id,
    localDate: date,
    distanceMeters,
    durationSeconds,
    eventType: "race",
  });
}

function run(id: string, date: string, miles: number, longestZone = "easy"): RaceAnalysisActivity {
  return activity({
    id,
    localDate: date,
    distanceMeters: miles * METERS_PER_MILE,
    durationSeconds: Math.round(miles * 480),
    timeAtEffort: effort({ [longestZone]: Math.round(miles * 480) }),
  });
}

describe("effort training features", () => {
  it("counts only marathon-or-faster effort minutes and tracks coverage runs", () => {
    const features = buildRaceTrainingFeatures([
      activity({
        id: "interval",
        localDate: "2026-04-01",
        timeAtEffort: effort({ easy: 600, marathon: 300, threshold: 240, vo2: 60 }),
      }),
      activity({
        id: "easy-only",
        localDate: "2026-04-02",
        timeAtEffort: effort({ recovery: 1800, easy: 1200 }),
      }),
      activity({ id: "no-detail", localDate: "2026-04-03" }),
    ], "2026-05-01", 112);

    expect(features.hrEffortMinutes).toBe(10);
    expect(features.hrEffortRuns).toBe(2);
    expect(features.powerEffortMinutes).toBe(0);
    expect(features.powerEffortRuns).toBe(0);
    expect(features.hrEffortMinutesPerWeek).toBeCloseTo(10 / 16, 1);
  });

  it("excludes effort detail on and after the prediction date and on training-excluded rows", () => {
    const features = buildRaceTrainingFeatures([
      activity({ id: "before", localDate: "2026-04-01", timeAtEffort: effort({ marathon: 600 }) }),
      activity({ id: "same-day", localDate: "2026-05-01", timeAtEffort: effort({ marathon: 600 }) }),
      activity({ id: "future", localDate: "2026-05-02", timeAtEffort: effort({ marathon: 600 }) }),
      activity({
        id: "canonical",
        localDate: "2026-04-10",
        trainingExcluded: true,
        timeAtEffort: effort({ marathon: 600 }),
      }),
    ], "2026-05-01", 112);

    expect(features.hrEffortMinutes).toBe(10);
    expect(features.hrEffortRuns).toBe(1);
  });
});

describe("computeReadinessAdjustment", () => {
  const target: RaceTrainingFeatures = {
    lookbackDays: 112,
    runs: 80,
    miles: 700,
    milesLast7Days: 50,
    milesLast28Days: 190,
    milesLast56Days: 380,
    milesLast84Days: 560,
    milesLast112Days: 700,
    durationHoursLast7Days: 7,
    durationHoursLast28Days: 27,
    durationHoursLast56Days: 54,
    durationHoursLast84Days: 80,
    durationHoursLast112Days: 100,
    activeWeeks: 16,
    missingWeeks: 0,
    averageWeeklyMiles: 44,
    peakWeeklyMiles: 55,
    weeklyMileageCoefficientOfVariation: 0.2,
    runFrequencyPerWeek: 5,
    longestTrainingGapDays: 2,
    longestRunMiles: 20,
    longestRunMilesLast28Days: 20,
    longestRunMilesLast56Days: 20,
    longestRunMilesLast112Days: 20,
    runsAtLeast12Miles: 8,
    runsAtLeast14Miles: 6,
    runsAtLeast16Miles: 4,
    runsAtLeast18Miles: 2,
    runsAtLeast20Miles: 1,
    longestRunDurationHours: 2.7,
    longestRunSharePercent: 3,
    taperRatio7ToPrior28: 1,
    taperRatio14ToPrior42: 1,
    elevationGainMeters: 1000,
    averageHeartRate: 145,
    measuredPowerRuns: 0,
    calculatedPowerRuns: 0,
    hrEffortMinutes: 900,
    hrEffortMinutesPerWeek: 56,
    hrEffortRuns: 80,
    powerEffortMinutes: 0,
    powerEffortMinutesPerWeek: 0,
    powerEffortRuns: 0,
  };
  const reference: RaceTrainingReference = {
    weeklyMiles56Days: 40,
    longestRunMiles: 16,
    activeWeekShare: 0.8,
    hrEffortMinutesPerWeek: 30,
    powerEffortMinutesPerWeek: 0,
  };

  it("applies only the requested metrics and signs larger readiness faster", () => {
    const volume = computeReadinessAdjustment({
      targetTraining: target,
      referenceTraining: reference,
      targetDistanceMeters: MARATHON,
      metrics: ["volume"],
    });
    expect(volume.effects.volume).toBeLessThan(0);
    expect(volume.effects.long_run).toBe(0);
    expect(volume.effects.hr_effort).toBe(0);

    const effortOnly = computeReadinessAdjustment({
      targetTraining: target,
      referenceTraining: reference,
      targetDistanceMeters: MARATHON,
      metrics: ["hr_effort"],
    });
    expect(effortOnly.effects.hr_effort).toBeLessThan(0);
    expect(effortOnly.effects.volume).toBe(0);
  });

  it("returns no adjustment for short races and attenuates at long horizons", () => {
    const fiveK = computeReadinessAdjustment({
      targetTraining: target,
      referenceTraining: reference,
      targetDistanceMeters: 5000,
      metrics: ["hr_effort", "volume", "long_run", "consistency"],
    });
    expect(fiveK.logAdjustment).toBe(0);
    expect(fiveK.readinessRelevance).toBe(1);

    const twelveWeeks = computeReadinessAdjustment({
      targetTraining: target,
      referenceTraining: reference,
      targetDistanceMeters: MARATHON,
      forecastHorizonDays: 84,
      metrics: ["hr_effort"],
    });
    expect(twelveWeeks.readinessRelevance).toBe(0);
  });
});

function summary(meanAbsoluteErrorSeconds: number, medianAbsoluteErrorPercent: number): RaceBaselineSummary {
  return {
    comparisons: 20,
    meanAbsoluteErrorSeconds,
    meanAbsoluteErrorPercent: 5,
    rootMeanSquaredErrorSeconds: meanAbsoluteErrorSeconds * 1.2,
    biasSeconds: 0,
    medianAbsoluteErrorPercent,
    maxAbsoluteErrorPercent: 12,
  };
}

function metricSet(overrides: Partial<ReadinessMetricSetResult> = {}): ReadinessMetricSetResult {
  return {
    metrics: [],
    comparisons: 20,
    meanActualSeconds: 10_000,
    summary: summary(300, 3),
    comparison: null,
    marathon: summary(300, 3),
    marathonMeanActualSeconds: 12_000,
    horizons: [],
    coverageShare: 1,
    ...overrides,
  };
}

function paired(overrides: Partial<ReadinessPairedComparison> = {}): ReadinessPairedComparison {
  return {
    comparison: {
      commonComparisons: 20,
      candidateWins: 8,
      ties: 8,
      baseWins: 4,
      candidateImprovedMae: true,
      candidateImprovedMedianAbsoluteError: true,
    },
    changedComparisons: 12,
    changedIncumbentMedianAbsoluteErrorPercent: 3,
    changedCandidateMedianAbsoluteErrorPercent: 2,
    ...overrides,
  };
}

describe("readiness promotion gate", () => {
  const incumbent = metricSet();

  it("passes a metric that improves MAE, changed-pair median, and wins", () => {
    const candidate = metricSet({ summary: summary(280, 2.8) });
    expect(evaluateReadinessPromotionGate(incumbent, candidate, paired(), {
      minComparisons: 8,
      minRelativeMaeImprovement: 0.0015,
      maxRelativeMarathonRegression: 0.001,
      requireChangedMedianImprovement: true,
      requireWinsOverLosses: true,
      minCoverageShare: 0.5,
      minSubjectsForHoldout: 2,
    }).passed).toBe(true);
  });

  it("rejects noise, low coverage, losing records, and marathon regressions", () => {
    const policy = {
      minComparisons: 8,
      minRelativeMaeImprovement: 0.0015,
      maxRelativeMarathonRegression: 0.001,
      requireChangedMedianImprovement: true,
      requireWinsOverLosses: true,
      minCoverageShare: 0.5,
      minSubjectsForHoldout: 2,
    };
    const noImprovement = evaluateReadinessPromotionGate(incumbent, metricSet(), paired(), policy);
    expect(noImprovement.passed).toBe(false);
    expect(noImprovement.reasons.join(" ")).toContain("MAE improvement");

    const noCoverage = evaluateReadinessPromotionGate(
      incumbent,
      metricSet({ summary: summary(280, 2), coverageShare: 0.1 }),
      paired(),
      policy,
    );
    expect(noCoverage.reasons.join(" ")).toContain("coverage");

    const losing = evaluateReadinessPromotionGate(
      incumbent,
      metricSet({ summary: summary(280, 2) }),
      paired({ comparison: { ...paired().comparison, candidateWins: 3, baseWins: 9 } }),
      policy,
    );
    expect(losing.reasons.join(" ")).toContain("wins 3 vs losses 9");

    const medianFlat = evaluateReadinessPromotionGate(
      incumbent,
      metricSet({ summary: summary(280, 2) }),
      paired({ changedCandidateMedianAbsoluteErrorPercent: 3.5 }),
      policy,
    );
    expect(medianFlat.reasons.join(" ")).toContain("median absolute error");

    const marathonRegression = evaluateReadinessPromotionGate(
      incumbent,
      metricSet({ summary: summary(280, 2), marathon: summary(400, 3) }),
      paired(),
      policy,
    );
    expect(marathonRegression.reasons.join(" ")).toContain("marathon-only MAE regressed");
  });
});

describe("readiness metric validation", () => {
  /** Race evidence stays at a steady volume while the long run ramps and
   *  finish times improve in the same direction, so long-run should be the
   *  only metric that earns its place. */
  function longRunRampAthlete(prefix: string, startDate: string): RaceAnalysisActivity[] {
    const activities: RaceAnalysisActivity[] = [];
    const day = 86_400_000;
    const at = (offsetDays: number) => new Date(Date.parse(`${startDate}T00:00:00Z`) + offsetDays * day)
      .toISOString().slice(0, 10);
    const races: Array<{ index: number; date: string }> = [];
    let previousSeconds = 12_600;
    for (let index = 0; index < 10; index += 1) {
      const raceDate = at(index * 28);
      const seconds = index === 0 ? previousSeconds : Math.round(previousSeconds * 0.995);
      // Canonical-result style: race evidence is excluded from training features.
      activities.push({ ...race(`${prefix}-race-${index}`, raceDate, seconds), trainingExcluded: true });
      races.push({ index, date: raceDate });
      previousSeconds = seconds;
    }
    const lastRaceOffset = (races.length - 1) * 28;
    for (let offsetDays = -120; offsetDays <= lastRaceOffset; offsetDays += 2) {
      if (races.some((entry) => entry.date === at(offsetDays))) continue;
      activities.push(run(`${prefix}-easy-${offsetDays + 120}`, at(offsetDays), 10));
    }
    for (let offsetDays = -98; offsetDays <= lastRaceOffset; offsetDays += 14) {
      const miles = 13 + ((offsetDays + 98) / 14) * 0.3;
      activities.push(run(`${prefix}-long-${offsetDays + 98}`, at(offsetDays), miles, "easy"));
    }
    return activities;
  }

  it("ranks a long-run signal above noise metrics and keeps the rejected ones out of the beacon", () => {
    const report = evaluateReadinessMetrics({
      subjects: [{ athleteId: "athlete-a", activities: longRunRampAthlete("a", "2025-01-04") }],
      asOf: "2025-12-31",
    });

    expect(report.subjects).toBe(1);
    expect(report.promoted).toContain("long_run");
    expect(report.promoted).not.toContain("consistency");
    expect(report.ranking.find((entry) => entry.metric === "long_run")?.rank).toBe(1);
    expect(report.ranking.find((entry) => entry.metric === "long_run")?.promotion).toBe("promoted");
    expect(report.athleteHeldOut.available).toBe(false);
    expect(report.warnings.join(" ")).toContain("Athlete-held-out validation is unavailable");
  });

  it("confirms promoted metrics with athlete-held-out folds when two athletes exist", () => {
    const report = evaluateReadinessMetrics({
      subjects: [
        { athleteId: "athlete-a", activities: longRunRampAthlete("a", "2025-01-04") },
        { athleteId: "athlete-b", activities: longRunRampAthlete("b", "2025-01-04") },
      ],
      asOf: "2025-12-31",
    });

    expect(report.athleteHeldOut.available).toBe(true);
    expect(report.athleteHeldOut.folds).toHaveLength(2);
    expect(report.athleteHeldOut.improvedFoldShare).toBe(1);
    expect(report.athleteHeldOut.validated).toBe(true);
    const tiers = readinessPromotionTiers(report);
    expect(tiers.long_run).toBe("validated");
    expect(beaconReadinessMetrics()).not.toContain("consistency");
  });

  it("does not promote any metric on a flat athlete and respects the as-of cutoff", () => {
    const flat = Array.from({ length: 8 }, (_, index) => race(
      `flat-${index}`,
      new Date(Date.parse("2025-01-04T00:00:00Z") + index * 28 * 86_400_000).toISOString().slice(0, 10),
      12_600,
    ));
    const report = evaluateReadinessMetrics({
      subjects: [{ athleteId: "flat", activities: flat }],
      asOf: "2025-08-01",
    });
    expect(report.promoted).toEqual([]);
    expect(report.pairs).toBeGreaterThan(0);

    const ignored = evaluateReadinessMetrics({
      subjects: [{
        athleteId: "flat",
        activities: [...flat, run("future-run", "2025-09-01", 15, "threshold")],
      }],
      asOf: "2025-08-01",
    });
    expect(ignored.pairs).toBe(report.pairs);
    expect(ignored.base.summary).toEqual(report.base.summary);
  });

  it("exposes the frozen promotion table and whitelist helper consistently", () => {
    expect(beaconReadinessMetrics()).toEqual(["long_run", "volume"]);
  });
});