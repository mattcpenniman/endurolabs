import { describe, expect, it } from "vitest";
import { adjustWeeklyIntensityPercent } from "@/lib/training/intensity-adjustments";
import { generatePlan } from "@/lib/training/plan-generator";
import { RunnerProfile, WeeklyPlan } from "@/lib/training/models";
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

  it("keeps adjusted quality reps and recoveries before the cool-down", () => {
    const profile = makeProfile();
    const paceZones = calculatePaceZones(profile);
    const week: WeeklyPlan = {
      weekNumber: 1,
      startDate: "2026-01-05",
      endDate: "2026-01-11",
      phase: "marathon_build",
      totalMileage: 7.75,
      isDownWeek: false,
      longRunDistance: 0,
      intensityDistribution: { easy: 4.25, threshold: 3.5, marathon: 0, vo2: 0 },
      days: [
        {
          date: "2026-01-06",
          dayOfWeek: "Tuesday",
          isRestDay: false,
          plannedMileage: 7.75,
          workout: {
            id: "threshold-order-regression",
            type: "threshold",
            title: "3.5 mi Threshold Work",
            description: "Threshold intervals.",
            totalDistance: 7.75,
            estimatedDuration: 45,
            weeklyMileageContribution: 7.75,
            intensityCategory: "hard",
            segments: [
              {
                description: "Easy run — 3 miles at conversational pace",
                distance: 3,
                pace: paceZones.easy.min,
                effort: paceZones.easyEffort,
                type: "easy",
              },
              {
                description: "Recoveries — 2× 1 min relaxed jog (0.25 mi total)",
                distance: 0.25,
                pace: paceZones.recovery,
                effort: "Relaxed jog between threshold reps",
                type: "recovery",
              },
              {
                description: "Cool-down — 1 mi easy pace",
                distance: 1,
                pace: paceZones.easy.min,
                effort: paceZones.easyEffort,
                type: "easy",
              },
              {
                description: "2× 1.75 mi at threshold pace",
                distance: 1.75,
                pace: paceZones.threshold,
                effort: paceZones.thresholdEffort,
                repetitions: 2,
                restBetween: 60,
                type: "threshold",
              },
            ],
          },
        },
      ],
    };

    const adjusted = adjustWeeklyIntensityPercent(week, "threshold", 70, paceZones);
    const workout = adjusted.days[0].workout!;
    const thresholdIndex = workout.segments.findIndex((segment) => segment.type === "threshold");
    const recoveryIndex = workout.segments.findIndex((segment) =>
      segment.description.includes("Threshold recoveries")
    );
    const staleRecoveryIndex = workout.segments.findIndex((segment) =>
      segment.description.startsWith("Recoveries —")
    );
    const cooldownIndex = workout.segments.findIndex((segment) =>
      segment.description.toLowerCase().includes("cool-down")
    );

    expect(thresholdIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(thresholdIndex);
    expect(staleRecoveryIndex).toBe(-1);
    expect(cooldownIndex).toBeGreaterThan(recoveryIndex);
  });
});
