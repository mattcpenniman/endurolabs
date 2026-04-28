// ============================================================
// EnduroLab — Calendar Export Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { generateICS } from "@/lib/training/calendar-export";
import { MarathonPlan } from "@/lib/training/models";

function makePlan(): MarathonPlan {
  return {
    id: "test-plan-001",
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
      easyEffort: "Easy (conversational)",
      marathonEffort: "Marathon pace (goal effort)",
      thresholdEffort: "Threshold (comfortably hard)",
      vo2Effort: "VO2 Max (hard)",
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
            dayOfWeek: "Tuesday",
            date: "2026-05-05",
            workout: {
              id: "w1",
              type: "easy",
              title: "Easy Run",
              description: "Easy run",
              segments: [
                {
                  type: "continuous",
                  distance: 5,
                  pace: 380,
                  effort: "easy",
                  description: "Continuous",
                },
              ],
              estimatedDuration: 38,
              totalDistance: 5,
              intensityCategory: "easy",
            },
            isRestDay: false,
            plannedMileage: 5,
          },
          {
            dayOfWeek: "Wednesday",
            date: "2026-05-06",
            workout: {
              id: "w2",
              type: "threshold",
              title: "Threshold Run",
              description: "Threshold run",
              segments: [
                { type: "warmup", distance: 1.5, effort: "easy", description: "Warmup" },
                { type: "continuous", distance: 3, pace: 283, effort: "threshold", description: "Threshold" },
                { type: "cooldown", distance: 1, effort: "easy", description: "Cooldown" },
              ],
              estimatedDuration: 35,
              totalDistance: 5.5,
              intensityCategory: "threshold",
            },
            isRestDay: false,
            plannedMileage: 5.5,
          },
          {
            dayOfWeek: "Thursday",
            date: "2026-05-07",
            workout: null,
            isRestDay: true,
            plannedMileage: 0,
          },
          {
            dayOfWeek: "Friday",
            date: "2026-05-08",
            workout: null,
            isRestDay: true,
            plannedMileage: 0,
          },
          {
            dayOfWeek: "Saturday",
            date: "2026-05-09",
            workout: {
              id: "w3",
              type: "easy",
              title: "Easy Run",
              description: "Easy run",
              segments: [
                { type: "continuous", distance: 4, pace: 380, effort: "easy", description: "Continuous" },
              ],
              estimatedDuration: 30,
              totalDistance: 4,
              intensityCategory: "easy",
            },
            isRestDay: false,
            plannedMileage: 4,
          },
          {
            dayOfWeek: "Sunday",
            date: "2026-05-10",
            workout: {
              id: "w4",
              type: "long",
              title: "Long Run",
              description: "Long run",
              segments: [
                { type: "continuous", distance: 6, pace: 380, effort: "easy", description: "Continuous" },
              ],
              estimatedDuration: 45,
              totalDistance: 6,
              intensityCategory: "easy",
            },
            isRestDay: false,
            plannedMileage: 6,
          },
          {
            dayOfWeek: "Monday",
            date: "2026-05-04",
            workout: null,
            isRestDay: true,
            plannedMileage: 0,
          },
        ],
      },
    ],
    totalWeeks: 1,
    peakWeeklyMileage: 32,
    phases: [
      { name: "Base Building", startDate: "", endDate: "", description: "", weekRange: [1, 1] },
      { name: "Marathon Specific", startDate: "", endDate: "", description: "", weekRange: [2, 2] },
      { name: "Peak & Taper", startDate: "", endDate: "", description: "", weekRange: [3, 3] },
    ],
    goalAssessment: {
      feasibility: "realistic",
      reasoning: "Test plan",
      recommendedPeakMileage: 50,
      keyFactors: [],
      timeline: "Test timeline",
    },
    adjustmentRules: [],
    riskWarnings: [],
    raceDay: "2026-09-01",
    generatedAt: new Date().toISOString(),
  };
}

describe("generateICS", () => {
  it("returns a string", () => {
    const result = generateICS(makePlan());
    expect(typeof result).toBe("string");
  });

  it("returns a non-empty string", () => {
    const result = generateICS(makePlan());
    expect(result.length).toBeGreaterThan(100);
  });

  it("includes VCALENDAR header", () => {
    const result = generateICS(makePlan());
    expect(result).toContain("BEGIN:VCALENDAR");
  });

  it("includes VEVENT entries for workout days", () => {
    const result = generateICS(makePlan());
    expect(result).toContain("BEGIN:VEVENT");
  });

  it("includes rest day events", () => {
    const result = generateICS(makePlan());
    expect(result).toContain("Rest Day");
  });

  it("includes workout titles in event titles", () => {
    const result = generateICS(makePlan());
    expect(result).toContain("Easy Run");
    expect(result).toContain("Threshold Run");
    expect(result).toContain("Long Run");
  });

  it("includes Week number in event titles", () => {
    const result = generateICS(makePlan());
    expect(result).toContain("Week 1");
  });
});
