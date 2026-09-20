// ============================================================
// EnduroLab — Plan Week Rebuild Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { generatePlan } from "@/lib/training/plan-generator";
import { MarathonPlan, RunnerProfile } from "@/lib/training/models";
import { rebuildPlanWeek } from "@/lib/planner/plan-week-rebuild";

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 60,
    peakHistoricalWeeklyMileage: 100,
    currentMarathonPR: 180,
    currentHalfMarathonPR: 85,
    goalMarathonTime: 180,
    raceDate: "2026-09-27",
    trainingDaysPerWeek: 6,
    preferredRestDay: "Wednesday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 20,
    comfortLevelWithWorkouts: "intermediate",
    availableLongRunDays: ["Saturday"],
    strengthTrainingAvailability: "light",
    weeksOverride: 20,
    peakMileageOverride: 90,
    ...overrides,
  };
}

function makePlan(): MarathonPlan {
  return generatePlan(makeProfile());
}

describe("rebuildPlanWeek", () => {
  it("rebuilds the final race week by default", () => {
    const plan = makePlan();
    const lastIndex = plan.weeks.length - 1;
    plan.weeks[lastIndex] = {
      ...plan.weeks[lastIndex],
      longRunDistance: 15,
      isRaceWeek: false,
      days: plan.weeks[lastIndex].days.map((day) => ({ ...day, isRaceDay: false })),
    };

    const result = rebuildPlanWeek(plan);
    const rebuilt = result.plan.weeks[lastIndex];

    expect(result.summary.weekNumber).toBe(20);
    expect(result.summary.isRaceWeek).toBe(true);
    expect(result.summary.longRunDistance).toBe(0);
    expect(rebuilt.isRaceWeek).toBe(true);
    expect(rebuilt.longRunDistance).toBe(0);
    expect(rebuilt.days.filter((day) => day.isRaceDay)).toHaveLength(1);
    expect(rebuilt.days.some((day) => day.workout?.type === "long")).toBe(false);
  });

  it("leaves every other week untouched", () => {
    const plan = makePlan();
    const originalFirst = plan.weeks[0];
    const originalLast = plan.weeks.at(-1)!;
    const lastIndex = plan.weeks.length - 1;
    plan.weeks[lastIndex] = {
      ...plan.weeks[lastIndex],
      longRunDistance: 15,
    };

    const result = rebuildPlanWeek(plan);

    expect(result.plan.weeks[0]).toBe(originalFirst);
    expect(result.plan.weeks.at(-1)).not.toBe(originalLast);
    expect(result.plan.weeks.length).toBe(plan.weeks.length);
  });

  it("rebuilds an explicit earlier week from the generator", () => {
    const plan = makePlan();
    const index = 4;
    const originalOther = plan.weeks[0];
    plan.weeks[index] = { ...plan.weeks[index], totalMileage: 1, longRunDistance: 99 };

    const result = rebuildPlanWeek(plan, { weekNumber: 5 });
    const expected = generatePlan(plan.runnerProfile).weeks[index];

    expect(result.summary.weekNumber).toBe(5);
    expect(result.summary.isRaceWeek).toBe(false);
    expect(result.plan.weeks[index]).toEqual(expected);
    expect(result.plan.weeks[0]).toBe(originalOther);
  });

  it("refuses when the stored week start date does not line up", () => {
    const plan = makePlan();
    const lastIndex = plan.weeks.length - 1;
    const shifted: MarathonPlan = {
      ...plan,
      weeks: plan.weeks.map((week, index) =>
        index === lastIndex ? { ...week, startDate: "2027-01-04T00:00:00.000Z" } : week
      ),
    };

    expect(() => rebuildPlanWeek(shifted)).toThrow(/Refusing to rebuild/);
  });

  it("rejects a week number the plan does not contain", () => {
    expect(() => rebuildPlanWeek(makePlan(), { weekNumber: 999 })).toThrow(/no week 999/);
  });
});
