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

function roundQuarter(value: number): number {
  return Math.round(value * 4) / 4;
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

function isQuarterMile(distance: number): boolean {
  return Number.isInteger(Math.round(distance * 100) / 25);
}

function hasPaceSpecificSegments(week: ReturnType<typeof generatePlan>["weeks"][number]): boolean {
  return week.days.some((day) =>
    [day.workout, day.secondaryWorkout].some((workout) =>
      workout?.segments.some((segment) =>
        segment.type === "threshold" || segment.type === "marathon_pace" || segment.type === "vo2"
      )
    )
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

  it("starts the plan on the Monday of the calculated start week", () => {
    const plan = generatePlan(makeProfile({ raceDate: "2026-12-01", weeksOverride: 18 }));

    expect(new Date(plan.weeks[0].startDate).toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(plan.weeks[0].days.map((day) => new Date(day.date).toISOString().slice(0, 10))).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("aligns a May 25, 2026 plan start to Monday", () => {
    const plan = generatePlan(makeProfile({ raceDate: "2026-09-21", weeksOverride: 18 }));

    expect(new Date(plan.weeks[0].startDate).toISOString().slice(0, 10)).toBe("2026-05-25");
    expect(plan.weeks[0].days[0].dayOfWeek).toBe("Monday");
    expect(new Date(plan.weeks[0].days[0].date).toISOString().slice(0, 10)).toBe("2026-05-25");
  });

  it("includes the full race week for the September 27 German race", () => {
    const plan = generatePlan(makeProfile({ raceDate: "2026-09-27", weeksOverride: 19 }));
    const finalWeek = plan.weeks.at(-1);

    expect(new Date(finalWeek!.startDate).toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(new Date(finalWeek!.endDate).toISOString().slice(0, 10)).toBe("2026-09-27");
    expect(finalWeek!.days.map((day) => new Date(day.date).toISOString().slice(0, 10))).toContain("2026-09-27");
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
      expect(longRun?.totalDistance).toBe(Math.round(week.totalMileage * 0.25 * 4) / 4);
      expect(week.longRunDistance).toBe(longRun?.totalDistance);
    }
  });

  it("recalculates an individual week from its mileage override", () => {
    const baseline = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 70 }));
    const weekNumber = baseline.weeks.find((week) => week.totalMileage > 60)?.weekNumber;
    expect(weekNumber).toBeDefined();
    if (weekNumber === undefined) throw new Error("Expected a week at or above 60 miles");

    const plan = generatePlan(makeProfile({
      weeksOverride: 18,
      peakMileageOverride: 70,
      weeklyMileageOverrides: { [weekNumber]: 60 },
    }));
    const adjustedWeek = plan.weeks[weekNumber - 1];
    const baselineWeek = baseline.weeks[weekNumber - 1];

    expect(adjustedWeek.totalMileage).toBe(60);
    expect(adjustedWeek.calculatedMileage).toBe(baselineWeek.totalMileage);
    expect(adjustedWeek.calculatedMileage).not.toBe(adjustedWeek.totalMileage);
    expect(scheduledMileage(adjustedWeek)).toBeCloseTo(60, 1);
    expect(adjustedWeek.longRunDistance).toBe(15);
    expect(adjustedWeek.intensityTargetDistribution?.easy).toBeGreaterThan(0);
  });

  it("caps long runs and redistributes weekly mileage to other days", () => {
    const plan = generatePlan(makeProfile({
      weeksOverride: 24,
      peakMileageOverride: 80,
      maxLongRunOverride: 16,
    }));

    for (const week of plan.weeks) {
      expect(week.longRunDistance).toBeLessThanOrEqual(16);
      expect(scheduledMileage(week)).toBeCloseTo(week.totalMileage, 1);
    }
  });

  it("keeps relatively shorter easy runs around the long run", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const buildWeek = plan.weeks.find((week) =>
      week.days.some((day) => day.dayOfWeek === "Saturday" && day.workout?.type === "easy") &&
      week.days.some((day) => day.dayOfWeek === "Wednesday" && day.workout?.type === "easy")
    );
    const saturday = buildWeek?.days.find((day) => day.dayOfWeek === "Saturday");
    const wednesday = buildWeek?.days.find((day) => day.dayOfWeek === "Wednesday");
    const otherEasyRuns = buildWeek?.days.filter(
      (day) => !["Saturday", "Wednesday"].includes(day.dayOfWeek) && day.workout?.type === "easy"
    ) ?? [];

    expect(saturday?.workout?.totalDistance).toBeDefined();
    expect(wednesday?.workout?.totalDistance).toBeDefined();
    expect(otherEasyRuns.length).toBeGreaterThan(0);
    expect(saturday?.workout?.totalDistance ?? 0).toBeLessThanOrEqual(
      Math.min(...otherEasyRuns.map((day) => day.workout?.totalDistance ?? 0))
    );
    expect(wednesday?.workout?.totalDistance ?? 0).toBeLessThanOrEqual(
      Math.min(...otherEasyRuns.map((day) => day.workout?.totalDistance ?? 0))
    );
  });

  it("rounds scheduled run distances to the nearest quarter mile", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));

    for (const week of plan.weeks) {
      for (const day of week.days) {
        if (day.workout && day.workout.weeklyMileageContribution > 0) {
          expect(isQuarterMile(day.workout.totalDistance)).toBe(true);
          expect(isQuarterMile(day.workout.weeklyMileageContribution)).toBe(true);
        }
        if (day.secondaryWorkout && day.secondaryWorkout.weeklyMileageContribution > 0) {
          expect(isQuarterMile(day.secondaryWorkout.totalDistance)).toBe(true);
          expect(isQuarterMile(day.secondaryWorkout.weeklyMileageContribution)).toBe(true);
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

  it("uses the selected preferred rest day when generating the schedule", () => {
    const plan = generatePlan(
      makeProfile({
        preferredRestDay: "Friday",
        availableLongRunDays: ["Sunday"],
        trainingDaysPerWeek: 5,
        runsPerWeekOverride: 5,
      })
    );

    for (const week of plan.weeks) {
      const friday = week.days.find((day) => day.dayOfWeek === "Friday");
      expect(friday?.isRestDay).toBe(true);
      expect(friday?.workout).toBeNull();
    }
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

  it("starts at current mileage and scales to peak using the prescribed 24-week pattern", () => {
    const plan = generatePlan(makeProfile({
      currentWeeklyMileage: 30,
      weeksOverride: 24,
      peakMileageOverride: 50,
    }));

    expect(plan.weeks.map((week) => week.totalMileage)).toEqual([
      30, 30, 30,
      35, 35, 35,
      40, 40, 35,
      45, 45, 35,
      50, 45, 40,
      50, 45, 35,
      50, 40, 35,
      35, 30, 30,
    ]);
  });

  it("reduces the number of peak blocks when the plan is shorter", () => {
    const plan = generatePlan(makeProfile({
      currentWeeklyMileage: 30,
      weeksOverride: 18,
      peakMileageOverride: 50,
    }));

    expect(plan.weeks.map((week) => week.totalMileage)).toEqual([
      30, 30, 30,
      35, 35, 35,
      40, 40, 35,
      45, 45, 35,
      50, 45, 40,
      35, 30, 30,
    ]);
  });

  it("tapers the final three weeks relative to the gap between start and peak mileage", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 80 }));
    const finalThreeWeeks = plan.weeks.slice(-3).map((week) => week.totalMileage);

    // currentWeeklyMileage defaults to 30, peakOverride is 80, gap = 50
    // Taper week -3: 80 - 50*0.3 = 65
    // Taper week -2: 80 - 50*0.4 = 60
    // Taper week -1: 80 - 50*0.4 = 60
    expect(finalThreeWeeks[1]).toBeLessThanOrEqual(finalThreeWeeks[0]);
    expect(finalThreeWeeks[2]).toBeLessThanOrEqual(finalThreeWeeks[1]);
    // All taper weeks should be below peak
    expect(finalThreeWeeks[2]).toBeLessThan(80);
  });

  it("keeps the first three and final three weeks aerobic base only", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const aerobicOnlyWeeks = [...plan.weeks.slice(0, 3), ...plan.weeks.slice(-3)];

    for (const week of aerobicOnlyWeeks) {
      expect(hasPaceSpecificSegments(week)).toBe(false);
      expect(week.intensityDistribution.threshold).toBe(0);
      expect(week.intensityDistribution.marathon).toBe(0);
      expect(week.intensityDistribution.vo2).toBe(0);
    }
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

  it("scales the minimum secondary run distance with weekly mileage", () => {
    const plan = generatePlan(
      makeProfile({
        trainingDaysPerWeek: 5,
        runsPerWeekOverride: 7,
        weeksOverride: 18,
        peakMileageOverride: 55,
      })
    );

    for (const week of plan.weeks) {
      const expectedMinimum = roundQuarter(Math.max(3, Math.min(6, week.totalMileage * 0.06)));
      const secondaryRuns = week.days.flatMap((day) =>
        day.secondaryWorkout ? [day.secondaryWorkout] : []
      );

      expect(secondaryRuns.length).toBe(2);
      for (const run of secondaryRuns) {
        expect(run.totalDistance).toBeGreaterThanOrEqual(expectedMinimum);
      }
    }
  });

  it("places secondary runs on preferred double-up days first", () => {
    const plan = generatePlan(
      makeProfile({
        trainingDaysPerWeek: 5,
        runsPerWeekOverride: 7,
        preferredDoubleUpDays: ["Thursday", "Saturday"],
        weeksOverride: 18,
        peakMileageOverride: 55,
      })
    );

    for (const week of plan.weeks) {
      const doubleUpDays = week.days
        .filter((day) => !!day.secondaryWorkout)
        .map((day) => day.dayOfWeek);

      expect(doubleUpDays).toEqual(expect.arrayContaining(["Thursday", "Saturday"]));
      expect(doubleUpDays.length).toBe(2);
    }
  });

  it("keeps high-volume double days balanced and protects the day after the long run", () => {
    const plan = generatePlan(
      makeProfile({
        currentWeeklyMileage: 60,
        peakHistoricalWeeklyMileage: 100,
        raceDate: "2026-09-27",
        weeksOverride: 19,
        peakMileageOverride: 90,
        trainingDaysPerWeek: 6,
        runsPerWeekOverride: 8,
        preferredRestDay: "Wednesday",
        availableLongRunDays: ["Saturday"],
        preferredDoubleUpDays: ["Monday", "Tuesday"],
      })
    );
    const august31Week = plan.weeks.find((week) =>
      week.days.some((day) => new Date(day.date).toISOString().slice(0, 10) === "2026-08-31")
    );

    expect(august31Week?.totalMileage).toBe(90);
    for (const day of august31Week?.days ?? []) {
      if (day.dayOfWeek !== "Saturday") {
        expect(day.plannedMileage).toBeLessThanOrEqual(16.25);
      }
    }

    const monday = august31Week?.days.find((day) => day.dayOfWeek === "Monday");
    const sunday = august31Week?.days.find((day) => day.dayOfWeek === "Sunday");
    expect(monday?.plannedMileage).toBeLessThanOrEqual(16.25);
    expect(sunday?.plannedMileage).toBeLessThanOrEqual(11);
    expect(sunday?.workout?.type).toBe("recovery");
    expect(scheduledMileage(august31Week!)).toBeCloseTo(august31Week!.totalMileage, 1);
  });

  it("varies quality workout formats across the plan", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const titles = plan.weeks.flatMap((week) =>
      week.days.flatMap((day) => (day.workout ? [day.workout.title] : []))
    );

    expect(titles.some((title) => title.includes("Cruise Intervals") || title.includes("Threshold Ladder"))).toBe(true);
    expect(titles.some((title) => title.includes("VO2 Intervals") || title.includes("VO2 + Speed Mix"))).toBe(true);
    expect(titles.some((title) => title.includes("Marathon Pace") || title.includes("M +"))).toBe(true);
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

  it("calculates weekly quality totals from repeated work segments, not full workout distance", () => {
    const plan = generatePlan(makeProfile({ weeksOverride: 18, peakMileageOverride: 55 }));
    const intervalWeek = plan.weeks.find((week) =>
      week.days.some((day) =>
        day.workout?.segments.some((segment) => segment.type === "threshold" && segment.repetitions === 3 && segment.distance === 1)
      )
    );

    expect(intervalWeek).toBeDefined();
    expect(intervalWeek?.intensityDistribution.threshold).toBe(3);
  });

  it("respects weekly intensity overrides for specific weeks", () => {
    const plan = generatePlan(
      makeProfile({
        weeksOverride: 18,
        peakMileageOverride: 50,
        intensityTargetPercents: { marathon: 10, threshold: 5, vo2: 2 },
        weeklyIntensityOverrides: {
          10: { marathon: 20 },
        },
      })
    );

    const week10 = plan.weeks.find((w) => w.weekNumber === 10);
    const week11 = plan.weeks.find((w) => w.weekNumber === 11);

    expect(week10?.intensityTargetDistribution?.marathon).toBe(
      roundQuarter(((week10?.totalMileage ?? 0) * 20) / 100)
    );
    expect(week11?.intensityTargetDistribution?.marathon).toBe(
      roundQuarter(((week11?.totalMileage ?? 0) * 10) / 100)
    );
  });
});
