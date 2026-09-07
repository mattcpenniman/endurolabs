// ============================================================
// EnduroLab - Race Performance Analysis Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  analyzeRacePerformance,
  buildRaceForecast,
  buildRacePlanFeatures,
  buildRaceTrainingFeatures,
  buildTrainingAdjustedRaceForecast,
  predictEquivalentRaceSeconds,
  type RaceAnalysisActivity,
  type RaceAnalysisPlan,
} from "@/lib/analytics/race-performance-analysis";

const METERS_PER_MILE = 1609.344;

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

function plan(overrides: Partial<RaceAnalysisPlan> = {}): RaceAnalysisPlan {
  return {
    id: "plan-1",
    raceName: "Goal Marathon",
    raceDate: "2026-05-01",
    raceDistanceMeters: 42_195,
    goalSeconds: 10_800,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    plannedRuns: [
      { date: "2026-03-01", miles: 10, workoutType: "easy" },
      { date: "2026-04-15", miles: 18, workoutType: "long" },
      { date: "2026-05-01", miles: 26.2, workoutType: "marathon_pace" },
    ],
    logs: [
      { date: "2026-03-01", completed: true, actualMiles: 10, loggedAt: "2026-03-01T12:00:00.000Z" },
      { date: "2026-04-15", completed: true, actualMiles: 17, loggedAt: "2026-05-02T12:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("race performance analysis", () => {
  it("uses Riegel race equivalence for the transparent baseline", () => {
    const prediction = predictEquivalentRaceSeconds(3600, 10_000, 20_000);
    expect(prediction).toBeCloseTo(3600 * 2 ** 1.06, 8);
  });

  it("weights distance relevance enough to preserve marathon evidence", () => {
    const forecast = buildRaceForecast([
      activity({
        id: "marathon",
        localDate: "2026-01-01",
        distanceMeters: 42_195,
        durationSeconds: 11_400,
        eventType: "race",
      }),
      activity({
        id: "recent-5k",
        localDate: "2026-04-01",
        distanceMeters: 5000,
        durationSeconds: 1200,
        eventType: "race",
      }),
    ], "2026-05-01", 42_195);

    expect(forecast?.predictedSeconds).toBe(11_400);
    expect(forecast?.evidence[0].raceId).toBe("marathon");
    expect(forecast?.weightedMeanSeconds).toBeGreaterThan(11_400);
  });

  it("excludes same-day, future, stale, and non-standard source races", () => {
    const forecast = buildRaceForecast([
      activity({ id: "valid", localDate: "2026-01-01", distanceMeters: 10_000, eventType: "race" }),
      activity({ id: "same-day", localDate: "2026-05-01", eventType: "race" }),
      activity({ id: "future", localDate: "2026-06-01", eventType: "race" }),
      activity({ id: "stale", localDate: "2020-01-01", eventType: "race" }),
      activity({ id: "short", localDate: "2026-02-01", distanceMeters: 3000, eventType: "race" }),
    ], "2026-05-01", 21_097.5);

    expect(forecast?.evidence.map((item) => item.raceId)).toEqual(["valid"]);
  });

  it("builds training features strictly before the prediction date", () => {
    const features = buildRaceTrainingFeatures([
      activity({ id: "included", localDate: "2026-04-01", averagePower: 300 }),
      activity({ id: "modeled", localDate: "2026-04-15", calculatedPower: 290 }),
      activity({ id: "race-day", localDate: "2026-05-01", distanceMeters: 42_195 }),
      activity({ id: "excluded", localDate: "2026-04-20", excludedFromAnalytics: true }),
      activity({ id: "old", localDate: "2025-12-01" }),
    ], "2026-05-01", 112);

    expect(features.runs).toBe(2);
    expect(features.miles).toBe(20);
    expect(features.measuredPowerRuns).toBe(1);
    expect(features.calculatedPowerRuns).toBe(1);
  });

  it("does not double-count canonical outcome-only rows as training", () => {
    const features = buildRaceTrainingFeatures([
      activity({ id: "garmin-race", localDate: "2026-04-01", eventType: null }),
      activity({ id: "official-result", localDate: "2026-04-01", eventType: "race", trainingExcluded: true }),
    ], "2026-05-01", 112);
    expect(features.runs).toBe(1);
    expect(features.miles).toBe(10);
  });

  it("builds fixed trailing windows, consistency, long-run, and taper features", () => {
    const activities = [
      activity({ id: "day-1", localDate: "2026-04-30", distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 1800 }),
      activity({ id: "day-7", localDate: "2026-04-24", distanceMeters: 20 * METERS_PER_MILE, durationSeconds: 7200 }),
      activity({ id: "day-8", localDate: "2026-04-23", distanceMeters: 10 * METERS_PER_MILE }),
      activity({ id: "day-35", localDate: "2026-03-27", distanceMeters: 10 * METERS_PER_MILE }),
      activity({ id: "day-56", localDate: "2026-03-06", distanceMeters: 10 * METERS_PER_MILE }),
      activity({ id: "day-112", localDate: "2026-01-09", distanceMeters: 10 * METERS_PER_MILE }),
    ];
    const features = buildRaceTrainingFeatures(activities, "2026-05-01", 112);
    expect(features.milesLast7Days).toBe(25);
    expect(features.milesLast28Days).toBe(35);
    expect(features.milesLast56Days).toBe(55);
    expect(features.milesLast112Days).toBe(65);
    expect(features.longestRunMilesLast28Days).toBe(20);
    expect(features.runsAtLeast12Miles).toBe(1);
    expect(features.runsAtLeast20Miles).toBe(1);
    expect(features.longestRunDurationHours).toBe(2);
    expect(features.activeWeeks).toBeLessThanOrEqual(16);
    expect(features.taperRatio7ToPrior28).toBe(5);
    expect(features.taperRatio14ToPrior42).toBe(5.25);
  });

  it("uses no training adjustment for 5K and bounded durability effects for marathons", () => {
    const sourceRace = activity({
      id: "source-race",
      localDate: "2025-09-01",
      distanceMeters: 10_000,
      durationSeconds: 2400,
      eventType: "race",
    });
    const recentTraining = Array.from({ length: 8 }, (_, index) => activity({
      id: `recent-${index}`,
      localDate: `2025-12-${String(index + 1).padStart(2, "0")}`,
      distanceMeters: index === 7 ? 20 * METERS_PER_MILE : 10 * METERS_PER_MILE,
    }));
    const activities = [sourceRace, ...recentTraining];
    const fiveK = buildTrainingAdjustedRaceForecast(activities, [sourceRace], "2026-01-01", 5000);
    const marathon = buildTrainingAdjustedRaceForecast(activities, [sourceRace], "2026-01-01", 42_195);

    expect(fiveK?.adjustmentPercent).toBe(0);
    expect(fiveK?.predictedSeconds).toBe(fiveK?.baseForecast.predictedSeconds);
    expect(marathon?.adjustmentPercent).toBeLessThan(0);
    expect(marathon?.adjustmentPercent).toBeGreaterThanOrEqual(-10);
    expect(marathon?.predictedSeconds).toBeLessThan(marathon?.baseForecast.predictedSeconds ?? 0);
  });

  it("does not let same-day or future training alter a candidate", () => {
    const sourceRace = activity({ id: "source", localDate: "2025-01-01", eventType: "race" });
    const base = buildTrainingAdjustedRaceForecast([sourceRace], [sourceRace], "2026-01-01", 42_195);
    const withFuture = buildTrainingAdjustedRaceForecast([
      sourceRace,
      activity({ id: "same-day", localDate: "2026-01-01", distanceMeters: 30 * METERS_PER_MILE }),
      activity({ id: "future", localDate: "2026-01-02", distanceMeters: 30 * METERS_PER_MILE }),
    ], [sourceRace], "2026-01-01", 42_195);
    expect(withFuture).toEqual(base);
  });

  it("attenuates current readiness at longer forecast horizons", () => {
    const sourceRace = activity({ id: "source", localDate: "2025-01-01", eventType: "race" });
    const training = Array.from({ length: 10 }, (_, index) => activity({
      id: `training-${index}`,
      localDate: `2025-12-${String(index + 1).padStart(2, "0")}`,
      distanceMeters: 15 * METERS_PER_MILE,
    }));
    const raceDay = buildTrainingAdjustedRaceForecast(
      [sourceRace, ...training], [sourceRace], "2026-01-01", 42_195, 112, 0,
    );
    const twelveWeeks = buildTrainingAdjustedRaceForecast(
      [sourceRace, ...training], [sourceRace], "2026-01-01", 42_195, 112, 84,
    );
    expect(raceDay?.adjustmentPercent).not.toBe(0);
    expect(twelveWeeks?.adjustmentPercent).toBe(0);
    expect(twelveWeeks?.predictedSeconds).toBe(twelveWeeks?.baseForecast.predictedSeconds);
  });

  it("excludes logs recorded on or after the prediction date", () => {
    const features = buildRacePlanFeatures(plan(), "2026-05-01");
    expect(features.scheduledRuns).toBe(2);
    expect(features.scheduledMiles).toBe(28);
    expect(features.scheduledSpecificMiles).toBe(18);
    expect(features.loggedRuns).toBe(1);
    expect(features.loggedMiles).toBe(10);
    expect(features.workoutCompletionPercent).toBe(50);
    expect(features.mutableAfterPrediction).toBe(true);
  });

  it("backtests each race from prior data and creates current plan targets", () => {
    const firstRace = activity({
      id: "race-10k",
      localDate: "2025-10-01",
      distanceMeters: 10_000,
      durationSeconds: 3600,
      eventType: "race",
    });
    const secondRace = activity({
      id: "race-half",
      localDate: "2026-01-01",
      distanceMeters: 21_097.5,
      durationSeconds: 7800,
      eventType: "race",
    });
    const result = analyzeRacePerformance({
      activities: [firstRace, secondRace, activity({ localDate: "2026-04-01" })],
      plans: [plan()],
      asOf: "2026-04-20",
    });

    expect(result.historicalRaces).toHaveLength(2);
    expect(result.historicalRaces[0].baseline).toBeNull();
    expect(result.historicalRaces[1].baseline?.sourceRaceId).toBe("race-10k");
    expect(result.baselineSummary?.comparisons).toBe(1);
    expect(result.forecastSummary?.comparisons).toBe(1);
    expect(result.trainingAdjustedSummary?.comparisons).toBe(1);
    expect(result.trainingAdjustedComparison?.commonComparisons).toBe(1);
    expect(result.horizonEvaluations.map((evaluation) => evaluation.horizonDays)).toEqual([7, 28, 84]);
    expect(result.forecastComparison?.commonComparisons).toBe(1);
    expect(result.planTargets).toHaveLength(1);
    expect(result.planTargets[0].baseline?.sourceRaceId).toBe("race-half");
    expect(result.planTargets[0].training.runs).toBe(2);
    expect(result.planTargets[0].trainingAdjustedForecast?.modelVersion).toBe("race-training-readiness-v1");
  });

  it("enables the experimental Power @ 140 fitness effect only when fitnessEnabled", () => {
    const sourceRace = activity({ id: "source", localDate: "2025-10-01", distanceMeters: 42_195, durationSeconds: 12_600, eventType: "race" });
    const fitness = [
      { date: "2025-09-25", watts: 340, measured: true },
      { date: "2025-11-05", watts: 330, measured: true },
      { date: "2026-04-10", watts: 345, measured: true },
    ];
    const off = analyzeRacePerformance({
      activities: [sourceRace, activity({ localDate: "2026-04-01" })],
      plans: [plan()],
      asOf: "2026-04-20",
      fitness,
      fitnessEnabled: false,
    });
    const on = analyzeRacePerformance({
      activities: [sourceRace, activity({ localDate: "2026-04-01" })],
      plans: [plan()],
      asOf: "2026-04-20",
      fitness,
      fitnessEnabled: true,
    });
    expect(off.planTargets[0].trainingAdjustedForecast?.modelVersion).toBe("race-training-readiness-v1");
    expect(off.planTargets[0].trainingAdjustedForecast?.effects.fitnessPercent).toBe(0);
    expect(on.planTargets[0].trainingAdjustedForecast?.modelVersion).toBe("race-training-readiness-v2");
  });

  it("derives a historical-error range only from earlier rolling forecasts", () => {
    const races = Array.from({ length: 7 }, (_, index) => activity({
      id: `race-${index}`,
      localDate: `2025-0${index + 1}-01`,
      distanceMeters: 10_000,
      durationSeconds: 3600 + index * 30,
      eventType: "race",
    }));
    const result = analyzeRacePerformance({
      activities: races,
      plans: [plan({ createdAt: "2025-01-01T00:00:00.000Z" })],
      asOf: "2026-04-20",
    });

    expect(result.historicalRaces[5].forecast?.historicalErrorRange).toBeNull();
    expect(result.historicalRaces[6].forecast?.historicalErrorRange?.errorObservations).toBe(5);
    expect(result.planTargets[0].forecast?.historicalErrorRange?.errorObservations).toBe(6);
    expect(result.planTargets[0].forecast?.historicalErrorRange?.confidence).toBe("low");
    expect(result.planTargets[0].trainingAdjustedForecast?.historicalErrorRange?.errorObservations).toBe(6);
  });

  it("excludes invalid race outcomes from residuals and horizon reports", () => {
    const validRaces = [
      activity({ id: "first", localDate: "2025-01-01", eventType: "race" }),
      activity({ id: "second", localDate: "2025-06-01", eventType: "race" }),
    ];
    const result = analyzeRacePerformance({
      activities: [
        ...validRaces,
        activity({ id: "zero-time", localDate: "2025-07-01", eventType: "race", durationSeconds: 0 }),
      ],
      plans: [],
      asOf: "2026-01-01",
    });
    expect(result.historicalRaces.map((race) => race.raceId)).toEqual(["first", "second"]);
    expect(result.forecastSummary?.comparisons).toBe(1);
    expect(result.horizonEvaluations.every((evaluation) => evaluation.base?.comparisons === 1)).toBe(true);
  });
});
