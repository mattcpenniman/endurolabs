// ============================================================
// EnduroLab — Progress Tracker Tests
// ============================================================

import { describe, it, expect } from "vitest";
import {
  addDailyLog,
  analyzeProgress,
  areAllPhaseRunsLogged,
  dailyLogsToWeeklyLogs,
  getMileageTrend,
  isWeekFullyLogged,
  preserveFullyLoggedWeeks,
  preserveLoggedPlanDays,
  removeDailyLog,
} from "@/lib/training/progress-tracker";
import { DailyLog, MarathonPlan, WeeklyLog } from "@/lib/training/models";

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
      heartRateZones: {
        recovery: { hrrPercent: { min: 0.6, max: 0.67 }, hrMaxPercent: { min: 0.65, max: 0.72 }, targetBpm: null },
        easy: { hrrPercent: { min: 0.6, max: 0.74 }, hrMaxPercent: { min: 0.65, max: 0.79 }, targetBpm: null },
        marathon: { hrrPercent: { min: 0.75, max: 0.84 }, hrMaxPercent: { min: 0.8, max: 0.9 }, targetBpm: null },
        threshold: { hrrPercent: { min: 0.83, max: 0.88 }, hrMaxPercent: { min: 0.88, max: 0.92 }, targetBpm: null },
        vo2: { hrrPercent: { min: 0.95, max: 1 }, hrMaxPercent: { min: 0.98, max: 1 }, targetBpm: null },
      },
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
        days: [
          {
            date: "2026-05-04",
            dayOfWeek: "Monday",
            workout: null,
            isRestDay: true,
            plannedMileage: 0,
          },
          {
            date: "2026-05-05",
            dayOfWeek: "Tuesday",
            workout: {
              id: "easy-1",
              type: "easy",
              title: "Easy",
              description: "",
              segments: [],
              totalDistance: 4,
              estimatedDuration: 40,
              weeklyMileageContribution: 4,
              intensityCategory: "easy",
            },
            isRestDay: false,
            plannedMileage: 4,
          },
          {
            date: "2026-05-10",
            dayOfWeek: "Sunday",
            workout: {
              id: "long-1",
              type: "long",
              title: "Long",
              description: "",
              segments: [],
              totalDistance: 6,
              estimatedDuration: 60,
              weeklyMileageContribution: 6,
              intensityCategory: "easy",
            },
            isRestDay: false,
            plannedMileage: 6,
          },
        ],
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

function makeDailyLog(runId: string, overrides: Partial<DailyLog> = {}): DailyLog {
  return {
    weekNumber: 1,
    date: "2026-05-05",
    dayOfWeek: "Tuesday",
    runId,
    plannedWorkoutId: runId,
    actualMileage: 4,
    completed: true,
    feelRating: 7,
    notes: "",
    loggedAt: "2026-05-05T12:00:00.000Z",
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

describe("preserveLoggedPlanDays", () => {
  it("preserves historical dates through the latest actual and accepts recalculated future days", () => {
    const current = makePlan();
    const recalculated = structuredClone(current);
    const recalculatedMonday = recalculated.weeks[0].days[0];
    const recalculatedTuesday = recalculated.weeks[0].days[1];
    const recalculatedSunday = recalculated.weeks[0].days[2];

    recalculatedMonday.workout = {
      ...recalculatedTuesday.workout!,
      id: "easy-monday",
      title: "Recalculated Monday",
      totalDistance: 8,
      weeklyMileageContribution: 8,
    };
    recalculatedMonday.isRestDay = false;
    recalculatedMonday.plannedMileage = 8;
    recalculatedTuesday.workout = {
      ...recalculatedTuesday.workout!,
      title: "Recalculated Tuesday",
      totalDistance: 8,
      weeklyMileageContribution: 8,
    };
    recalculatedTuesday.plannedMileage = 8;
    recalculatedSunday.workout = {
      ...recalculatedSunday.workout!,
      title: "Recalculated Sunday",
      totalDistance: 12,
      weeklyMileageContribution: 12,
    };
    recalculatedSunday.plannedMileage = 12;

    const result = preserveLoggedPlanDays(current, recalculated, [{
      weekNumber: 1,
      date: "2026-05-05",
      dayOfWeek: "Tuesday",
    }]);

    expect(result.weeks[0].days[0]).toEqual(current.weeks[0].days[0]);
    expect(result.weeks[0].days[1]).toEqual(current.weeks[0].days[1]);
    expect(result.weeks[0].days[2].workout?.title).toBe("Recalculated Sunday");
    expect(result.weeks[0].totalMileage).toBe(16);
    expect(result.weeks[0].longRunDistance).toBe(12);
  });

  it("returns the recalculated plan unchanged when there are no actuals", () => {
    const current = makePlan();
    const recalculated = structuredClone(current);

    expect(preserveLoggedPlanDays(current, recalculated, [])).toBe(recalculated);
  });
});

describe("dailyLogsToWeeklyLogs", () => {
  it("aggregates daily logs into weekly progress", () => {
    const plan = makePlan();
    const dailyLogs: DailyLog[] = [
      {
        weekNumber: 1,
        date: "2026-05-05",
        dayOfWeek: "Tuesday",
        runId: "easy-1",
        plannedWorkoutId: "easy-1",
        actualMileage: 4,
        completed: true,
        feelRating: 7,
        notes: "smooth",
        loggedAt: "2026-05-05T12:00:00.000Z",
      },
      {
        weekNumber: 1,
        date: "2026-05-10",
        dayOfWeek: "Sunday",
        runId: "long-1",
        plannedWorkoutId: "long-1",
        actualMileage: 5,
        completed: false,
        feelRating: 5,
        notes: "cut short",
        loggedAt: "2026-05-10T12:00:00.000Z",
      },
    ];

    const weeklyLogs = dailyLogsToWeeklyLogs(plan, dailyLogs);

    expect(weeklyLogs).toHaveLength(1);
    expect(weeklyLogs[0].actualMileage).toBe(9);
    expect(weeklyLogs[0].longRunActual).toBe(5);
    expect(weeklyLogs[0].longRunPlanned).toBe(6);
    expect(weeklyLogs[0].feelRating).toBe(6);
    expect(weeklyLogs[0].adherence).toBe(50);
    expect(weeklyLogs[0].notes).toContain("smooth");
    expect(weeklyLogs[0].notes).toContain("cut short");
  });
});

describe("areAllPhaseRunsLogged", () => {
  it("requires completed logs for every primary and secondary run", () => {
    const week = structuredClone(makePlan().weeks[0]);
    week.days[1].secondaryWorkout = {
      ...week.days[1].workout!,
      id: "recovery-1",
      title: "Recovery",
    };

    expect(areAllPhaseRunsLogged([week], [
      makeDailyLog("easy-1"),
      makeDailyLog("long-1", { date: "2026-05-10", dayOfWeek: "Sunday" }),
    ])).toBe(false);
    expect(areAllPhaseRunsLogged([week], [
      makeDailyLog("easy-1"),
      makeDailyLog("recovery-1"),
      makeDailyLog("long-1", { date: "2026-05-10", dayOfWeek: "Sunday" }),
    ])).toBe(true);
  });

  it("ignores incomplete and additional runs and does not complete an empty phase", () => {
    const week = makePlan().weeks[0];

    expect(areAllPhaseRunsLogged([week], [
      makeDailyLog("easy-1"),
      makeDailyLog("long-1", { completed: false }),
      makeDailyLog("long-1", { isAdditionalRun: true }),
    ])).toBe(false);
    expect(areAllPhaseRunsLogged([makePlan().weeks[1]], [])).toBe(false);
  });
});

describe("isWeekFullyLogged", () => {
  it("only considers completed planned runs from the matching week", () => {
    const week = structuredClone(makePlan().weeks[0]);
    week.days[1].secondaryWorkout = {
      ...week.days[1].workout!,
      id: "recovery-1",
      title: "Recovery",
    };

    expect(isWeekFullyLogged(week, [
      makeDailyLog("easy-1"),
      makeDailyLog("recovery-1", { weekNumber: 2 }),
      makeDailyLog("recovery-1", { isAdditionalRun: true }),
      makeDailyLog("long-1", { completed: false }),
    ])).toBe(false);
    expect(isWeekFullyLogged(week, [
      makeDailyLog("easy-1"),
      makeDailyLog("easy-1"),
      makeDailyLog("recovery-1"),
      makeDailyLog("long-1"),
    ])).toBe(true);
    expect(isWeekFullyLogged(makePlan().weeks[1], [])).toBe(false);
  });
});

describe("preserveFullyLoggedWeeks", () => {
  it("keeps completed weeks unchanged while accepting changes to incomplete weeks", () => {
    const currentPlan = makePlan();
    const recalculatedPlan = structuredClone(currentPlan);
    recalculatedPlan.weeks[0].totalMileage = 99;
    recalculatedPlan.weeks[1].totalMileage = 88;

    const result = preserveFullyLoggedWeeks(currentPlan, recalculatedPlan, [
      makeDailyLog("easy-1"),
      makeDailyLog("long-1"),
    ]);

    expect(result.weeks[0]).toEqual(currentPlan.weeks[0]);
    expect(result.weeks[1].totalMileage).toBe(88);
  });
});

describe("removeDailyLog", () => {
  it("removes a matching daily log and keeps other logs", () => {
    localStorage.clear();
    addDailyLog("test-plan", {
      weekNumber: 1,
      date: "2026-05-05",
      dayOfWeek: "Tuesday",
      runId: "tue-run",
      plannedWorkoutId: "tue-run",
      actualMileage: 4,
      completed: true,
      feelRating: 7,
      notes: "smooth",
      loggedAt: "2026-05-05T12:00:00.000Z",
    });
    addDailyLog("test-plan", {
      weekNumber: 1,
      date: "2026-05-06",
      dayOfWeek: "Wednesday",
      runId: "wed-run",
      plannedWorkoutId: "wed-run",
      actualMileage: 5,
      completed: true,
      feelRating: 6,
      notes: "steady",
      loggedAt: "2026-05-06T12:00:00.000Z",
    });

    const logs = removeDailyLog("test-plan", 1, "Tuesday", "tue-run");

    expect(logs).toHaveLength(1);
    expect(logs[0].dayOfWeek).toBe("Wednesday");
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
