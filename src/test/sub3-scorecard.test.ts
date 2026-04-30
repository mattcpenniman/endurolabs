// ============================================================
// EnduroLab — Sub-3 Scorecard Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { generatePlan } from "@/lib/training/plan-generator";
import { RunnerProfile } from "@/lib/training/models";
import { buildSub3Scorecard } from "@/lib/training/sub3-scorecard";

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 55,
    peakHistoricalWeeklyMileage: 70,
    currentMarathonPR: 180,
    currentHalfMarathonPR: 84,
    goalMarathonTime: 180,
    raceDate: "2026-12-01",
    trainingDaysPerWeek: 6,
    preferredRestDay: "Monday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 16,
    comfortLevelWithWorkouts: "advanced",
    availableLongRunDays: ["Sunday"],
    strengthTrainingAvailability: "light",
    weeksOverride: 18,
    peakMileageOverride: 70,
    ...overrides,
  };
}

describe("buildSub3Scorecard", () => {
  it("returns 15 scored rows with plan and actual summaries", () => {
    const plan = generatePlan(makeProfile());
    const scorecard = buildSub3Scorecard(plan, []);

    expect(scorecard.rows).toHaveLength(15);
    expect(scorecard.plan.maxScore).toBe(15);
    expect(scorecard.actual.maxScore).toBe(15);
    expect(scorecard.rows.some((row) => row.category === "Weekly mileage")).toBe(true);
  });

  it("counts an entered sub-85 half marathon as actual fitness evidence", () => {
    const plan = generatePlan(makeProfile({ currentHalfMarathonPR: 84 }));
    const scorecard = buildSub3Scorecard(plan, []);
    const halfRow = scorecard.rows.find((row) => row.category === "Half marathon fitness");

    expect(halfRow?.actual.status).toBe("earned");
  });
});
