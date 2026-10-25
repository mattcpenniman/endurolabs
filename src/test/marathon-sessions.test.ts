/** Regression checks against the published marathon schedule and training limits. */
import { describe, expect, it } from "vitest";
import { generatePlan } from "@/lib/training/plan-generator";
import { RunnerProfile, Workout } from "@/lib/training/models";
import { buildMarathonSessions, MarathonSessionsInput } from "@/lib/training/marathon-sessions";
import { calculatePaceZones } from "@/lib/training/zone-calculator";

function profile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    raceDate: "2027-04-17", weeksOverride: 24, goalMarathonTime: 179 + 59 / 60,
    currentWeeklyMileage: 48, peakHistoricalWeeklyMileage: 100, peakMileageOverride: 80,
    currentMarathonPR: null, currentHalfMarathonPR: null, averageEasyPace: null,
    averageThresholdPace: null, averageMarathonPace: null, hasAppleWatchPower: false,
    trainingDaysPerWeek: 6, runsPerWeekOverride: 8, preferredRestDay: "Wednesday",
    availableLongRunDays: ["Saturday"], preferredDoubleUpDays: ["Monday", "Tuesday"],
    longestRecentLongRun: 20, comfortLevelWithWorkouts: "intermediate",
    recentInjuryHistory: "None", strengthTrainingAvailability: "light", ...overrides,
  };
}

function miles(workout: Workout, type: string): number {
  return workout.segments.filter((segment) => segment.type === type)
    .reduce((sum, segment) => sum + (segment.distance ?? 0) * (segment.repetitions ?? 1), 0);
}

describe("documented marathon prescriptions", () => {
  it("uses six aerobic weeks, then places M/T, T/E/T and steady E in the Q1 long slot", () => {
    const plan = generatePlan(profile());
    expect(plan.phases[0].weekRange).toEqual([1, 6]);
    for (const week of plan.weeks.slice(0, 6)) {
      expect(week.intensityDistribution.threshold + week.intensityDistribution.marathon + week.intensityDistribution.vo2).toBe(0);
    }
    for (const week of plan.weeks.slice(3, 6)) {
      expect(week.days.filter((day) => day.workout?.title.includes("Strides")).length).toBeGreaterThanOrEqual(2);
    }
    for (const number of [7, 10, 13, 16, 19, 22]) {
      const week = plan.weeks[number - 1];
      const long = week.days.find((day) => day.dayOfWeek === "Saturday")!.workout!;
      expect(long.type).toBe("long");
      expect(miles(long, "marathon_pace")).toBeGreaterThan(0);
      expect(miles(long, "threshold")).toBeGreaterThan(0);
      expect(week.days.find((day) => day.dayOfWeek === "Tuesday")!.workout!.type).toBe("threshold");
    }
    expect(miles(plan.weeks[6].days.find((day) => day.dayOfWeek === "Saturday")!.workout!, "marathon_pace")).toBe(4);
    for (const number of [8, 11, 14, 17, 20, 23]) {
      expect(plan.weeks[number - 1].days.find((day) => day.dayOfWeek === "Saturday")!.workout!.title).toContain("T/E/T");
    }
    for (const week of plan.weeks.filter((week) => week.isDownWeek)) {
      const long = week.days.find((day) => day.dayOfWeek === "Saturday")!.workout!;
      expect(miles(long, "marathon_pace") + miles(long, "threshold")).toBe(0);
      expect(week.intensityDistribution.threshold).toBeGreaterThan(0);
    }
  });

  it("retains taper quality and the explicitly documented five-day sharpener", () => {
    const plan = generatePlan(profile());
    expect(plan.weeks.slice(-4, -1).map((week) => week.totalMileage)).toEqual([56, 56, 48]);
    for (const week of plan.weeks.slice(-4, -1)) {
      expect(week.intensityDistribution.threshold + week.intensityDistribution.marathon + week.intensityDistribution.vo2).toBeGreaterThan(0);
    }
    const raceWeek = plan.weeks.at(-1)!;
    const sharpener = raceWeek.days.find((day) => day.date.startsWith("2027-04-12"))!.workout!;
    expect(sharpener.segments.find((segment) => segment.type === "threshold")).toMatchObject({ repetitions: 4, distance: 0.75, restBetween: 120 });
    expect(sharpener.segments[0].distance).toBe(2);
    expect(sharpener.segments.at(-1)!.distance).toBe(2);
    expect(raceWeek.intensityTargetDistribution).toEqual(raceWeek.intensityDistribution);
    expect(raceWeek.days.find((day) => day.date.startsWith("2027-04-18"))!.isRestDay).toBe(true);
  });

  it.each([{}, { intensityTargetPercents: { threshold: 20, marathon: 30, vo2: 10 } }])(
    "bounds work and recoveries even with high intensity requests: %o", (overrides) => {
      const plan = generatePlan(profile(overrides));
      for (const week of plan.weeks.filter((week) => !week.isRaceWeek)) {
        const dist = week.intensityDistribution;
        expect(dist.threshold).toBeLessThanOrEqual(Math.min(week.totalMileage * 0.1, 60 / plan.paceZones.threshold));
        expect(dist.marathon).toBeLessThanOrEqual(Math.min(16, 90 / plan.paceZones.marathon));
        expect(dist.vo2).toBeLessThanOrEqual(Math.min(10 / 1.609344, week.totalMileage * 0.08));
        expect(week.longRunDistance).toBeLessThanOrEqual(week.totalMileage * 0.25);
        const long = week.days.find((day) => day.workout?.type === "long")!.workout!;
        expect(long.segments.reduce((sum, segment) => sum +
          (segment.duration ?? (segment.distance ?? 0) * (segment.pace ?? 0)) * (segment.repetitions ?? 1), 0)).toBeLessThanOrEqual(160);
        for (const day of week.days) {
          if (day.secondaryWorkout) expect(day.secondaryWorkout.totalDistance).toBeLessThanOrEqual(6);
          for (const workout of [day.workout, day.secondaryWorkout].filter((workout): workout is Workout => !!workout)) {
            if (workout.type === "recovery") expect(workout.estimatedDuration).toBeLessThanOrEqual(60);
            for (const segment of workout.segments) {
              if (segment.type === "vo2") {
                expect(segment.distance! * segment.pace!).toBeLessThanOrEqual(5);
                expect(segment.restBetween! / 60).toBeLessThanOrEqual(segment.distance! * segment.pace! + 1 / 60);
              }
              if (segment.type === "threshold") {
                expect(segment.distance! * segment.pace!).toBeLessThanOrEqual(15);
                if (segment.restBetween) expect(segment.restBetween).toBeCloseTo(segment.distance! * segment.pace! * 12, 0);
              }
            }
          }
        }
      }
    }
  );

  it.each([14, 18, 24, 28])("keeps both sessions, mileage arithmetic and spacing consistent in a %i-week plan", (weeks) => {
    const plan = generatePlan(profile({ weeksOverride: weeks }));
    for (const week of plan.weeks) {
      let total = 0;
      const qualityDates: number[] = [];
      for (const day of week.days) {
        let dayMiles = 0;
        for (const workout of [day.workout, day.secondaryWorkout].filter((workout): workout is Workout => !!workout)) {
          const segmentMiles = workout.segments.reduce((sum, segment) => sum + (segment.distance ?? 0) * (segment.repetitions ?? 1), 0);
          expect(segmentMiles).toBeCloseTo(workout.totalDistance, 6);
          total += workout.weeklyMileageContribution;
          dayMiles += workout.totalDistance;
        }
        expect(dayMiles).toBeCloseTo(day.plannedMileage, 6);
        if (!week.isRaceWeek && day.workout?.intensityCategory === "hard") qualityDates.push(Date.parse(day.date));
      }
      expect(total).toBeCloseTo(week.totalMileage, 6);
      for (let i = 1; i < qualityDates.length; i++) expect(qualityDates[i] - qualityDates[i - 1]).toBeGreaterThanOrEqual(2 * 86400000);
    }
  });

  it("does not force impossible mileage into giant easy or recovery runs", () => {
    const plan = generatePlan(profile({ goalMarathonTime: 300, currentMarathonPR: 300,
      runsPerWeekOverride: 5, trainingDaysPerWeek: 5, peakMileageOverride: 100 }));
    expect(plan.peakWeeklyMileage).toBeLessThan(100);
    expect(plan.riskWarnings.some((warning) => warning.includes("scheduled volume is reduced"))).toBe(true);
    for (const week of plan.weeks.filter((week) => !week.isRaceWeek)) {
      expect(week.longRunDistance).toBeLessThanOrEqual(week.totalMileage * 0.25);
      expect(week.intensityDistribution.threshold).toBeLessThanOrEqual(week.totalMileage * 0.1);
      for (const day of week.days) if (day.workout) expect(day.workout.estimatedDuration).toBeLessThanOrEqual(day.workout.type === "long" ? 160 : 150);
    }
  });

  it("honors zero quality targets instead of inventing fallback hard miles", () => {
    const plan = generatePlan(profile({ intensityTargetPercents: { marathon: 0, threshold: 0, vo2: 0 } }));
    for (const week of plan.weeks.filter((week) => !week.isRaceWeek)) {
      expect(week.intensityDistribution.threshold + week.intensityDistribution.marathon + week.intensityDistribution.vo2).toBe(0);
    }
  });

  it("starts compressed plans with an introductory M dose and omits Q2 when no separated day exists", () => {
    const short = generatePlan(profile({ weeksOverride: 14 }));
    const firstMarathon = short.weeks.flatMap((week) => week.days)
      .map((day) => day.workout).find((workout) => workout && miles(workout, "marathon_pace") > 0)!;
    expect(miles(firstMarathon, "marathon_pace")).toBeLessThanOrEqual(4);
    const sparse = generatePlan(profile({ trainingDaysPerWeek: 2, runsPerWeekOverride: 3 }));
    for (const week of sparse.weeks.filter((week) => !week.isRaceWeek)) {
      expect(week.days.filter((day) => ["threshold", "vo2"].includes(day.workout?.type ?? ""))).toHaveLength(0);
    }
  });
});

describe("segment-aware long-run duration", () => {
  function input(easyPace: number, overrides: Partial<MarathonSessionsInput> = {}): MarathonSessionsInput {
    return {
      week: 13, weeksBeforeRace: 11, weeklyMileage: 80, longRunMiles: 20,
      secondSessionBudget: 10, isDownWeek: false, allowQuality: true,
      targets: { easy: 60, marathon: 8, threshold: 8, vo2: 4 },
      paceZones: { ...calculatePaceZones(profile()), easy: { min: easyPace, max: easyPace }, marathon: 7, threshold: 6 },
      ...overrides,
    };
  }

  it("keeps 20 mixed-pace miles that take 158 minutes even though all-E would take 180", () => {
    const { longRun } = buildMarathonSessions(input(9));
    expect(longRun.totalDistance).toBe(20);
    expect(miles(longRun, "marathon_pace")).toBe(8);
    expect(miles(longRun, "threshold")).toBe(2);
    expect(longRun.estimatedDuration).toBe(158); // 10 E x 9 + 8 M x 7 + 2 T x 6
  });

  it("rebuilds an over-limit mixed session and returns its released miles to the plan", () => {
    const { longRun, keyWorkout } = buildMarathonSessions(input(10));
    expect(longRun.totalDistance).toBe(19);
    expect(longRun.estimatedDuration).toBe(158); // 19.25 miles would take 160.5 minutes
    expect(miles(longRun, "threshold") + miles(keyWorkout!, "threshold")).toBeLessThanOrEqual(8);
    const plan = generatePlan(profile());
    for (const week of plan.weeks.filter((week) => !week.isRaceWeek)) {
      const long = week.days.find((day) => day.dayOfWeek === "Saturday")!;
      expect(week.longRunDistance).toBe(long.workout!.totalDistance);
      expect(long.plannedMileage).toBe(long.workout!.totalDistance + (long.secondaryWorkout?.totalDistance ?? 0));
      expect(week.days.reduce((sum, day) => sum + day.plannedMileage, 0)).toBe(week.totalMileage);
    }
    expect(plan.weeks[12].longRunDistance).toBe(20);
    expect(plan.peakWeeklyMileage).toBe(80);
  });

  it("allows exactly 160 minutes but checks unrounded segment time above the boundary", () => {
    expect(buildMarathonSessions(input(8, { allowQuality: false })).longRun.totalDistance).toBe(20);
    const { longRun } = buildMarathonSessions(input(8.01, { allowQuality: false }));
    // 20 x 8.01 = 160.2, even though estimatedDuration would round to 160.
    expect(longRun.totalDistance).toBe(19.75);
    expect(longRun.estimatedDuration).toBe(158);
  });

  it("also rebuilds threshold/easy/threshold long runs using their mixed segment time", () => {
    const { longRun, keyWorkout } = buildMarathonSessions(input(9.6, { week: 14, weeksBeforeRace: 10 }));
    expect(longRun.title).toContain("T/E/T");
    expect(longRun.totalDistance).toBe(18);
    expect(miles(longRun, "threshold")).toBe(4);
    // 14 E x 9.6 + 4 T x 6 = 158.4; the next quarter mile would take 160.8.
    expect(longRun.estimatedDuration).toBe(158);
    expect(miles(longRun, "threshold") + miles(keyWorkout!, "threshold")).toBeLessThanOrEqual(8);
  });

  it("enforces the weekly share and user distance cap even when faster segments would fit", () => {
    expect(buildMarathonSessions(input(8, { weeklyMileage: 72 })).longRun.totalDistance).toBe(18);
    expect(buildMarathonSessions(input(8, { longRunMiles: 16 })).longRun.totalDistance).toBe(16);
    const plan = generatePlan(profile({ maxLongRunOverride: 16 }));
    expect(Math.max(...plan.weeks.map((week) => week.longRunDistance))).toBe(16);
  });
});
