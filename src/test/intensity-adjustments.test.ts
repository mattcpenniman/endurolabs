import { describe, expect, it } from "vitest";
import { adjustWeeklyIntensityPercent } from "@/lib/training/intensity-adjustments";
import { generatePlan } from "@/lib/training/plan-generator";
import { RunnerProfile } from "@/lib/training/models";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";

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

function roundQuarter(distance: number): number {
  return Math.round(distance * 4) / 4;
}

describe("weekly intensity adjustments", () => {
  it("updates the actual marathon intensity mileage for a selected week", () => {
    const profile = makeProfile({ weeksOverride: 18, peakMileageOverride: 55 });
    const plan = generatePlan(profile);
    const week = plan.weeks.find((candidate) => candidate.phase === "marathon_build" && !candidate.isDownWeek);
    const paceZones = calculatePaceZones(profile);
    const powerZones = calculatePowerZones(profile, paceZones);

    expect(week).toBeDefined();
    const adjusted = adjustWeeklyIntensityPercent(week!, "marathon", 15, paceZones, powerZones);

    expect(adjusted.intensityDistribution.marathon).toBe(roundQuarter((adjusted.totalMileage * 15) / 100));
    expect(adjusted.days.some((day) =>
      day.workout?.type === "long" &&
      day.workout.segments.at(-1)?.type === "marathon_pace"
    )).toBe(true);
  });

  it("updates the actual threshold and VO2 mileage by editing workout segments", () => {
    const profile = makeProfile({ weeksOverride: 18, peakMileageOverride: 55 });
    const plan = generatePlan(profile);
    const week = plan.weeks.find((candidate) => candidate.phase === "marathon_build" && !candidate.isDownWeek);
    const paceZones = calculatePaceZones(profile);
    const powerZones = calculatePowerZones(profile, paceZones);

    expect(week).toBeDefined();
    const thresholdAdjusted = adjustWeeklyIntensityPercent(week!, "threshold", 8, paceZones, powerZones);
    const vo2Adjusted = adjustWeeklyIntensityPercent(week!, "vo2", 4, paceZones, powerZones);

    expect(thresholdAdjusted.intensityDistribution.threshold).toBe(roundQuarter((thresholdAdjusted.totalMileage * 8) / 100));
    expect(vo2Adjusted.intensityDistribution.vo2).toBe(roundQuarter((vo2Adjusted.totalMileage * 4) / 100));
    expect(thresholdAdjusted.days.some((day) =>
      day.workout?.segments.some((segment) => segment.type === "threshold")
    )).toBe(true);
    expect(vo2Adjusted.days.some((day) =>
      day.workout?.segments.some((segment) => segment.type === "vo2")
    )).toBe(true);
  });

  it("scales adjusted quality workouts as reps with matching recovery counts", () => {
    const profile = makeProfile({ weeksOverride: 18, peakMileageOverride: 55 });
    const plan = generatePlan(profile);
    const week = plan.weeks.find((candidate) => candidate.phase === "marathon_build" && !candidate.isDownWeek);
    const paceZones = calculatePaceZones(profile);
    const powerZones = calculatePowerZones(profile, paceZones);

    expect(week).toBeDefined();
    const adjusted = adjustWeeklyIntensityPercent(week!, "threshold", 12, paceZones, powerZones);
    const qualityWorkout = adjusted.days
      .flatMap((day) => [day.workout, day.secondaryWorkout])
      .find((workout) => workout?.segments.some((segment) => segment.description.includes("Threshold recoveries")));
    const thresholdSegment = qualityWorkout?.segments.find((segment) => segment.type === "threshold");
    const recoverySegment = qualityWorkout?.segments.find((segment) => segment.description.includes("Threshold recoveries"));

    expect(qualityWorkout?.segments.some((segment) => segment.description.includes("Adjusted block"))).toBe(false);
    expect(thresholdSegment?.repetitions).toBeGreaterThan(1);
    expect(recoverySegment?.description).toContain(`${(thresholdSegment?.repetitions ?? 1) - 1}×`);
  });
});
