// ============================================================
// EnduroLab — Goal Assessment Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { assessGoal } from "@/lib/training/goal-assessment";
import { RunnerProfile } from "@/lib/training/models";

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 30,
    peakHistoricalWeeklyMileage: 40,
    currentMarathonPR: 270,
    currentHalfMarathonPR: 125,
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

describe("assessGoal", () => {
  it("returns a GoalAssessment with all required fields", () => {
    const result = assessGoal(makeProfile());
    expect(result).toHaveProperty("feasibility");
    expect(result).toHaveProperty("reasoning");
    expect(result).toHaveProperty("recommendedPeakMileage");
    expect(result).toHaveProperty("keyFactors");
    expect(result).toHaveProperty("timeline");
  });

  it("returns realistic feasibility for a goal matching PR with sufficient mileage", () => {
    // Need peakHistoricalWeeklyMileage >= recommendedPeakMileage (50 for 270 min goal)
    const result = assessGoal(
      makeProfile({ goalMarathonTime: 270, currentMarathonPR: 270, peakHistoricalWeeklyMileage: 50 })
    );
    expect(result.feasibility).toBe("realistic");
  });

  it("returns very_ambitious for a goal slightly faster than PR", () => {
    // 15 min faster = ~5.6% improvement → >5% → very_ambitious
    const result = assessGoal(
      makeProfile({ goalMarathonTime: 255, currentMarathonPR: 270, peakHistoricalWeeklyMileage: 50 })
    );
    expect(result.feasibility).toBe("very_ambitious");
  });

  it("returns unlikely for an extremely fast goal with low mileage", () => {
    const result = assessGoal(
      makeProfile({ goalMarathonTime: 150, currentMarathonPR: 270, peakHistoricalWeeklyMileage: 15 })
    );
    expect(result.feasibility).toBe("unlikely");
  });

  it("flags injury history in risk factors", () => {
    const result = assessGoal(
      makeProfile({ recentInjuryHistory: "Stress fracture, 3 months ago" })
    );
    // Injury goes into riskFactors, not keyFactors
    expect(result.reasoning).toContain("risk factor");
  });

  it("includes a reasoning string", () => {
    const result = assessGoal(makeProfile());
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe("string");
    expect(result.reasoning.length).toBeGreaterThan(10);
  });

  it("includes a timeline string", () => {
    const result = assessGoal(makeProfile());
    expect(result.timeline).toBeDefined();
    expect(typeof result.timeline).toBe("string");
    expect(result.timeline).toContain("weeks until race");
  });

  it("returns a positive recommended peak mileage", () => {
    const result = assessGoal(makeProfile());
    expect(result.recommendedPeakMileage).toBeGreaterThan(0);
  });
});
