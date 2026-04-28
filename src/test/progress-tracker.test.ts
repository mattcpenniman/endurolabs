// ============================================================
// EnduroLab — Progress Tracker Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { analyzeProgress, getMileageTrend } from "@/lib/training/progress-tracker";
import { MarathonPlan, WeeklyLog } from "@/lib/training/models";

function makePlan(): MarathonPlan {
  return {
    id: "test-plan",
    runnerProfile: {
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
    },
    paceZones: {
      easy: { min: 370, max: 390 },
      marathon: 270,
      threshold: 283,
      vo2: 260,
      recovery: 407,
      easyEffort: "Easy",
      marathonEffort: "Marathon",
      thresholdEffort: "Threshold",
      vo2Effort: "VO2",
    },
    powerZones: undefined,
    weeks: [
      {
        weekNumber: 1,
        phase: "base",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        totalMileage: 32,
        longRunDistance: 6,
        isDownWeek: false,
        intensityDistribution: { easy: 32, threshold: 0, marathon: 0, vo2: 0 },
        days: [],
      },
      {
        weekNumber: 2,
        phase: "base",
        startDate: "2026-05-11",
        endDate: "2026-05-17",
        totalMileage: 35,
        longRunDistance: 8,
        isDownWeek: false,
        intensityDistribution: { easy: 35, threshold: 0, marathon: 0, vo2: 0 },
        days: [],
      },
      {
        weekNumber: 3,
        phase: "base",
        startDate: "2026-05-18",
        endDate: "2026-05-24",
        totalMileage: 38,
        longRunDistance: 10,
        isDownWeek: false,
        intensityDistribution: { easy: 38, threshold: 0, marathon: 0, vo2: 0 },
        days: [],
      },
    ],
    totalWeeks: 3,
    peakWeeklyMileage: 50,
    phases: [
      { name: "Base", startDate: "", endDate: "", description: "", weekRange: [1, 1] },
      { name: "Build", startDate: "", endDate: "", description: "", weekRange: [2, 2] },
      { name: "Taper", startDate: "", endDate: "", description: "", weekRange: [3, 3] },
    ],
    goalAssessment: { feasibility: "realistic", reasoning: "test", recommendedPeakMileage: 50, keyFactors: [], timeline: "test" },
    adjustmentRules: [],
    riskWarnings: [],
    raceDay: "2026-09-01",
    generatedAt: new Date().toISOString(),
  };
}

function makeLog(overrides: Partial<WeeklyLog> = {}): WeeklyLog {
  return {
    weekNumber: 1,
    actualMileage: 30,
    plannedMileage: 32,
    longRunActual: 6,
    longRunPlanned: 6,
    feelRating: 6,
    adherence: 90,
    notes: "",
    loggedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("analyzeProgress", () => {
  it("returns a WeeklyProgress with all required fields", () => {
    const plan = makePlan();
    const logs: WeeklyLog[] = [];
    const result = analyzeProgress(plan, logs);
    expect(result).toHaveProperty("logs");
    expect(result).toHaveProperty("currentWeek");
    expect(result).toHaveProperty("totalWeeks");
    expect(result).toHaveProperty("averageFeel");
    expect(result).toHaveProperty("averageAdherence");
    expect(result).toHaveProperty("projectedPeakMileage");
    expect(result).toHaveProperty("adjustmentSuggestions");
  });

  it("returns 0 for averages when no logs exist", () => {
    const plan = makePlan();
    const result = analyzeProgress(plan, []);
    expect(result.averageFeel).toBe(0);
    expect(result.averageAdherence).toBe(0);
  });

  it("calculates correct average feel with logs", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, feelRating: 4 }),
      makeLog({ weekNumber: 2, feelRating: 6 }),
      makeLog({ weekNumber: 3, feelRating: 8 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.averageFeel).toBe(6);
  });

  it("calculates correct average adherence with logs", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, adherence: 80 }),
      makeLog({ weekNumber: 2, adherence: 100 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.averageAdherence).toBe(90);
  });

  it("projects peak mileage from recent logs", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, actualMileage: 30 }),
      makeLog({ weekNumber: 2, actualMileage: 35 }),
      makeLog({ weekNumber: 3, actualMileage: 40 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.projectedPeakMileage).toBe(40);
  });

  it("suggests reduction when adherence is low", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, adherence: 50 }),
      makeLog({ weekNumber: 2, adherence: 55 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.adjustmentSuggestions.some((s) => s.toLowerCase().includes("adherence"))).toBe(true);
  });

  it("suggests recovery when high adherence with low feel", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, adherence: 95, feelRating: 3 }),
      makeLog({ weekNumber: 2, adherence: 90, feelRating: 4 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.adjustmentSuggestions.some((s) => s.toLowerCase().includes("recovery"))).toBe(true);
  });

  it("suggests caution when mileage spikes", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, actualMileage: 20 }),
      makeLog({ weekNumber: 2, actualMileage: 50 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.adjustmentSuggestions.some((s) => s.toLowerCase().includes("spike"))).toBe(true);
  });

  it("suggests caution when fatigue is consistently low", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, feelRating: 2 }),
      makeLog({ weekNumber: 2, feelRating: 3 }),
      makeLog({ weekNumber: 3, feelRating: 2 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.adjustmentSuggestions.some((s) => s.toLowerCase().includes("feel"))).toBe(true);
  });

  it("gives positive feedback for good adherence and feel", () => {
    const plan = makePlan();
    const logs = [
      makeLog({ weekNumber: 1, adherence: 90, feelRating: 7 }),
      makeLog({ weekNumber: 2, adherence: 95, feelRating: 8 }),
    ];
    const result = analyzeProgress(plan, logs);
    expect(result.adjustmentSuggestions.some((s) => s.toLowerCase().includes("track"))).toBe(true);
  });
});

describe("getMileageTrend", () => {
  it("returns planned and actual arrays", () => {
    const logs: WeeklyLog[] = [
      makeLog({ weekNumber: 1, actualMileage: 30, plannedMileage: 32 }),
      makeLog({ weekNumber: 2, actualMileage: 35, plannedMileage: 35 }),
    ];
    const trend = getMileageTrend(logs);
    expect(trend.planned).toEqual([32, 35]);
    expect(trend.actual).toEqual([30, 35]);
  });

  it("sorts logs by week number", () => {
    const logs: WeeklyLog[] = [
      makeLog({ weekNumber: 3, actualMileage: 40, plannedMileage: 40 }),
      makeLog({ weekNumber: 1, actualMileage: 30, plannedMileage: 32 }),
      makeLog({ weekNumber: 2, actualMileage: 35, plannedMileage: 35 }),
    ];
    const trend = getMileageTrend(logs);
    expect(trend.actual).toEqual([30, 35, 40]);
  });
});
