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

function scheduledMileage(week: ReturnType<typeof generatePlan>["weeks"][number]): number {
  return Math.round(
    week.days.reduce(
      (sum, day) =>
        sum +
        (day.workout?.weeklyMileageContribution ?? 0) +
        (day.secondaryWorkout?.weeklyMileageContribution ?? 0),
      0
    ) * 10
  ) / 10;
}

function scheduledRunCount(week: ReturnType<typeof generatePlan>["weeks"][number]): number {
  return week.days.reduce(
    (sum, day) =>
      sum +
      (day.workout && day.workout.weeklyMileageContribution > 0 ? 1 : 0) +
      (day.secondaryWorkout && day.secondaryWorkout.weeklyMileageContribution > 0 ? 1 : 0),
    0
  );
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

  it("orders each week Monday through Sunday", () => {
    const plan = generatePlan(makeProfile());
    const expectedOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    for (const week of plan.weeks) {
      expect(week.days.map((day) => day.dayOfWeek)).toEqual(expectedOrder);
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

  it("sets long runs to 25% of weekly mileage", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));

    for (const week of plan.weeks) {
      const longRun = week.days.find((day) => day.workout?.type === "long")?.workout;

      expect(longRun).toBeDefined();
      expect(longRun?.totalDistance).toBe(Math.round(week.totalMileage * 0.25 * 10) / 10);
      expect(week.longRunDistance).toBe(longRun?.totalDistance);
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

  it("schedules workout mileage to match each weekly target", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));

    for (const week of plan.weeks) {
      expect(scheduledMileage(week)).toBeCloseTo(week.totalMileage, 1);
    }
  });

  it("reaches the requested peak mileage", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const peakScheduledMileage = Math.max(...plan.weeks.map(scheduledMileage));

    expect(plan.peakWeeklyMileage).toBe(55);
    expect(peakScheduledMileage).toBeCloseTo(55, 1);
  });

  it("honors requested runs per week with double days", () => {
    const plan = generatePlan(
      makeProfile({
        trainingDaysPerWeek: 5,
        runsPerWeekOverride: 7,
        weeksOverride: 18,
        peakMileageOverride: 55,
      })
    );

    for (const week of plan.weeks) {
      expect(scheduledRunCount(week)).toBe(7);
    }
  });

  it("varies quality workout formats across the plan", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const titles = plan.weeks.flatMap((week) =>
      week.days.flatMap((day) => (day.workout ? [day.workout.title] : []))
    );

    expect(titles.some((title) => title.includes("Cruise Intervals"))).toBe(true);
    expect(titles.some((title) => title.includes("VO2 Intervals"))).toBe(true);
    expect(titles.some((title) => title.includes("Marathon Pace"))).toBe(true);
    expect(titles.some((title) => title.includes("Progression Run"))).toBe(true);
  });

  it("varies run distances from day to day within each week", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const weeksWithSeveralEasyRuns = plan.weeks.filter((week) => {
      const easyDistances = week.days
        .filter((day) => day.workout?.type === "easy" || day.workout?.type === "recovery")
        .map((day) => day.workout?.totalDistance ?? 0);

      return easyDistances.length >= 3 && new Set(easyDistances).size >= 2;
    });

    expect(weeksWithSeveralEasyRuns.length).toBeGreaterThan(plan.weeks.length / 2);
  });

  it("keeps VO2 reps in a Daniels-style interval duration range", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const vo2Segments = plan.weeks.flatMap((week) =>
      week.days.flatMap((day) =>
        day.workout?.segments.filter((segment) => segment.type === "vo2" && segment.distance && segment.pace) ?? []
      )
    );

    expect(vo2Segments.length).toBeGreaterThan(0);
    for (const segment of vo2Segments) {
      const duration = (segment.distance ?? 0) * (segment.pace ?? 0);
      expect(duration).toBeGreaterThanOrEqual(2.5);
      expect(duration).toBeLessThanOrEqual(5.25);
    }
  });

  it("gives VO2 workouts explicit warm-up, recovery, and cool-down segments", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const vo2Workouts = plan.weeks.flatMap((week) =>
      week.days.flatMap((day) => (day.workout?.type === "vo2" ? [day.workout] : []))
    );

    expect(vo2Workouts.length).toBeGreaterThan(0);
    for (const workout of vo2Workouts) {
      expect(workout.segments[0].description).toContain("Warm-up");
      expect(workout.segments.some((segment) => segment.description.includes("Recoveries"))).toBe(true);
      expect(workout.segments.at(-1)?.description).toContain("Cool-down");
    }
  });
});
