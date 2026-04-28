// ============================================================
// EnduroLab — Zone Calculator Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { RunnerProfile } from "@/lib/training/models";

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 30,
    peakHistoricalWeeklyMileage: 40,
    currentMarathonPR: 270, // 4:30/mi
    currentHalfMarathonPR: 125, // ~5:08/mi
    goalMarathonTime: 270,
    raceDate: "2026-09-01",
    trainingDaysPerWeek: 5,
    preferredRestDay: "Monday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 12,
    comfortLevelWithWorkouts: "intermediate",
    availableLongRunDays: ["Sunday"],
    strengthTrainingAvailability: "light",
    ...overrides,
  };
}

describe("calculatePaceZones", () => {
  it("returns all zone fields populated", () => {
    const zones = calculatePaceZones(makeProfile());
    expect(zones).toHaveProperty("easy");
    expect(zones).toHaveProperty("marathon");
    expect(zones).toHaveProperty("threshold");
    expect(zones).toHaveProperty("vo2");
    expect(zones).toHaveProperty("recovery");
    expect(zones).toHaveProperty("easyEffort");
    expect(zones).toHaveProperty("marathonEffort");
    expect(zones).toHaveProperty("thresholdEffort");
    expect(zones).toHaveProperty("vo2Effort");
  });

  it("produces zones where all values are positive numbers", () => {
    const zones = calculatePaceZones(makeProfile());
    expect(zones.easy.min).toBeGreaterThan(0);
    expect(zones.easy.max).toBeGreaterThan(0);
    expect(zones.marathon).toBeGreaterThan(0);
    expect(zones.threshold).toBeGreaterThan(0);
    expect(zones.vo2).toBeGreaterThan(0);
    expect(zones.recovery).toBeGreaterThan(0);
  });

  it("produces a reasonable easy pace range", () => {
    const zones = calculatePaceZones(makeProfile());
    // easy.min is the slower end (higher number), easy.max is the faster end (lower number)
    expect(zones.easy.min).toBeGreaterThan(zones.easy.max);
    expect(zones.easy.min - zones.easy.max).toBeGreaterThan(0);
    expect(zones.easy.min - zones.easy.max).toBeLessThan(45);
  });

  it("adjusts zones for a faster marathon PR", () => {
    const fastZones = calculatePaceZones(makeProfile({ currentMarathonPR: 210 })); // 3:45 marathon
    const slowZones = calculatePaceZones(makeProfile({ currentMarathonPR: 330 })); // 5:30 marathon

    // Fast runner should have faster (lower) zone paces
    expect(fastZones.marathon).toBeLessThan(slowZones.marathon);
    expect(fastZones.threshold).toBeLessThan(slowZones.threshold);
  });

  it("handles missing PR data by falling back to goal time", () => {
    const zones = calculatePaceZones(
      makeProfile({ currentMarathonPR: null, currentHalfMarathonPR: null })
    );
    expect(zones.marathon).toBeGreaterThan(0);
    expect(zones.easy.min).toBeGreaterThan(0);
  });

  it("returns effort descriptions", () => {
    const zones = calculatePaceZones(makeProfile());
    expect(zones.easyEffort).toContain("Conversational");
    expect(zones.recovery).toBeGreaterThan(0);
    expect(zones.thresholdEffort).toContain("discomfort");
    expect(zones.vo2Effort).toContain("Hard");
  });
});

describe("calculatePowerZones", () => {
  it("returns undefined when runner has no power data", () => {
    const zones = calculatePowerZones(makeProfile({ hasAppleWatchPower: false }), {} as any);
    expect(zones).toBeUndefined();
  });

  it("returns power zones when runner has power data", () => {
    const paceZones = calculatePaceZones(makeProfile({ hasAppleWatchPower: true }));
    const zones = calculatePowerZones(makeProfile({ hasAppleWatchPower: true }), paceZones);
    expect(zones).toBeDefined();
    expect(zones).toHaveProperty("easy");
    expect(zones).toHaveProperty("marathon");
    expect(zones).toHaveProperty("threshold");
    expect(zones).toHaveProperty("vo2");
  });
});
