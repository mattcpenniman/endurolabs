// ============================================================
// EnduroLab — Plan Generator Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { generatePlan } from "@/lib/training/plan-generator";
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

describe("generatePlan", () => {
  it("returns a MarathonPlan with all required fields", () => {
    const plan = generatePlan(makeProfile());
    expect(plan).toHaveProperty("id");
    expect(plan).toHaveProperty("runnerProfile");
    expect(plan).toHaveProperty("paceZones");
    expect(plan).toHaveProperty("weeks");
    expect(plan).toHaveProperty("totalWeeks");
    expect(plan).toHaveProperty("peakWeeklyMileage");
    expect(plan).toHaveProperty("phases");
    expect(plan).toHaveProperty("goalAssessment");
    expect(plan).toHaveProperty("adjustmentRules");
    expect(plan).toHaveProperty("riskWarnings");
    expect(plan).toHaveProperty("raceDay");
    expect(plan).toHaveProperty("generatedAt");
  });

  it("generates the correct number of weeks", () => {
    const plan = generatePlan(makeProfile());
    expect(plan.weeks.length).toBe(plan.totalWeeks);
  });

  it("generates at least 14 weeks for a typical plan", () => {
    const plan = generatePlan(makeProfile());
    expect(plan.totalWeeks).toBeGreaterThanOrEqual(14);
  });

  it("has at least 3 phases", () => {
    const plan = generatePlan(makeProfile());
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
  });

  it("each week has 7 days", () => {
    const plan = generatePlan(makeProfile());
    for (const week of plan.weeks) {
      expect(week.days.length).toBe(7);
    }
  });

  it("peak mileage does not exceed peak historical mileage by more than 30%", () => {
    const profile = makeProfile({ peakHistoricalWeeklyMileage: 40 });
    const plan = generatePlan(profile);
    const maxAllowed = Math.ceil(profile.peakHistoricalWeeklyMileage * 1.3);
    expect(plan.peakWeeklyMileage).toBeLessThanOrEqual(maxAllowed);
  });

  it("longest run in the plan does not exceed 26.2 miles", () => {
    const plan = generatePlan(makeProfile());
    for (const week of plan.weeks) {
      for (const day of week.days) {
        if (day.workout && day.workout.type === "long") {
          expect(day.workout.totalDistance).toBeLessThanOrEqual(26.2);
        }
      }
    }
  });

  it("has rest days marked as rest days", () => {
    const plan = generatePlan(makeProfile());
    let restDayCount = 0;
    for (const week of plan.weeks) {
      for (const day of week.days) {
        if (day.isRestDay) {
          restDayCount++;
          expect(day.workout).toBeNull();
        }
      }
    }
    expect(restDayCount).toBeGreaterThan(0);
  });

  it("has adjustment rules for low mileage runners", () => {
    const plan = generatePlan(makeProfile({ currentWeeklyMileage: 10 }));
    expect(plan.adjustmentRules.length).toBeGreaterThan(0);
  });

  it("has risk warnings when applicable", () => {
    const plan = generatePlan(makeProfile({ currentWeeklyMileage: 10 }));
    expect(plan.riskWarnings).toBeDefined();
    expect(Array.isArray(plan.riskWarnings)).toBe(true);
  });
});
