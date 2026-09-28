// ============================================================
// EnduroLab — Impact Beacon Tests
// ============================================================
// Plan-vs-actual readiness status, time-at-effort consumption,
// the pro-rated planned window, and the beacon whitelist gate.
// ============================================================

import { describe, expect, it } from "vitest";
import { buildImpactBeacon, type ImpactBeaconRun } from "@/lib/analytics/impact-beacon";
import { beaconReadinessMetrics } from "@/lib/analytics/readiness-metrics";
import type {
  EffortZone,
  TimeAtEffortBreakdown,
  TimeAtEffortSummary,
} from "@/lib/analytics/time-at-effort";
import { generatePlan } from "@/lib/training/plan-generator";
import type {
  DailyPlan,
  HeartRateZone,
  MarathonPlan,
  RunnerProfile,
  WeeklyPlan,
  Workout,
} from "@/lib/training/models";

const ZONES: readonly EffortZone[] = ["recovery", "easy", "marathon", "threshold", "vo2"];
const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function hrZone(max: number): HeartRateZone {
  return {
    hrrPercent: { min: 0.6, max: 0.8 },
    hrMaxPercent: { min: 0.7, max: 0.9 },
    targetBpm: { min: max - 5, max },
  };
}

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 45,
    peakHistoricalWeeklyMileage: 60,
    currentMarathonPR: 195,
    currentHalfMarathonPR: 90,
    goalMarathonTime: 180,
    raceDate: "2026-10-04",
    raceName: "Test Marathon",
    trainingDaysPerWeek: 6,
    preferredRestDay: "Monday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 16,
    comfortLevelWithWorkouts: "advanced",
    availableLongRunDays: ["Sunday"],
    strengthTrainingAvailability: "light",
    ...overrides,
  };
}

function workout(
  id: string,
  type: Workout["type"],
  totalDistance: number,
  estimatedDuration: number,
  segments: Workout["segments"] = [],
): Workout {
  return {
    id,
    type,
    title: id,
    description: "",
    segments,
    totalDistance,
    estimatedDuration,
    weeklyMileageContribution: totalDistance,
    intensityCategory: "easy",
  };
}

function longRun(id: string, distance: number, marathonMiles: number, minutes: number): Workout {
  return workout(
    id,
    "long",
    distance,
    minutes,
    marathonMiles > 0
      ? [{ description: "Marathon-pace finish", distance: marathonMiles, pace: 7, type: "marathon_pace" }]
      : [],
  );
}

function makeWeek(input: {
  weekNumber: number;
  startDate: string;
  totalMileage: number;
  longRunDistance: number;
  entries: Record<string, Workout>;
}): WeeklyPlan {
  const days: DailyPlan[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(input.startDate, index);
    const planned = input.entries[date] ?? null;
    return {
      date,
      dayOfWeek: new Date(`${date}T00:00:00Z`).toUTCString().slice(0, 3),
      workout: planned,
      isRestDay: planned === null,
      plannedMileage: planned?.totalDistance ?? 0,
    };
  });
  return {
    weekNumber: input.weekNumber,
    startDate: input.startDate,
    endDate: addDays(input.startDate, 6),
    phase: "marathon_build",
    days,
    totalMileage: input.totalMileage,
    isDownWeek: false,
    longRunDistance: input.longRunDistance,
    intensityDistribution: { easy: input.totalMileage, threshold: 0, marathon: 0, vo2: 0 },
  };
}

function makePlan(overrides: Partial<MarathonPlan> = {}): MarathonPlan {
  const weeks: WeeklyPlan[] = [
    makeWeek({
      weekNumber: 1,
      startDate: "2026-09-07",
      totalMileage: 40,
      longRunDistance: 14,
      entries: { "2026-09-13": longRun("w1-long", 14, 0, 110) },
    }),
    makeWeek({
      weekNumber: 2,
      startDate: "2026-09-14",
      totalMileage: 45,
      longRunDistance: 16,
      entries: { "2026-09-20": longRun("w2-long", 16, 6, 130) },
    }),
    makeWeek({
      weekNumber: 3,
      startDate: "2026-09-21",
      totalMileage: 50,
      longRunDistance: 18,
      entries: {
        "2026-09-23": workout("w3-tempo", "threshold", 8, 55, [
          { description: "Tempo", distance: 5, pace: 6.5, type: "threshold" },
        ]),
        "2026-09-27": longRun("w3-long", 18, 6, 150),
      },
    }),
    makeWeek({
      weekNumber: 4,
      startDate: "2026-09-28",
      totalMileage: 55,
      longRunDistance: 20,
      entries: {
        "2026-10-03": longRun("w4-long", 20, 8, 170),
        "2026-10-04": workout("race", "race", 26.2, 180),
      },
    }),
  ];

  return {
    id: "plan-1",
    runnerProfile: makeProfile(),
    paceZones: {
      easy: { min: 8.5, max: 9.5 },
      marathon: 7,
      threshold: 6.5,
      vo2: 6,
      recovery: 10,
      easyEffort: "Easy",
      marathonEffort: "Marathon",
      thresholdEffort: "Threshold",
      vo2Effort: "VO2",
      heartRateZones: {
        recovery: hrZone(120),
        easy: hrZone(140),
        marathon: hrZone(155),
        threshold: hrZone(168),
        vo2: hrZone(180),
      },
    },
    phases: [],
    weeks,
    totalWeeks: weeks.length,
    peakWeeklyMileage: 55,
    raceDay: "2026-10-04",
    generatedAt: "2026-08-01T00:00:00.000Z",
    goalAssessment: {
      feasibility: "realistic",
      reasoning: "",
      recommendedPeakMileage: 55,
      keyFactors: [],
      timeline: "",
    },
    riskWarnings: [],
    adjustmentRules: [],
    ...overrides,
  };
}

function breakdown(seconds: Partial<Record<EffortZone, number>>): TimeAtEffortBreakdown {
  const buckets = ZONES.map((zone) => ({ zone, seconds: seconds[zone] ?? 0 }));
  return {
    totalSeconds: buckets.reduce((sum, bucket) => sum + bucket.seconds, 0),
    unclassifiedSeconds: 0,
    buckets,
  };
}

function effort(
  heartRate: Partial<Record<EffortZone, number>> | null,
  power: Partial<Record<EffortZone, number>> | null = null,
): TimeAtEffortSummary {
  return {
    durationSeconds: 3600,
    heartRate: heartRate ? breakdown(heartRate) : null,
    power: power ? breakdown(power) : null,
  };
}

function run(date: string, miles: number, extra: Partial<ImpactBeaconRun> = {}): ImpactBeaconRun {
  return { date, miles, durationSeconds: Math.round(miles * 9 * 60), ...extra };
}

/** Weeks 1-3 logged, longest run 12, no structure. */
const TRAILING_RUNS: ImpactBeaconRun[] = [
  run("2026-09-08", 6),
  run("2026-09-10", 5),
  run("2026-09-12", 4),
  run("2026-09-15", 6),
  run("2026-09-17", 5),
  run("2026-09-19", 4),
  run("2026-09-22", 6),
  run("2026-09-24", 5),
  run("2026-09-26", 12),
];

describe("buildImpactBeacon", () => {
  it("beacons the largest gap among validated metrics only", () => {
    const report = buildImpactBeacon({
      plan: makePlan(),
      runs: TRAILING_RUNS,
      asOf: "2026-09-28",
    });

    expect(report.version).toBe("impact-beacon-v1");
    expect(report.planStarted).toBe(true);
    expect(report.weeksElapsed).toBe(4);
    expect(report.beacon?.key).toBe("volume");
    expect(report.gaps.map((gap) => gap.key)).toEqual(["volume", "long_run"]);
    expect(report.beacon?.completionRatio).toBeCloseTo(53 / (135 + 55 / 7), 3);
    expect(report.summary).toContain("Largest gap: Weekly volume");

    const eligible = report.metrics.filter((metric) => metric.impactEligible).map((metric) => metric.key);
    expect([...eligible].sort()).toEqual([...beaconReadinessMetrics()].sort());
    expect(report.metrics.find((metric) => metric.key === "consistency")?.impactEligible).toBe(false);
    expect(report.metrics.find((metric) => metric.key === "hr_effort")?.impactEligible).toBe(false);
    expect(report.gaps.some((gap) => gap.key === "consistency")).toBe(false);
  });

  it("cannot beacon a rejected metric even when it is the worst gap", () => {
    const frontLoaded = Array.from({ length: 8 }, (_, index) => (
      run(addDays("2026-09-07", index), 20)
    ));
    const report = buildImpactBeacon({ plan: makePlan(), runs: frontLoaded, asOf: "2026-09-28" });

    expect(report.beacon).toBeNull();
    expect(report.gaps).toEqual([]);
    const consistency = report.metrics.find((metric) => metric.key === "consistency");
    expect(consistency?.direction).toBe("behind");
    expect(consistency?.impactEligible).toBe(false);
    expect(report.summary).toContain("On track");
  });

  it("beacons a rejected metric only when the caller explicitly whitelists it", () => {
    const report = buildImpactBeacon({
      plan: makePlan(),
      runs: TRAILING_RUNS,
      asOf: "2026-09-28",
      beaconMetrics: ["consistency"],
    });

    expect(report.beacon?.key).toBe("consistency");
    expect(report.beacon?.tier).toBe("rejected");
    expect(report.metrics.find((metric) => metric.key === "consistency")?.impactEligible).toBe(true);
    expect(report.metrics.filter((metric) => metric.impactEligible)).toHaveLength(1);
  });

  it("consumes time-at-effort output for the context effort metrics", () => {
    const runs: ImpactBeaconRun[] = [
      ...TRAILING_RUNS,
      run("2026-09-25", 8, {
        timeAtEffort: effort(
          { easy: 600, threshold: 1800, marathon: 600 },
          { easy: 300, threshold: 1200, marathon: 300 },
        ),
      }),
    ];
    const report = buildImpactBeacon({ plan: makePlan(), runs, asOf: "2026-09-28" });
    const hr = report.metrics.find((metric) => metric.key === "hr_effort");
    const power = report.metrics.find((metric) => metric.key === "power_effort");

    expect(hr?.actual).toBe(40);
    expect(hr?.dataMissing).toBe(false);
    expect(hr?.components).toEqual([
      { label: "Minutes at threshold", planned: 32.5, actual: 30, unit: "minutes" },
      { label: "Minutes at marathon pace", planned: 84, actual: 10, unit: "minutes" },
    ]);
    expect(power?.actual).toBe(25);
    expect(power?.dataMissing).toBe(false);
    expect(report.beacon?.key).toBe("volume");
  });

  it("reports missing sample detail instead of inventing actual effort", () => {
    const report = buildImpactBeacon({ plan: makePlan(), runs: TRAILING_RUNS, asOf: "2026-09-28" });
    const hr = report.metrics.find((metric) => metric.key === "hr_effort");

    expect(hr?.actual).toBeNull();
    expect(hr?.dataMissing).toBe(true);
    expect(hr?.direction).toBe("no_data");
    expect(hr?.evidence).toContain("no stored sample detail");
  });

  it("pro-rates the in-progress week on both the planned and actual side", () => {
    const monday = buildImpactBeacon({ plan: makePlan(), runs: TRAILING_RUNS, asOf: "2026-09-28" });
    const friday = buildImpactBeacon({ plan: makePlan(), runs: TRAILING_RUNS, asOf: "2026-10-02" });

    const mondayVolume = monday.metrics.find((metric) => metric.key === "volume");
    const fridayVolume = friday.metrics.find((metric) => metric.key === "volume");
    expect(mondayVolume?.planned).toBeCloseTo(135 + 55 / 7, 1);
    expect(fridayVolume?.planned).toBeCloseTo(135 + (55 * 5) / 7, 1);
    expect(fridayVolume?.actual).toBe(53);
  });

  it("ignores runs and long runs after the cutoff, and treats races as load only", () => {
    const runs: ImpactBeaconRun[] = [
      run("2026-10-03", 20),
      run("2026-10-04", 26.2, { race: true }),
      run("2026-10-10", 30),
    ];
    const report = buildImpactBeacon({ plan: makePlan(), runs, asOf: "2026-10-05" });
    const longRun = report.metrics.find((metric) => metric.key === "long_run");
    const volume = report.metrics.find((metric) => metric.key === "volume");

    expect(longRun?.actual).toBe(20);
    expect(volume?.actual).toBe(46.2);
    expect(volume?.planned).toBe(190);
  });

  it("returns a no-data report before the plan starts", () => {
    const report = buildImpactBeacon({ plan: makePlan(), runs: [], asOf: "2026-09-01" });

    expect(report.planStarted).toBe(false);
    expect(report.beacon).toBeNull();
    expect(report.metrics.every((metric) => metric.direction === "no_data")).toBe(true);
    expect(report.summary).toContain("starts on 2026-09-07");
  });

  it("rejects an invalid as-of date", () => {
    expect(() => buildImpactBeacon({ plan: makePlan(), runs: [], asOf: "yesterday" }))
      .toThrow("Invalid as-of date");
  });

  it("works against a generated plan", () => {
    const plan = generatePlan(makeProfile({ raceDate: "2026-11-29", weeksOverride: 12 }));
    const asOf = addDays(plan.weeks[0].startDate, 20);
    const report = buildImpactBeacon({
      plan,
      runs: [run(plan.weeks[0].startDate, 10)],
      asOf,
    });

    expect(report.metrics).toHaveLength(5);
    expect(report.beacon === null || ["volume", "long_run"].includes(report.beacon.key)).toBe(true);
  });
});