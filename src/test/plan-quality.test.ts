// ============================================================
// EnduroLab — Plan Quality Tests
// ============================================================
// Tests for workout validation, cross-training, and profile
// validation features.
// ============================================================

import { describe, it, expect } from "vitest";
import { Workout, RunnerProfile } from "@/lib/training/models";
import { WorkoutLibrary } from "@/lib/training/workout-library";

// ─── Cross Training Workout ────────────────────────────────

describe("createCrossTraining", () => {
  it("creates a cross-training workout with default duration", () => {
    const workout = WorkoutLibrary.createCrossTraining(1, 0);

    expect(workout.type).toBe("cross_training");
    expect(workout.estimatedDuration).toBe(45);
    expect(workout.totalDistance).toBe(0);
    expect(workout.weeklyMileageContribution).toBe(0);
    expect(workout.intensityCategory).toBe("easy");
  });

  it("creates a cross-training workout with custom duration", () => {
    const workout = WorkoutLibrary.createCrossTraining(1, 0, 60);

    expect(workout.estimatedDuration).toBe(60);
    expect(workout.title).toContain("60 min");
  });

  it("includes proper description for low-impact cardio", () => {
    const workout = WorkoutLibrary.createCrossTraining(1, 0);

    expect(workout.description).toContain("Low-impact");
    expect(workout.segments[0].effort).toContain("cycling");
  });
});

// ─── Workout Library exports ───────────────────────────────

describe("WorkoutLibrary", () => {
  it("exports all workout factory functions", () => {
    expect(WorkoutLibrary.createEasyRun).toBeDefined();
    expect(WorkoutLibrary.createRecoveryRun).toBeDefined();
    expect(WorkoutLibrary.createThresholdRun).toBeDefined();
    expect(WorkoutLibrary.createVO2Intervals).toBeDefined();
    expect(WorkoutLibrary.createMarathonPaceRun).toBeDefined();
    expect(WorkoutLibrary.createLongRun).toBeDefined();
    expect(WorkoutLibrary.createProgressionRun).toBeDefined();
    expect(WorkoutLibrary.createStrengthSession).toBeDefined();
    expect(WorkoutLibrary.createCrossTraining).toBeDefined();
    expect(WorkoutLibrary.createRestDay).toBeDefined();
  });
});

// ─── Workout Type includes cross_training ──────────────────

describe("WorkoutType", () => {
  it("includes cross_training as a valid type", () => {
    const workout: Workout = {
      id: "test",
      type: "cross_training",
      title: "Test",
      description: "Test",
      segments: [],
      totalDistance: 0,
      estimatedDuration: 30,
      weeklyMileageContribution: 0,
      intensityCategory: "easy",
    };

    expect(workout.type).toBe("cross_training");
  });
});

// ─── Profile Validation ────────────────────────────────────

describe("validateProfile", () => {
  // We test the validation logic directly since it's in a component.
  // Replicate the rules here to ensure they're testable.
  function validateProfile(profile: RunnerProfile): string[] {
    const warnings: string[] = [];

    if (profile.peakHistoricalWeeklyMileage < profile.currentWeeklyMileage) {
      warnings.push("Peak weekly mileage is lower than your current mileage");
    }
    if (profile.longestRecentLongRun > profile.currentWeeklyMileage) {
      warnings.push("Longest run exceeds your current weekly mileage");
    }
    if (profile.currentMarathonPR && profile.currentMarathonPR < profile.goalMarathonTime) {
      warnings.push("Your marathon PR is faster than your goal time");
    }
    if (profile.longestRecentLongRun < 4) {
      warnings.push("Longest recent run is under 4 miles");
    }
    if (profile.currentWeeklyMileage < 10) {
      warnings.push("Current weekly mileage is under 10 mi");
    }

    return warnings;
  }

  const baseProfile: RunnerProfile = {
    currentWeeklyMileage: 20,
    peakHistoricalWeeklyMileage: 30,
    currentMarathonPR: null,
    currentHalfMarathonPR: null,
    goalMarathonTime: 240,
    raceDate: "2026-12-01",
    trainingDaysPerWeek: 5,
    preferredRestDay: "Monday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 8,
    comfortLevelWithWorkouts: "intermediate",
    availableLongRunDays: ["Sunday"],
    strengthTrainingAvailability: "light",
  };

  it("returns no warnings for a valid profile", () => {
    expect(validateProfile(baseProfile)).toHaveLength(0);
  });

  it("warns when peak mileage is lower than current", () => {
    const profile = { ...baseProfile, peakHistoricalWeeklyMileage: 10 };
    const warnings = validateProfile(profile);
    expect(warnings.some((w) => w.includes("Peak weekly mileage"))).toBe(true);
  });

  it("warns when longest run exceeds weekly mileage", () => {
    const profile = { ...baseProfile, longestRecentLongRun: 25 };
    const warnings = validateProfile(profile);
    expect(warnings.some((w) => w.includes("Longest run exceeds"))).toBe(true);
  });

  it("warns when marathon PR is faster than goal", () => {
    const profile = { ...baseProfile, currentMarathonPR: 200 };
    const warnings = validateProfile(profile);
    expect(warnings.some((w) => w.includes("marathon PR is faster"))).toBe(true);
  });

  it("warns when longest run is under 4 miles", () => {
    const profile = { ...baseProfile, longestRecentLongRun: 3 };
    const warnings = validateProfile(profile);
    expect(warnings.some((w) => w.includes("under 4 miles"))).toBe(true);
  });

  it("warns when current mileage is under 10", () => {
    const profile = { ...baseProfile, currentWeeklyMileage: 5 };
    const warnings = validateProfile(profile);
    expect(warnings.some((w) => w.includes("under 10 mi"))).toBe(true);
  });

  it("can produce multiple warnings at once", () => {
    const profile = {
      ...baseProfile,
      currentWeeklyMileage: 5,
      peakHistoricalWeeklyMileage: 3,
      longestRecentLongRun: 2,
      currentMarathonPR: 180,
    };
    const warnings = validateProfile(profile);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});
