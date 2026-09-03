// ============================================================
// EnduroLab - Garmin Activity Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { isRunningActivity, matchActivityToPlan, normalizeGarminActivity } from "@/lib/garmin/activities";
import { generatePlan } from "@/lib/training/plan-generator";
import { RunnerProfile } from "@/lib/training/models";

function profile(): RunnerProfile {
  return {
    currentWeeklyMileage: 30,
    peakHistoricalWeeklyMileage: 40,
    currentMarathonPR: 240,
    currentHalfMarathonPR: 112,
    goalMarathonTime: 235,
    raceDate: "2026-12-01",
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
    weeksOverride: 18,
  };
}

describe("Garmin activities", () => {
  it("normalizes Garmin units and preserves the local calendar date", () => {
    const activity = normalizeGarminActivity({
      activityId: 12345,
      activityName: "Morning Run",
      activityType: { typeKey: "street_running" },
      startTimeLocal: "2026-08-04 06:30:00",
      startTimeGMT: "2026-08-04 10:30:00",
      distance: 8046.72,
      duration: 2400.4,
      averageHR: 151.2,
      avgPower: 278.7,
    });

    expect(activity.providerActivityId).toBe("12345");
    expect(activity.source).toBe("garmin");
    expect(activity.powerSource).toBe("garmin");
    expect(activity.localDate).toBe("2026-08-04");
    expect(activity.distanceMeters).toBe(8047);
    expect(activity.durationSeconds).toBe(2400);
    expect(activity.averageHeartRate).toBe(151);
    expect(activity.averagePower).toBe(279);
  });

  it("records Apple-origin power forwarded through Garmin", () => {
    const activity = normalizeGarminActivity({
      activityId: 12346,
      startTimeLocal: "2026-08-04 06:30:00",
      startTimeGMT: "2026-08-04 10:30:00",
      manufacturer: "Apple",
    });
    expect(activity.source).toBe("garmin");
    expect(activity.powerSource).toBe("apple_watch");
  });

  it("recognizes indoor, trail, and street running types", () => {
    for (const typeKey of ["street_running", "trail_running", "indoor_running"]) {
      expect(isRunningActivity({
        activityId: 1,
        startTimeLocal: "2026-08-04 06:30:00",
        startTimeGMT: "2026-08-04 10:30:00",
        activityType: { typeKey },
      })).toBe(true);
    }
  });

  it("matches a run to the same-date workout with closest distance", () => {
    const plan = generatePlan(profile());
    const scheduled = plan.weeks
      .flatMap((week) => week.days.map((day) => ({ week, day })))
      .find(({ day }) => Boolean(day.workout && day.workout.totalDistance > 0));
    expect(scheduled?.day.workout).toBeTruthy();
    if (!scheduled?.day.workout) return;

    const match = matchActivityToPlan({
      localDate: scheduled.day.date.slice(0, 10),
      distanceMeters: scheduled.day.workout.totalDistance * 1609.344,
    }, plan);

    expect(match).toMatchObject({
      weekNumber: scheduled.week.weekNumber,
      dayOfWeek: scheduled.day.dayOfWeek,
      plannedWorkoutId: scheduled.day.workout.id,
      matchConfidence: "high",
    });
  });

  it("does not match dates outside the plan or already claimed workouts", () => {
    const plan = generatePlan(profile());
    const workout = plan.weeks.flatMap((week) => week.days).find((day) => day.workout)?.workout;
    expect(matchActivityToPlan({ localDate: "2020-01-01", distanceMeters: 5000 }, plan)).toBeNull();
    if (!workout) return;
    const day = plan.weeks.flatMap((week) => week.days).find((candidate) => candidate.workout?.id === workout.id);
    expect(matchActivityToPlan(
      { localDate: day?.date.slice(0, 10) ?? "", distanceMeters: workout.totalDistance * 1609.344 },
      plan,
      new Set([workout.id])
    )).toBeNull();
  });
});
