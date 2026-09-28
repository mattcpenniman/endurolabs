// ============================================================
// EnduroLab — Race Day Plan Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { generateRaceDayPlan } from "@/lib/training/race-day-plan";
import { RaceDayPlan, RaceDayPlanForecast } from "@/lib/training/models";

describe("generateRaceDayPlan", () => {
  it("returns a RaceDayPlan with all required fields", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan).toHaveProperty("raceDate");
    expect(plan).toHaveProperty("goalTime");
    expect(plan).toHaveProperty("goalPace");
    expect(plan).toHaveProperty("splits");
    expect(plan).toHaveProperty("nutritionPlan");
    expect(plan).toHaveProperty("weatherAdjustments");
    expect(plan).toHaveProperty("preRaceRoutine");
    expect(plan).toHaveProperty("pacingStrategy");
  });

  it("generates mile splits plus the final 0.2", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits.length).toBe(27);
  });

  it("first split is at mile 1", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits[0].mile).toBe(1);
  });

  it("last split is at mile 26.2", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits[plan.splits.length - 1].mile).toBe(26.2);
  });

  it("supports shorter race distances", () => {
    const plan = generateRaceDayPlan(60, "2026-09-01", 50, "even", 6.2, "10K");

    expect(plan.raceDistanceMiles).toBe(6.2);
    expect(plan.raceDistanceLabel).toBe("10K");
    expect(plan.splits[plan.splits.length - 1].mile).toBe(6.2);
  });

  it("final cumulative time lands on the goal time", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits[plan.splits.length - 1].targetTime).toBeCloseTo(270, 1);
  });

  it("goal pace is goalTime / 26.2", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.goalPace).toBeCloseTo(270 / 26.2, 1);
  });

  it("even pacing produces consistent paces", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    const paces = plan.splits.map((s) => s.targetPace);
    const maxDiff = Math.max(...paces) - Math.min(...paces);
    // Even pacing should have minimal variation (allowing for rounding)
    expect(maxDiff).toBeLessThan(2);
  });

  it("negative split has a faster second half than first half", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "negative");
    const firstHalfAvg = plan.splits.slice(0, 13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    const secondHalfAvg = plan.splits.slice(13, 26).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg);
    expect(plan.splits[plan.splits.length - 1].targetTime).toBeCloseTo(270, 1);
  });

  it("positive split has a slower second half than first half", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "positive");
    const firstHalfAvg = plan.splits.slice(0, 13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    const secondHalfAvg = plan.splits.slice(13, 26).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    expect(secondHalfAvg).toBeGreaterThan(firstHalfAvg);
    expect(plan.splits[plan.splits.length - 1].targetTime).toBeCloseTo(270, 1);
  });

  it("progressive pacing has faster second half than first half", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "progressive");
    const firstHalfAvg = plan.splits.slice(0, 13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    const secondHalfAvg = plan.splits.slice(13, 26).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg);
    expect(plan.splits[plan.splits.length - 1].targetTime).toBeCloseTo(270, 1);
  });

  it("has nutrition cues", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.nutritionPlan.length).toBeGreaterThan(0);
    expect(plan.nutritionPlan.some((c) => c.type === "fuel")).toBe(true);
    expect(plan.nutritionPlan.some((c) => c.type === "fluid")).toBe(true);
  });

  it("has pre-race routine cues", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.preRaceRoutine.length).toBeGreaterThan(0);
    expect(plan.preRaceRoutine[0].timeBeforeStart).toBe(90);
    expect(plan.preRaceRoutine[plan.preRaceRoutine.length - 1].timeBeforeStart).toBe(0);
  });

  it("has weather adjustments", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.weatherAdjustments.length).toBeGreaterThan(0);
  });

  it("adjusts pace for hot weather (80°F)", () => {
    const hotPlan = generateRaceDayPlan(270, "2026-09-01", 80, "even");
    const hotAdj = hotPlan.weatherAdjustments.find((a) => a.threshold >= 75);
    expect(hotAdj).toBeDefined();
    expect(hotAdj!.paceDelta).toBeGreaterThan(0);
  });

  it("adjusts pace for cold weather (20°F)", () => {
    const coldPlan = generateRaceDayPlan(270, "2026-09-01", 20, "even");
    const coldAdj = coldPlan.weatherAdjustments.find((a) => a.threshold <= 25);
    expect(coldAdj).toBeDefined();
    expect(coldAdj!.paceDelta).toBeGreaterThan(0);
  });
});

describe("generateRaceDayPlan forecast anchor", () => {
  // Berlin 2026-09-27 scenario: the goal was 2:59 but the pre-race forecast was 3:08.
  const goalTime = 179;
  const forecast: RaceDayPlanForecast = {
    predictedTime: 188.2,
    predictedPace: 188.2 / 26.2,
    rangeLowerTime: 169.5,
    rangeUpperTime: 211.5,
    confidence: "limited",
    asOf: "2026-09-26",
  };

  it("keeps the goal anchor by default and retains the forecast", () => {
    const plan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "negative", 26.2, "Marathon", forecast);
    expect(plan.anchor).toBe("goal");
    expect(plan.anchorTime).toBe(goalTime);
    expect(plan.anchorPace).toBeCloseTo(plan.goalPace, 5);
    expect(plan.splits[plan.splits.length - 1].targetTime).toBeCloseTo(goalTime, 1);
    expect(plan.forecast).toBe(forecast);
  });

  it("paces the splits on the forecast while keeping the goal time", () => {
    const plan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "negative", 26.2, "Marathon", forecast, "forecast");
    expect(plan.anchor).toBe("forecast");
    expect(plan.anchorTime).toBeCloseTo(forecast.predictedTime, 5);
    expect(plan.anchorPace).toBeCloseTo(forecast.predictedTime / 26.2, 1);
    expect(plan.goalTime).toBe(goalTime);
    expect(plan.splits[plan.splits.length - 1].targetTime).toBeCloseTo(forecast.predictedTime, 1);
  });

  it("opens the negative-split sheet at goal pace versus forecast pace", () => {
    const goalPlan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "negative");
    const forecastPlan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "negative", 26.2, "Marathon", forecast, "forecast");
    expect(goalPlan.splits[0].targetPace).toBeCloseTo(6.99, 2);
    expect(forecastPlan.splits[0].targetPace).toBeCloseTo(7.34, 2);
  });

  it("falls back to the goal when the forecast anchor is requested without a forecast", () => {
    const plan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "even", 26.2, "Marathon", null, "forecast");
    expect(plan.anchor).toBe("goal");
    expect(plan.anchorTime).toBe(goalTime);
    expect(plan.forecast).toBeNull();
  });

  it("schedules fueling against the anchor time", () => {
    const goalPlan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "even");
    const forecastPlan = generateRaceDayPlan(goalTime, "2026-09-27", 50, "even", 26.2, "Marathon", forecast, "forecast");
    const lastFuelMile = (plan: RaceDayPlan): number => Math.max(
      ...plan.nutritionPlan.filter((cue) => cue.type === "fuel" && cue.mile > 0).map((cue) => cue.mile)
    );
    expect(lastFuelMile(forecastPlan)).toBeGreaterThanOrEqual(lastFuelMile(goalPlan));
  });
});
