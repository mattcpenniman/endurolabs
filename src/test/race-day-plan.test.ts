// ============================================================
// EnduroLab — Race Day Plan Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { generateRaceDayPlan } from "@/lib/training/race-day-plan";
import { RaceDayPlan } from "@/lib/training/models";

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

  it("generates exactly 26.2 splits", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits.length).toBe(26);
  });

  it("first split is at mile 1", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits[0].mile).toBe(1);
  });

  it("last split is at mile 26", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "even");
    expect(plan.splits[plan.splits.length - 1].mile).toBe(26);
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

  it("negative split has faster first half than second half", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "negative");
    const firstHalfAvg = plan.splits.slice(0, 13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    const secondHalfAvg = plan.splits.slice(13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    expect(secondHalfAvg).toBeGreaterThan(firstHalfAvg);
  });

  it("progressive pacing has faster second half than first half", () => {
    const plan = generateRaceDayPlan(270, "2026-09-01", 50, "progressive");
    const firstHalfAvg = plan.splits.slice(0, 13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    const secondHalfAvg = plan.splits.slice(13).reduce((sum, s) => sum + s.targetPace, 0) / 13;
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg);
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
