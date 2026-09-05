// ============================================================
// EnduroLab - Race Performance Analysis Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  analyzeRacePerformance,
  buildRaceForecast,
  buildRacePlanFeatures,
  buildRaceTrainingFeatures,
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
    expect(result.forecastComparison?.commonComparisons).toBe(1);
    expect(result.planTargets).toHaveLength(1);
    expect(result.planTargets[0].baseline?.sourceRaceId).toBe("race-half");
    expect(result.planTargets[0].training.runs).toBe(2);
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
  });
});
